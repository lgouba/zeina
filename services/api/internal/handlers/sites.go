package handlers

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"
	"github.com/zeina/hyperviseur/services/api/internal/audit"
	mw "github.com/zeina/hyperviseur/services/api/internal/middleware"
)

type SitesHandler struct {
	pool  *pgxpool.Pool
	audit *audit.Logger
}

func NewSitesHandler(pool *pgxpool.Pool, log *audit.Logger) *SitesHandler {
	return &SitesHandler{pool: pool, audit: log}
}

func (h *SitesHandler) Register(g *echo.Group) {
	g.GET("/sites", h.List)
	g.GET("/sites/:id", h.Get)
	g.GET("/sites/:id/tree", h.Tree)
	g.GET("/sites/:id/summary", h.Summary)
}

// RegisterWrite : routes mutantes (réservées aux owners/superadmins).
func (h *SitesHandler) RegisterWrite(g *echo.Group) {
	g.POST("/sites", h.Create)
	g.PUT("/sites/:id", h.Update)
	g.DELETE("/sites/:id", h.Delete)
}

type siteOut struct {
	ID       uuid.UUID `json:"id"`
	Slug     string    `json:"slug"`
	Name     string    `json:"name"`
	Address  *string   `json:"address,omitempty"`
	Lat      *float64  `json:"lat,omitempty"`
	Lng      *float64  `json:"lng,omitempty"`
	Timezone string    `json:"timezone"`
}

// List renvoie les sites accessibles à l'utilisateur courant :
//   - superadmin / owner du tenant : tous les sites du tenant
//   - membre simple : uniquement les sites où il est dans site_members
func (h *SitesHandler) List(c echo.Context) error {
	claims, _ := c.Get(mw.CtxKeyClaims).(*jwt.Claims)
	if claims == nil {
		return apperr.Unauthorized("")
	}
	tid, _ := uuid.Parse(claims.TenantID)

	var (
		rows pgx.Rows
		err  error
	)
	if claims.IsSuperadmin || claims.Role == "owner" {
		rows, err = h.pool.Query(c.Request().Context(),
			`SELECT id, slug, name, address, lat, lng, timezone
			 FROM sites WHERE tenant_id = $1 ORDER BY name`, tid)
	} else {
		uid, _ := uuid.Parse(claims.Subject)
		rows, err = h.pool.Query(c.Request().Context(),
			`SELECT s.id, s.slug, s.name, s.address, s.lat, s.lng, s.timezone
			 FROM sites s
			 JOIN site_members sm ON sm.site_id = s.id AND sm.user_id = $2
			 WHERE s.tenant_id = $1 ORDER BY s.name`, tid, uid)
	}
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query sites", err)
	}
	defer rows.Close()

	out := []siteOut{}
	for rows.Next() {
		var s siteOut
		if err := rows.Scan(&s.ID, &s.Slug, &s.Name, &s.Address, &s.Lat, &s.Lng, &s.Timezone); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan site", err)
		}
		out = append(out, s)
	}
	return c.JSON(http.StatusOK, out)
}

func (h *SitesHandler) Get(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)
	var s siteOut
	err = h.pool.QueryRow(c.Request().Context(),
		`SELECT id, slug, name, address, lat, lng, timezone FROM sites WHERE id = $1 AND tenant_id = $2`,
		id, tid).Scan(&s.ID, &s.Slug, &s.Name, &s.Address, &s.Lat, &s.Lng, &s.Timezone)
	if err != nil {
		return apperr.NotFound("site")
	}
	return c.JSON(http.StatusOK, s)
}

// Tree retourne la structure complète : site → zones → devices
type treeDevice struct {
	ID       uuid.UUID `json:"id"`
	Slug     string    `json:"slug"`
	Name     *string   `json:"name,omitempty"`
	Type     string    `json:"type"`
	Status   string    `json:"status"`
	LastSeen *string   `json:"last_seen_at,omitempty"`
}
type treeZone struct {
	ID      uuid.UUID    `json:"id"`
	Slug    string       `json:"slug"`
	Name    string       `json:"name"`
	Devices []treeDevice `json:"devices"`
}
type treeOut struct {
	siteOut
	Zones []treeZone `json:"zones"`
}

