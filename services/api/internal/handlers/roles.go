package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"

	"github.com/zeina/hyperviseur/services/api/internal/audit"
	"github.com/zeina/hyperviseur/services/api/internal/rbac"
)

// RolesHandler — gestion des rôles d'un tenant. Tous les owners du tenant
// (et le superadmin) peuvent créer / modifier / supprimer des rôles ;
// les rôles système (is_system=true) ne sont pas modifiables.
type RolesHandler struct {
	pool  *pgxpool.Pool
	audit *audit.Logger
}

func NewRolesHandler(pool *pgxpool.Pool, log *audit.Logger) *RolesHandler {
	return &RolesHandler{pool: pool, audit: log}
}

func (h *RolesHandler) Register(g *echo.Group) {
	g.GET("/roles", h.List)
	g.POST("/roles", h.Create)
	g.PUT("/roles/:id", h.Update)
	g.DELETE("/roles/:id", h.Delete)
	g.GET("/roles/features", h.Features) // référentiel des features pour l'UI
}

type roleOut struct {
	ID          uuid.UUID          `json:"id"`
	Name        string             `json:"name"`
	Description *string            `json:"description,omitempty"`
	Permissions rbac.PermissionSet `json:"permissions"`
	IsSystem    bool               `json:"is_system"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
}

// Features — renvoie le référentiel pour l'UI : pour chaque feature, son
// libellé court FR + sa description. Permet au frontend d'afficher la
// matrice à cocher sans dur-codage.
func (h *RolesHandler) Features(c echo.Context) error {
	type f struct {
		Code        rbac.Feature `json:"code"`
		Label       string       `json:"label"`
		Description string       `json:"description"`
	}
	out := []f{
		{rbac.FeatureDashboard, "Dashboards", "Tableaux de bord et widgets"},
		{rbac.FeatureDevices, "Équipements", "Capteurs, actionneurs, passerelles"},
		{rbac.FeatureRules, "Moteur de règles", "Création et édition des règles d'automatisation"},
		{rbac.FeatureMembers, "Membres du site", "Inviter / retirer des utilisateurs et leur attribuer un rôle"},
	}
	return c.JSON(http.StatusOK, out)
}

func (h *RolesHandler) List(c echo.Context) error {
	tid, _ := uuid.Parse(callerClaims(c).TenantID)
	const q = `
		SELECT id, name, description, permissions, is_system, created_at, updated_at
		FROM roles WHERE tenant_id = $1 ORDER BY is_system DESC, name
	`
	rows, err := h.pool.Query(c.Request().Context(), q, tid)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list roles", err)
	}
	defer rows.Close()
	out := []roleOut{}
	for rows.Next() {
		var r roleOut
		var permsRaw []byte
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &permsRaw, &r.IsSystem, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan role", err)
		}
		r.Permissions = rbac.ParsePermissions(permsRaw)
		out = append(out, r)
	}
	return c.JSON(http.StatusOK, out)
}

type createRoleReq struct {
	Name        string             `json:"name"`
	Description *string            `json:"description,omitempty"`
	Permissions rbac.PermissionSet `json:"permissions"`
}

func (h *RolesHandler) Create(c echo.Context) error {
	tid, _ := uuid.Parse(callerClaims(c).TenantID)
	var req createRoleReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return apperr.Validation("name required")
	}
	if err := validatePermissions(req.Permissions); err != nil {
		return apperr.Validation(err.Error())
	}

	permsJSON, _ := json.Marshal(req.Permissions)
	const q = `
		INSERT INTO roles (tenant_id, name, description, permissions, is_system)
		VALUES ($1, $2, $3, $4, false)
		RETURNING id, name, description, permissions, is_system, created_at, updated_at
	`
	var r roleOut
	var permsRaw []byte
	if err := h.pool.QueryRow(c.Request().Context(), q, tid, req.Name, req.Description, permsJSON).
		Scan(&r.ID, &r.Name, &r.Description, &permsRaw, &r.IsSystem, &r.CreatedAt, &r.UpdatedAt); err != nil {
		if isUniqueViolation(err) {
			return apperr.Validation("a role with this name already exists")
		}
		return apperr.Wrap(apperr.KindInternal, "insert role", err)
	}
	r.Permissions = rbac.ParsePermissions(permsRaw)

	callerUID, _ := uuid.Parse(callerClaims(c).Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &callerUID,
		Action: "role.create", TargetType: "role", TargetID: &r.ID, TargetName: r.Name,
		Metadata: map[string]any{"permissions": r.Permissions},
	})
	return c.JSON(http.StatusCreated, r)
}

type updateRoleReq struct {
	Name        *string             `json:"name,omitempty"`
	Description *string             `json:"description,omitempty"`
	Permissions *rbac.PermissionSet `json:"permissions,omitempty"`
}

func (h *RolesHandler) Update(c echo.Context) error {
	tid, _ := uuid.Parse(callerClaims(c).TenantID)
	rid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid role id")
	}
	var req updateRoleReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}

	// Vérifier que le rôle appartient au tenant et n'est pas système.
	var isSystem bool
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT is_system FROM roles WHERE id = $1 AND tenant_id = $2`, rid, tid).Scan(&isSystem); err != nil {
		return apperr.NotFound("role")
	}
	if isSystem {
		return apperr.Validation("system roles cannot be modified")
	}

	if req.Permissions != nil {
		if err := validatePermissions(*req.Permissions); err != nil {
			return apperr.Validation(err.Error())
		}
	}
	var permsJSON []byte
	if req.Permissions != nil {
		permsJSON, _ = json.Marshal(*req.Permissions)
	}
	const q = `
		UPDATE roles SET
			name        = COALESCE($3, name),
			description = COALESCE($4, description),
			permissions = COALESCE($5, permissions),
			updated_at  = now()
		WHERE id = $1 AND tenant_id = $2
		RETURNING id, name, description, permissions, is_system, created_at, updated_at
	`
	var r roleOut
	var permsRaw []byte
	if err := h.pool.QueryRow(c.Request().Context(), q, rid, tid, req.Name, req.Description, permsJSON).
		Scan(&r.ID, &r.Name, &r.Description, &permsRaw, &r.IsSystem, &r.CreatedAt, &r.UpdatedAt); err != nil {
		if isUniqueViolation(err) {
			return apperr.Validation("a role with this name already exists")
		}
		return apperr.Wrap(apperr.KindInternal, "update role", err)
	}
	r.Permissions = rbac.ParsePermissions(permsRaw)

	callerUID, _ := uuid.Parse(callerClaims(c).Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &callerUID,
		Action: "role.update", TargetType: "role", TargetID: &r.ID, TargetName: r.Name,
		Metadata: map[string]any{"permissions": r.Permissions},
	})
	return c.JSON(http.StatusOK, r)
}

