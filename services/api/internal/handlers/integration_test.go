// Tests d'intégration de l'API ZEINA — exécutés contre un vrai Postgres.
//
// Skip propre si TEST_DATABASE_URL n'est pas défini → permet `go test ./...`
// sans setup. La CI (GitHub Actions) provisionne le service Postgres + applique
// les migrations avant `go test`.
//
// Couverture :
//   - Login : succès / mauvais credentials
//   - /v1/auth/me : super/owner reçoit tous les sites en write, membre reçoit
//     uniquement ses memberships avec leurs permissions
//   - RBAC : un membre sans devices:write reçoit 403 sur POST /sites/:id/devices
//   - Anti cross-tenant : un user du tenant A ne voit pas le site du tenant B

package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"golang.org/x/crypto/bcrypt"

	"github.com/zeina/hyperviseur/packages/shared/jwt"

	"github.com/zeina/hyperviseur/services/api/internal/audit"
	"github.com/zeina/hyperviseur/services/api/internal/handlers"
	mw "github.com/zeina/hyperviseur/services/api/internal/middleware"
	"github.com/zeina/hyperviseur/services/api/internal/rbac"
)

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type harness struct {
	t      *testing.T
	pool   *pgxpool.Pool
	server *httptest.Server
	signer *jwt.Signer

	// Données seedées
	tenantA, tenantB uuid.UUID
	ownerA, memberA  uuid.UUID // tenant A : owner et un membre simple
	guestRoleA       uuid.UUID // rôle "Invité" du tenant A
	siteA            uuid.UUID
	tenantBOwner     uuid.UUID
	siteB            uuid.UUID
}

