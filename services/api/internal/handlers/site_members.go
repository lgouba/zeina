package handlers

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"

	"github.com/zeina/hyperviseur/services/api/internal/audit"
	"github.com/zeina/hyperviseur/services/api/internal/rbac"
)

// SiteMembersHandler — gestion des membres d'un site.
//
// Routes (toutes gardées par RequirePermission(members, ...)) :
//
//	GET    /v1/sites/:id/members
//	POST   /v1/sites/:id/members              {user_id, role_id}
//	PUT    /v1/sites/:id/members/:user_id     {role_id}
//	DELETE /v1/sites/:id/members/:user_id
type SiteMembersHandler struct {
	pool  *pgxpool.Pool
	audit *audit.Logger
}

func NewSiteMembersHandler(pool *pgxpool.Pool, log *audit.Logger) *SiteMembersHandler {
	return &SiteMembersHandler{pool: pool, audit: log}
}

// Le wiring est fait dans main.go avec les middlewares appropriés —
// on expose juste les méthodes individuelles.

type memberOut struct {
	UserID      uuid.UUID          `json:"user_id"`
	Email       string             `json:"email"`
	FullName    *string            `json:"full_name,omitempty"`
	FirstName   *string            `json:"first_name,omitempty"`
	LastName    *string            `json:"last_name,omitempty"`
	Phone       *string            `json:"phone,omitempty"`
	RoleID      uuid.UUID          `json:"role_id"`
	RoleName    string             `json:"role_name"`
	Permissions rbac.PermissionSet `json:"permissions"`
	AddedAt     time.Time          `json:"added_at"`
}

func (h *SiteMembersHandler) List(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid, _ := uuid.Parse(callerClaims(c).TenantID)

	const q = `
		SELECT u.id, u.email, u.full_name, u.first_name, u.last_name, u.phone,
		       r.id, r.name, r.permissions, sm.added_at
		FROM site_members sm
		JOIN users u ON u.id = sm.user_id
		JOIN roles r ON r.id = sm.role_id
		JOIN sites s ON s.id = sm.site_id
		WHERE sm.site_id = $1 AND s.tenant_id = $2
		ORDER BY u.email
	`
	rows, err := h.pool.Query(c.Request().Context(), q, siteID, tid)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list members", err)
	}
	defer rows.Close()
	out := []memberOut{}
	for rows.Next() {
		var m memberOut
		var permsRaw []byte
		if err := rows.Scan(&m.UserID, &m.Email, &m.FullName, &m.FirstName, &m.LastName, &m.Phone,
			&m.RoleID, &m.RoleName, &permsRaw, &m.AddedAt); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan member", err)
		}
		m.Permissions = rbac.ParsePermissions(permsRaw)
		out = append(out, m)
	}
	return c.JSON(http.StatusOK, out)
}

type addMemberReq struct {
	UserID uuid.UUID `json:"user_id"`
	RoleID uuid.UUID `json:"role_id"`
}

func (h *SiteMembersHandler) Add(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	caller := callerClaims(c)
	tid, _ := uuid.Parse(caller.TenantID)

	var req addMemberReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}

	// Vérifier que user et rôle appartiennent bien au tenant du site.
	if err := h.assertSameTenant(c, tid, siteID, req.UserID, req.RoleID); err != nil {
		return err
	}

	callerUID, _ := uuid.Parse(caller.Subject)
	const q = `
		INSERT INTO site_members (site_id, user_id, role_id, added_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (site_id, user_id) DO UPDATE
		  SET role_id = EXCLUDED.role_id, added_at = now(), added_by = EXCLUDED.added_by
	`
	if _, err := h.pool.Exec(c.Request().Context(), q, siteID, req.UserID, req.RoleID, callerUID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "add member", err)
	}

	// Snapshot lisible : email du user + nom du rôle pour l'audit.
	var email, roleName string
	_ = h.pool.QueryRow(c.Request().Context(),
		`SELECT u.email, r.name FROM users u, roles r WHERE u.id = $1 AND r.id = $2`,
		req.UserID, req.RoleID).Scan(&email, &roleName)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &callerUID,
		Action: "member.add", TargetType: "member", TargetID: &req.UserID, TargetName: email,
		Metadata: map[string]any{"site_id": siteID, "role_id": req.RoleID, "role_name": roleName},
	})
	return c.NoContent(http.StatusNoContent)
}

type updateMemberReq struct {
	RoleID uuid.UUID `json:"role_id"`
}

func (h *SiteMembersHandler) Update(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	uid, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		return apperr.Validation("invalid user id")
	}
	tid, _ := uuid.Parse(callerClaims(c).TenantID)

	var req updateMemberReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}

	if err := h.assertSameTenant(c, tid, siteID, uid, req.RoleID); err != nil {
		return err
	}

	if _, err := h.pool.Exec(c.Request().Context(),
		`UPDATE site_members SET role_id = $3 WHERE site_id = $1 AND user_id = $2`,
		siteID, uid, req.RoleID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "update member", err)
	}

	callerUID, _ := uuid.Parse(callerClaims(c).Subject)
	var email, roleName string
	_ = h.pool.QueryRow(c.Request().Context(),
		`SELECT u.email, r.name FROM users u, roles r WHERE u.id = $1 AND r.id = $2`,
		uid, req.RoleID).Scan(&email, &roleName)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &callerUID,
		Action: "member.update", TargetType: "member", TargetID: &uid, TargetName: email,
		Metadata: map[string]any{"site_id": siteID, "role_id": req.RoleID, "role_name": roleName},
	})
	return c.NoContent(http.StatusNoContent)
}

func (h *SiteMembersHandler) Remove(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	uid, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		return apperr.Validation("invalid user id")
	}
	var email string
	_ = h.pool.QueryRow(c.Request().Context(), `SELECT email FROM users WHERE id = $1`, uid).Scan(&email)

	if _, err := h.pool.Exec(c.Request().Context(),
		`DELETE FROM site_members WHERE site_id = $1 AND user_id = $2`, siteID, uid); err != nil {
		return apperr.Wrap(apperr.KindInternal, "remove member", err)
	}

	tid, _ := uuid.Parse(callerClaims(c).TenantID)
	callerUID, _ := uuid.Parse(callerClaims(c).Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &callerUID,
		Action: "member.remove", TargetType: "member", TargetID: &uid, TargetName: email,
		Metadata: map[string]any{"site_id": siteID},
	})
	return c.NoContent(http.StatusNoContent)
}

// assertSameTenant — vérifie que site, user et rôle appartiennent au même
// tenant (anti cross-tenant smuggling).
func (h *SiteMembersHandler) assertSameTenant(c echo.Context, tid, siteID, userID, roleID uuid.UUID) error {
	var siteTID, userTID, roleTID uuid.UUID
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT tenant_id FROM sites WHERE id = $1`, siteID).Scan(&siteTID); err != nil {
		return apperr.NotFound("site")
	}
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT tenant_id FROM users WHERE id = $1`, userID).Scan(&userTID); err != nil {
		return apperr.NotFound("user")
	}
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT tenant_id FROM roles WHERE id = $1`, roleID).Scan(&roleTID); err != nil {
		return apperr.NotFound("role")
	}
	if siteTID != tid || userTID != tid || roleTID != tid {
		return apperr.Forbidden("cross-tenant reference")
	}
	return nil
}