func (h *RolesHandler) Delete(c echo.Context) error {
	tid, _ := uuid.Parse(callerClaims(c).TenantID)
	rid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid role id")
	}
	var isSystem bool
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT is_system FROM roles WHERE id = $1 AND tenant_id = $2`, rid, tid).Scan(&isSystem); err != nil {
		return apperr.NotFound("role")
	}
	if isSystem {
		return apperr.Validation("system roles cannot be deleted")
	}
	var name string
	_ = h.pool.QueryRow(c.Request().Context(), `SELECT name FROM roles WHERE id = $1`, rid).Scan(&name)
	if _, err := h.pool.Exec(c.Request().Context(),
		`DELETE FROM roles WHERE id = $1 AND tenant_id = $2`, rid, tid); err != nil {
		return apperr.Validation("role is in use by site members — remove them first")
	}

	callerUID, _ := uuid.Parse(callerClaims(c).Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &callerUID,
		Action: "role.delete", TargetType: "role", TargetID: &rid, TargetName: name,
	})
	return c.NoContent(http.StatusNoContent)
}

// validatePermissions — n'accepte que les features et niveaux connus.
func validatePermissions(p rbac.PermissionSet) error {
	known := map[rbac.Feature]bool{}
	for _, f := range rbac.AllFeatures {
		known[f] = true
	}
	for f, l := range p {
		if !known[f] {
			return fmt.Errorf("unknown feature %q", string(f))
		}
		if l != rbac.LevelNone && l != rbac.LevelRead && l != rbac.LevelWrite {
			return fmt.Errorf("invalid level %q for %q", string(l), string(f))
		}
	}
	return nil
}