func setupHarness(t *testing.T) *harness {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL non défini — saute l'intégration")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(func() { pool.Close() })

	// Vérifie que la migration RBAC est appliquée (sinon erreurs cryptiques).
	var hasRBAC bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='roles')`).Scan(&hasRBAC); err != nil || !hasRBAC {
		t.Fatalf("DB non migrée — applique les migrations 0001..0009 avant les tests (err=%v, has_roles=%v)", err, hasRBAC)
	}

	resetData(t, pool)
	h := seedData(t, pool)

	signer, err := jwt.NewSigner("test-secret-must-be-at-least-32-bytes-long", 15*time.Minute, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("jwt.NewSigner: %v", err)
	}

	// Wire un Echo minimal — pas de MQTT, pas de WS.
	e := echo.New()
	e.HideBanner = true
	e.HTTPErrorHandler = mw.ErrorHandler(zerolog.Nop())

	auditLog := audit.NewLogger(pool)
	resolver := rbac.NewResolver(pool)

	v1 := e.Group("/v1")
	authH := handlers.NewAuthHandler(pool, signer)
	authH.Register(v1.Group("/auth"))

	authed := v1.Group("", mw.RequireAuth(signer))
	authH.RegisterMe(authed.Group("/auth"))

	tenantAdmin := authed.Group("", mw.RequireTenantOwner())
	handlers.NewUsersHandler(pool, auditLog).Register(tenantAdmin)
	handlers.NewRolesHandler(pool, auditLog).Register(tenantAdmin)
	handlers.NewAuditHandler(pool).Register(tenantAdmin)

	// Sites : List sur tout user authentifié, Create/Update/Delete sur tenantAdmin
	sitesH := handlers.NewSitesHandler(pool, auditLog)
	sitesH.Register(authed)
	sitesH.RegisterWrite(tenantAdmin)

	// Une seule route gardée par devices:write pour tester le RBAC fin
	authed.POST("/sites/:id/devices", func(c echo.Context) error {
		return c.JSON(http.StatusCreated, map[string]string{"ok": "would create"})
	}, mw.RequirePermission(resolver, rbac.FeatureDevices, rbac.LevelWrite, mw.SiteFromParam("id")))

	authed.GET("/sites/:id/devices", func(c echo.Context) error {
		return c.JSON(http.StatusOK, []string{})
	}, mw.RequirePermission(resolver, rbac.FeatureDevices, rbac.LevelRead, mw.SiteFromParam("id")))

	srv := httptest.NewServer(e)
	t.Cleanup(srv.Close)

	h.t = t
	h.pool = pool
	h.server = srv
	h.signer = signer
	return h
}

// resetData — supprime tout ce que les tests pourraient avoir laissé.
// On ne touche pas au tenant existant `acme` du seed dev (il est supposé
// présent en DB via `db/init`).
func resetData(t *testing.T, pool *pgxpool.Pool) {
	ctx := context.Background()
	stmts := []string{
		`DELETE FROM site_members WHERE site_id IN (SELECT id FROM sites WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'test-%'))`,
		`DELETE FROM rules WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'test-%')`,
		`DELETE FROM sites WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'test-%')`,
		`DELETE FROM roles WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'test-%')`,
		`DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'test-%')`,
		`DELETE FROM audit_events WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'test-%')`,
		`DELETE FROM tenants WHERE slug LIKE 'test-%'`,
	}
	for _, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil {
			t.Fatalf("reset: %v (stmt=%s)", err, s)
		}
	}
}

func seedData(t *testing.T, pool *pgxpool.Pool) *harness {
	ctx := context.Background()
	h := &harness{}

	mustQueryUUID := func(query string, args ...any) uuid.UUID {
		var id uuid.UUID
		if err := pool.QueryRow(ctx, query, args...).Scan(&id); err != nil {
			t.Fatalf("seed query failed: %v\n  q=%s", err, query)
		}
		return id
	}

	mustExec := func(query string, args ...any) {
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatalf("seed exec failed: %v\n  q=%s", err, query)
		}
	}

	// Tenants
	h.tenantA = mustQueryUUID(`INSERT INTO tenants (slug, name) VALUES ('test-a', 'Test A') RETURNING id`)
	h.tenantB = mustQueryUUID(`INSERT INTO tenants (slug, name) VALUES ('test-b', 'Test B') RETURNING id`)

	hash, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)
	h.ownerA = mustQueryUUID(
		`INSERT INTO users (tenant_id, email, password_hash, tenant_role, is_superadmin)
		 VALUES ($1, 'owner-a@test.local', $2, 'owner', false) RETURNING id`,
		h.tenantA, string(hash))
	h.memberA = mustQueryUUID(
		`INSERT INTO users (tenant_id, email, password_hash, tenant_role, is_superadmin)
		 VALUES ($1, 'member-a@test.local', $2, 'member', false) RETURNING id`,
		h.tenantA, string(hash))
	h.tenantBOwner = mustQueryUUID(
		`INSERT INTO users (tenant_id, email, password_hash, tenant_role, is_superadmin)
		 VALUES ($1, 'owner-b@test.local', $2, 'owner', false) RETURNING id`,
		h.tenantB, string(hash))

	// Rôles système (par convention seedés à la migration ; on s'assure ici qu'ils existent)
	guestPerms := `{"dashboard":"read","devices":"read","rules":"none","members":"none"}`
	respoPerms := `{"dashboard":"write","devices":"write","rules":"write","members":"write"}`
	h.guestRoleA = mustQueryUUID(
		`INSERT INTO roles (tenant_id, name, description, permissions, is_system)
		 VALUES ($1, 'Invité', 'test', $2::jsonb, true) RETURNING id`,
		h.tenantA, guestPerms)
	mustExec(
		`INSERT INTO roles (tenant_id, name, description, permissions, is_system)
		 VALUES ($1, 'Responsable de site', 'test', $2::jsonb, true)`,
		h.tenantA, respoPerms)
	mustExec(
		`INSERT INTO roles (tenant_id, name, description, permissions, is_system)
		 VALUES ($1, 'Responsable de site', 'test', $2::jsonb, true)`,
		h.tenantB, respoPerms)

	// Sites
	h.siteA = mustQueryUUID(
		`INSERT INTO sites (tenant_id, slug, name) VALUES ($1, 'site-a', 'Site A') RETURNING id`,
		h.tenantA)
	h.siteB = mustQueryUUID(
		`INSERT INTO sites (tenant_id, slug, name) VALUES ($1, 'site-b', 'Site B') RETURNING id`,
		h.tenantB)

	// memberA est ajouté comme Invité sur site A
	mustExec(
		`INSERT INTO site_members (site_id, user_id, role_id) VALUES ($1, $2, $3)`,
		h.siteA, h.memberA, h.guestRoleA)

	return h
}

// loginAs — POST /v1/auth/login, retourne l'access token.
func (h *harness) loginAs(email, password string) string {
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	resp, err := http.Post(h.server.URL+"/v1/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		h.t.Fatalf("login: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		h.t.Fatalf("login status %d for %s", resp.StatusCode, email)
	}
	var out struct {
		AccessToken string `json:"access_token"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out.AccessToken
}