func (h *SitesHandler) Tree(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)
	ctx := c.Request().Context()

	var s siteOut
	err = h.pool.QueryRow(ctx,
		`SELECT id, slug, name, address, lat, lng, timezone FROM sites WHERE id = $1 AND tenant_id = $2`,
		id, tid).Scan(&s.ID, &s.Slug, &s.Name, &s.Address, &s.Lat, &s.Lng, &s.Timezone)
	if err != nil {
		return apperr.NotFound("site")
	}

	zoneRows, err := h.pool.Query(ctx,
		`SELECT id, slug, name FROM zones WHERE site_id = $1 ORDER BY name`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query zones", err)
	}
	defer zoneRows.Close()

	zones := []treeZone{}
	zoneByID := map[uuid.UUID]int{}
	for zoneRows.Next() {
		var z treeZone
		if err := zoneRows.Scan(&z.ID, &z.Slug, &z.Name); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan zone", err)
		}
		z.Devices = []treeDevice{}
		zoneByID[z.ID] = len(zones)
		zones = append(zones, z)
	}

	devRows, err := h.pool.Query(ctx, `
		SELECT d.id, d.zone_id, d.slug, d.name, d.type::text, d.status::text, d.last_seen_at::text
		FROM devices d
		JOIN zones z ON z.id = d.zone_id
		WHERE z.site_id = $1
		ORDER BY d.slug`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query devices", err)
	}
	defer devRows.Close()

	for devRows.Next() {
		var (
			d      treeDevice
			zoneID uuid.UUID
		)
		if err := devRows.Scan(&d.ID, &zoneID, &d.Slug, &d.Name, &d.Type, &d.Status, &d.LastSeen); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan device", err)
		}
		if idx, ok := zoneByID[zoneID]; ok {
			zones[idx].Devices = append(zones[idx].Devices, d)
		}
	}

	return c.JSON(http.StatusOK, treeOut{siteOut: s, Zones: zones})
}

// Summary — compteurs simples par site, affichés sur les cartes de SitesHome.
//
// Volontairement universel (n'importe quel site, même sans capteurs
// environnement, a des règles / alarmes / widgets). Les KPIs métiers
// (énergie, température, occupation) ont été retirés au profit de quatre
// compteurs lisibles d'un coup d'œil.
type siteSummary struct {
	SiteID       uuid.UUID `json:"site_id"`
	DevicesTotal int       `json:"devices_total"`
	RulesTotal   int       `json:"rules_total"`
	AlarmsTotal  int       `json:"alarms_total"`  // toutes alarmes, tous statuts confondus
	WidgetsTotal int       `json:"widgets_total"` // somme sur tous les dashboards du site
}

func (h *SitesHandler) Summary(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)
	ctx := c.Request().Context()

	// Vérifier appartenance
	var exists bool
	err = h.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM sites WHERE id = $1 AND tenant_id = $2)`,
		id, tid).Scan(&exists)
	if err != nil || !exists {
		return apperr.NotFound("site")
	}

	out := siteSummary{SiteID: id}

	// Une seule requête avec sous-selects → roundtrip réduit.
	const q = `
		SELECT
		    (SELECT count(*) FROM devices d
		       JOIN zones z ON z.id = d.zone_id
		       WHERE z.site_id = $1)                                    AS devices_total,
		    (SELECT count(*) FROM rules WHERE site_id = $1)             AS rules_total,
		    (SELECT count(*) FROM alarms WHERE site_id = $1)            AS alarms_total,
		    (SELECT count(*) FROM dashboard_widgets dw
		       JOIN dashboards d ON d.id = dw.dashboard_id
		       WHERE d.site_id = $1)                                    AS widgets_total
	`
	if err := h.pool.QueryRow(ctx, q, id).Scan(
		&out.DevicesTotal, &out.RulesTotal, &out.AlarmsTotal, &out.WidgetsTotal,
	); err != nil {
		return apperr.Wrap(apperr.KindInternal, "site summary counts", err)
	}

	return c.JSON(http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// CRUD (owner / superadmin)
// ---------------------------------------------------------------------------

type createSiteReq struct {
	Slug     string   `json:"slug"`
	Name     string   `json:"name"`
	Address  *string  `json:"address,omitempty"`
	Lat      *float64 `json:"lat,omitempty"`
	Lng      *float64 `json:"lng,omitempty"`
	Timezone *string  `json:"timezone,omitempty"`
}

// Create — crée un site et ajoute automatiquement le créateur comme
// "Responsable de site" dans site_members. Le tout en transaction pour
// que l'auto-membership ne puisse pas se désynchroniser.
//
// Note : si le créateur est déjà owner du tenant ou superadmin, son accès
// est implicite (pas de ligne site_members nécessaire) — on l'ajoute quand
// même pour la traçabilité et pour garder une convention claire.
func (h *SitesHandler) Create(c echo.Context) error {
	claims := callerClaims(c)
	if claims == nil {
		return apperr.Unauthorized("")
	}
	var req createSiteReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	req.Slug = strings.TrimSpace(strings.ToLower(req.Slug))
	req.Name = strings.TrimSpace(req.Name)
	if req.Slug == "" || req.Name == "" {
		return apperr.Validation("slug and name are required")
	}
	// Limites de taille (anti-DoS, anti injection HTML/MQTT topic).
	if len(req.Name) > 200 {
		return apperr.Validation("name too long (max 200 chars)")
	}
	if len(req.Slug) > 64 {
		return apperr.Validation("slug too long (max 64 chars)")
	}
	if req.Address != nil && len(*req.Address) > 500 {
		return apperr.Validation("address too long (max 500 chars)")
	}
	if !isSlugValid(req.Slug) {
		return apperr.Validation("slug must contain only [a-z0-9-]")
	}
	if req.Lat != nil && (*req.Lat < -90 || *req.Lat > 90) {
		return apperr.Validation("lat must be between -90 and 90")
	}
	if req.Lng != nil && (*req.Lng < -180 || *req.Lng > 180) {
		return apperr.Validation("lng must be between -180 and 180")
	}
	tz := "Africa/Ouagadougou"
	if req.Timezone != nil && *req.Timezone != "" {
		if len(*req.Timezone) > 64 || strings.ContainsAny(*req.Timezone, "\r\n\t") {
			return apperr.Validation("invalid timezone")
		}
		tz = *req.Timezone
	}

	tid, _ := uuid.Parse(claims.TenantID)
	uid, _ := uuid.Parse(claims.Subject)

	tx, err := h.pool.BeginTx(c.Request().Context(), pgx.TxOptions{})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin tx", err)
	}
	defer func() { _ = tx.Rollback(c.Request().Context()) }()

	const insertSiteQ = `
		INSERT INTO sites (tenant_id, slug, name, address, lat, lng, timezone)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, slug, name, address, lat, lng, timezone
	`
	var s siteOut
	if err := tx.QueryRow(c.Request().Context(), insertSiteQ,
		tid, req.Slug, req.Name, req.Address, req.Lat, req.Lng, tz,
	).Scan(&s.ID, &s.Slug, &s.Name, &s.Address, &s.Lat, &s.Lng, &s.Timezone); err != nil {
		if isUniqueViolation(err) {
			return apperr.Validation("a site with this slug already exists in this tenant")
		}
		return apperr.Wrap(apperr.KindInternal, "insert site", err)
	}

	// Crée les 2 rôles système site-scope ("Responsable de site" et "Invité")
	// pour ce nouveau site. Pattern repris de la migration 0016/0017.
	//   - Responsable de site : write partout
	//   - Invité              : read partout (dashboards, équipements + zones,
	//                           règles + alarmes, membres en lecture)
	if _, err := tx.Exec(c.Request().Context(), `
		INSERT INTO roles (tenant_id, site_id, name, description, permissions, is_system)
		VALUES
		    ($1, $2, 'Responsable de site',
		     'Accès complet au site : dashboards, équipements, règles, membres.',
		     jsonb_build_object('dashboard','write','devices','write','rules','write','members','write'),
		     true),
		    ($1, $2, 'Invité',
		     'Accès en lecture seule à toutes les fonctionnalités du site.',
		     jsonb_build_object('dashboard','read','devices','read','rules','read','members','read'),
		     true)
		ON CONFLICT DO NOTHING`,
		tid, s.ID,
	); err != nil {
		return apperr.Wrap(apperr.KindInternal, "seed system roles", err)
	}

	// Récupère le rôle "Responsable de site" qu'on vient de créer pour ce site.
	var roleID uuid.UUID
	if err := tx.QueryRow(c.Request().Context(),
		`SELECT id FROM roles WHERE tenant_id = $1 AND site_id = $2 AND name = 'Responsable de site' LIMIT 1`,
		tid, s.ID).Scan(&roleID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "fetch new role", err)
	}

	// Auto-add le créateur comme membre "Responsable de site". Si le user
	// est superadmin/owner du tenant, c'est redondant fonctionnellement mais
	// utile pour l'historique et la cohérence visible dans /v1/sites/:id/members.
	if _, err := tx.Exec(c.Request().Context(), `
		INSERT INTO site_members (site_id, user_id, role_id, added_by)
		VALUES ($1, $2, $3, $2)
		ON CONFLICT (site_id, user_id) DO NOTHING`,
		s.ID, uid, roleID,
	); err != nil {
		return apperr.Wrap(apperr.KindInternal, "auto-add member", err)
	}

	if err := tx.Commit(c.Request().Context()); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit", err)
	}

	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &uid, Action: "site.create", TargetType: "site", TargetID: &s.ID, TargetName: s.Name,
		Metadata: map[string]any{"slug": s.Slug},
	})
	return c.JSON(http.StatusCreated, s)
}

type updateSiteReq struct {
	Name     *string  `json:"name,omitempty"`
	Address  *string  `json:"address,omitempty"`
	Lat      *float64 `json:"lat,omitempty"`
	Lng      *float64 `json:"lng,omitempty"`
	Timezone *string  `json:"timezone,omitempty"`
}

func (h *SitesHandler) Update(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)
	var req updateSiteReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}

	const q = `
		UPDATE sites SET
			name     = COALESCE($3, name),
			address  = COALESCE($4, address),
			lat      = COALESCE($5, lat),
			lng      = COALESCE($6, lng),
			timezone = COALESCE($7, timezone),
			updated_at = now()
		WHERE id = $1 AND tenant_id = $2
		RETURNING id, slug, name, address, lat, lng, timezone
	`
	var s siteOut
	if err := h.pool.QueryRow(c.Request().Context(), q,
		id, tid, req.Name, req.Address, req.Lat, req.Lng, req.Timezone,
	).Scan(&s.ID, &s.Slug, &s.Name, &s.Address, &s.Lat, &s.Lng, &s.Timezone); err != nil {
		return apperr.NotFound("site")
	}

	uid, _ := uuid.Parse(callerClaims(c).Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &uid, Action: "site.update", TargetType: "site", TargetID: &s.ID, TargetName: s.Name,
	})
	return c.JSON(http.StatusOK, s)
}

func (h *SitesHandler) Delete(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)

	// Récupère le nom pour l'audit avant la suppression.
	var name string
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT name FROM sites WHERE id = $1 AND tenant_id = $2`, id, tid).Scan(&name); err != nil {
		return apperr.NotFound("site")
	}

	if _, err := h.pool.Exec(c.Request().Context(),
		`DELETE FROM sites WHERE id = $1 AND tenant_id = $2`, id, tid); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete site", err)
	}

	uid, _ := uuid.Parse(callerClaims(c).Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &uid, Action: "site.delete", TargetType: "site", TargetID: &id, TargetName: name,
	})
	return c.NoContent(http.StatusNoContent)
}

// isSlugValid — n'autorise que les slugs propres pour les topics MQTT
// (qlab/{tenant}/{site}/...). Refuse les espaces, accents, etc.
func isSlugValid(s string) bool {
	if s == "" || len(s) > 64 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9':
		case r == '-':
		default:
			return false
		}
	}
	return true
}

// --- Helper accessible aux autres handlers du package ---------------------

func tenantID(c echo.Context) uuid.UUID {
	claims, _ := c.Get(mw.CtxKeyClaims).(*jwt.Claims)
	if claims == nil {
		return uuid.Nil
	}
	id, _ := uuid.Parse(claims.TenantID)
	return id
}