// do — exécute une requête authentifiée et retourne (status, body décodé).
func (h *harness) do(method, path, token string, body any) (int, []byte) {
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, h.server.URL+path, rdr)
	if err != nil {
		h.t.Fatalf("request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatalf("http: %v", err)
	}
	defer resp.Body.Close()
	out := bytes.NewBuffer(nil)
	_, _ = out.ReadFrom(resp.Body)
	return resp.StatusCode, out.Bytes()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestLogin_Success(t *testing.T) {
	h := setupHarness(t)
	tok := h.loginAs("owner-a@test.local", "password123")
	if tok == "" {
		t.Fatal("empty token")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	h := setupHarness(t)
	body, _ := json.Marshal(map[string]string{"email": "owner-a@test.local", "password": "wrong"})
	resp, err := http.Post(h.server.URL+"/v1/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestMe_OwnerSeesAllSitesAsWrite(t *testing.T) {
	h := setupHarness(t)
	tok := h.loginAs("owner-a@test.local", "password123")
	st, body := h.do("GET", "/v1/auth/me", tok, nil)
	if st != 200 {
		t.Fatalf("status = %d, body=%s", st, body)
	}
	var me struct {
		User struct {
			TenantRole   string `json:"tenant_role"`
			IsSuperadmin bool   `json:"is_superadmin"`
		} `json:"user"`
		Sites []struct {
			SiteID      string            `json:"site_id"`
			RoleName    string            `json:"role_name"`
			Permissions map[string]string `json:"permissions"`
		} `json:"sites"`
	}
	_ = json.Unmarshal(body, &me)
	if me.User.TenantRole != "owner" {
		t.Errorf("tenant_role = %q, want owner", me.User.TenantRole)
	}
	if len(me.Sites) != 1 {
		t.Fatalf("owner should see 1 site (site-a), got %d", len(me.Sites))
	}
	for _, f := range []string{"dashboard", "devices", "rules", "members"} {
		if me.Sites[0].Permissions[f] != "write" {
			t.Errorf("owner.%s = %q, want write", f, me.Sites[0].Permissions[f])
		}
	}
}

func TestMe_MemberSeesOnlyAssignedSiteWithGuestPerms(t *testing.T) {
	h := setupHarness(t)
	tok := h.loginAs("member-a@test.local", "password123")
	st, body := h.do("GET", "/v1/auth/me", tok, nil)
	if st != 200 {
		t.Fatalf("status = %d", st)
	}
	var me struct {
		Sites []struct {
			SiteID      string            `json:"site_id"`
			RoleName    string            `json:"role_name"`
			Permissions map[string]string `json:"permissions"`
		} `json:"sites"`
	}
	_ = json.Unmarshal(body, &me)
	if len(me.Sites) != 1 || me.Sites[0].SiteID != h.siteA.String() {
		t.Fatalf("member should see only site-a, got %+v", me.Sites)
	}
	p := me.Sites[0].Permissions
	if p["dashboard"] != "read" || p["devices"] != "read" || p["rules"] != "none" || p["members"] != "none" {
		t.Errorf("guest perms wrong: %+v", p)
	}
}

func TestRBAC_MemberCannotPostDevice(t *testing.T) {
	h := setupHarness(t)
	tok := h.loginAs("member-a@test.local", "password123")

	// Read autorisé
	st, _ := h.do("GET", fmt.Sprintf("/v1/sites/%s/devices", h.siteA), tok, nil)
	if st != 200 {
		t.Errorf("guest read devices = %d, want 200", st)
	}

	// Write refusé
	st, body := h.do("POST", fmt.Sprintf("/v1/sites/%s/devices", h.siteA), tok, map[string]string{"slug": "x"})
	if st != 403 {
		t.Errorf("guest write devices = %d, want 403 (body=%s)", st, body)
	}
}

func TestRBAC_OwnerCanPostDevice(t *testing.T) {
	h := setupHarness(t)
	tok := h.loginAs("owner-a@test.local", "password123")
	st, body := h.do("POST", fmt.Sprintf("/v1/sites/%s/devices", h.siteA), tok, map[string]string{"slug": "x"})
	if st != 201 {
		t.Errorf("owner write devices = %d, want 201 (body=%s)", st, body)
	}
}

func TestRBAC_CrossTenantBlocked(t *testing.T) {
	h := setupHarness(t)
	// owner-a essaie d'accéder au site du tenant B
	tok := h.loginAs("owner-a@test.local", "password123")
	st, body := h.do("POST", fmt.Sprintf("/v1/sites/%s/devices", h.siteB), tok, map[string]string{"slug": "x"})
	if st != 403 {
		t.Errorf("cross-tenant write = %d, want 403 (body=%s)", st, body)
	}
}

func TestSites_OwnerCanCreate_AutoAddsAsResponsable(t *testing.T) {
	h := setupHarness(t)
	tok := h.loginAs("owner-a@test.local", "password123")
	st, body := h.do("POST", "/v1/sites", tok, map[string]any{
		"slug": "site-c", "name": "Site C",
	})
	if st != 201 {
		t.Fatalf("create site = %d (body=%s)", st, body)
	}
	var created struct {
		ID uuid.UUID `json:"id"`
	}
	_ = json.Unmarshal(body, &created)

	// Le créateur doit être membre du site avec le rôle Responsable.
	var roleName string
	err := h.pool.QueryRow(context.Background(), `
		SELECT r.name FROM site_members sm JOIN roles r ON r.id = sm.role_id
		WHERE sm.site_id = $1 AND sm.user_id = $2`,
		created.ID, h.ownerA).Scan(&roleName)
	if err != nil {
		t.Fatalf("creator not found in site_members: %v", err)
	}
	if roleName != "Responsable de site" {
		t.Errorf("creator role = %q, want Responsable de site", roleName)
	}

	// L'audit log doit avoir capté l'événement.
	var actionCount int
	_ = h.pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM audit_events
		WHERE tenant_id = $1 AND action = 'site.create' AND target_id = $2`,
		h.tenantA, created.ID).Scan(&actionCount)
	if actionCount != 1 {
		t.Errorf("audit count = %d, want 1", actionCount)
	}
}

func TestSites_MemberCannotCreate(t *testing.T) {
	h := setupHarness(t)
	tok := h.loginAs("member-a@test.local", "password123")
	st, _ := h.do("POST", "/v1/sites", tok, map[string]string{"slug": "site-c", "name": "Site C"})
	if st != 403 {
		t.Errorf("member create site = %d, want 403", st)
	}
}

func TestSites_InvalidSlugRejected(t *testing.T) {
	h := setupHarness(t)
	tok := h.loginAs("owner-a@test.local", "password123")
	st, _ := h.do("POST", "/v1/sites", tok, map[string]string{"slug": "Site With Spaces", "name": "x"})
	if st != 400 {
		t.Errorf("bad slug = %d, want 400", st)
	}
}
