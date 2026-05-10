package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"

	"github.com/zeina/hyperviseur/services/api/internal/audit"
)

// ZonesHandler — CRUD des zones (hiérarchie : zone géographique → groupe de
// bâtiments → bâtiment → étage → pièce). RBAC : `devices:write` est appliqué
// par les middlewares au moment du wiring (cf. main.go).
type ZonesHandler struct {
	pool  *pgxpool.Pool
	audit *audit.Logger
}

func NewZonesHandler(pool *pgxpool.Pool, log *audit.Logger) *ZonesHandler {
	return &ZonesHandler{pool: pool, audit: log}
}

// ZoneOut — payload public d'une zone. Reste exporté car partagé avec d'autres
// handlers (devices, dashboards qui pourraient l'embarquer).
type ZoneOut struct {
	ID           uuid.UUID       `json:"id"`
	SiteID       uuid.UUID       `json:"site_id"`
	ParentZoneID *uuid.UUID      `json:"parent_zone_id,omitempty"`
	Slug         string          `json:"slug"`
	Name         string          `json:"name"`
	Kind         string          `json:"kind"`
	Description  *string         `json:"description,omitempty"`
	Icon         *string         `json:"icon,omitempty"`
	Color        *string         `json:"color,omitempty"`
	Geometry     json.RawMessage `json:"geometry,omitempty"`
}

const validZoneKinds = "geographic|building_group|building|floor|room"

func isValidKind(k string) bool {
	for _, v := range strings.Split(validZoneKinds, "|") {
		if v == k {
			return true
		}
	}
	return false
}

// allowedParents — règles métier de containment. Une chaîne vide dans la
// liste représente "aucun parent" (zone racine).
//
//	geographic     ne peut être qu'à la racine
//	building_group dans geographic uniquement
//	building       dans geographic ou building_group
//	floor          dans building (le seul cas d'imbrication étage)
//	room           partout sauf dans une autre room
//
// Ces règles sont appliquées côté backend (Create + Update) et côté UI
// pour filtrer les dropdowns / sous-menus — synchronisées avec
// frontend/src/pages/ZonesPage.tsx (ALLOWED_PARENTS).
var allowedParents = map[string][]string{
	"geographic":     {""},
	"building_group": {"geographic"},
	"building":       {"geographic", "building_group"},
	"floor":          {"building"},
	"room":           {"geographic", "building_group", "building", "floor"},
}

func canHaveAsParent(child, parentKind string) bool {
	for _, p := range allowedParents[child] {
		if p == parentKind {
			return true
		}
	}
	return false
}

// hierarchyErrorMessage — message FR explicite quand un couple (kind, parent) est refusé.
func hierarchyErrorMessage(child, parent string) string {
	labels := map[string]string{
		"":               "à la racine",
		"geographic":     "dans une zone géographique",
		"building_group": "dans un groupe de bâtiments",
		"building":       "dans un bâtiment",
		"floor":          "dans un étage",
		"room":           "dans une pièce",
	}
	childLabels := map[string]string{
		"geographic":     "Une zone géographique",
		"building_group": "Un groupe de bâtiments",
		"building":       "Un bâtiment",
		"floor":          "Un étage",
		"room":           "Une pièce",
	}
	return childLabels[child] + " ne peut pas être placé " + labels[parent] + "."
}

// parentKind retourne le kind de la zone parente, ou "" si racine. Utilisé
// par les validations Create/Update.
func (h *ZonesHandler) parentKind(c echo.Context, parentID *uuid.UUID) (string, error) {
	if parentID == nil {
		return "", nil
	}
	var k string
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT kind::text FROM zones WHERE id = $1`, *parentID).Scan(&k); err != nil {
		return "", apperr.Validation("parent_zone_id introuvable")
	}
	return k, nil
}

// List renvoie toutes les zones d'un site, ordonnées par parent puis nom.
// Le frontend reconstruit l'arbre côté client.
func (h *ZonesHandler) List(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)
	if err := h.assertSiteInTenant(c, siteID, tid); err != nil {
		return err
	}

	const q = `
		SELECT id, site_id, parent_zone_id, slug, name, kind::text, description, icon, color, geometry
		FROM zones WHERE site_id = $1
		ORDER BY parent_zone_id NULLS FIRST, name
	`
	rows, err := h.pool.Query(c.Request().Context(), q, siteID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list zones", err)
	}
	defer rows.Close()

	out := []ZoneOut{}
	for rows.Next() {
		var z ZoneOut
		if err := rows.Scan(&z.ID, &z.SiteID, &z.ParentZoneID, &z.Slug, &z.Name, &z.Kind, &z.Description, &z.Icon, &z.Color, &z.Geometry); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan zone", err)
		}
		out = append(out, z)
	}
	return c.JSON(http.StatusOK, out)
}

type createZoneReq struct {
	Slug         string          `json:"slug"`
	Name         string          `json:"name"`
	Kind         string          `json:"kind"`
	ParentZoneID *uuid.UUID      `json:"parent_zone_id,omitempty"`
	Description  *string         `json:"description,omitempty"`
	Icon         *string         `json:"icon,omitempty"`
	Color        *string         `json:"color,omitempty"`
	Geometry     json.RawMessage `json:"geometry,omitempty"`
}

func (h *ZonesHandler) Create(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)
	if err := h.assertSiteInTenant(c, siteID, tid); err != nil {
		return err
	}

	var req createZoneReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	req.Slug = strings.TrimSpace(strings.ToLower(req.Slug))
	req.Name = strings.TrimSpace(req.Name)
	if req.Slug == "" || req.Name == "" {
		return apperr.Validation("slug and name are required")
	}
	if len(req.Name) > 200 {
		return apperr.Validation("name too long (max 200 chars)")
	}
	if len(req.Slug) > 64 {
		return apperr.Validation("slug too long (max 64 chars)")
	}
	if req.Description != nil && len(*req.Description) > 500 {
		return apperr.Validation("description too long (max 500 chars)")
	}
	if !isSlugValid(req.Slug) {
		return apperr.Validation("slug must contain only [a-z0-9-]")
	}
	if req.Kind == "" {
		req.Kind = "room"
	}
	if !isValidKind(req.Kind) {
		return apperr.Validation("kind must be one of " + validZoneKinds)
	}
	if req.ParentZoneID != nil {
		if err := h.assertParentInSameSite(c, siteID, *req.ParentZoneID); err != nil {
			return err
		}
	}
	pkind, err := h.parentKind(c, req.ParentZoneID)
	if err != nil {
		return err
	}
	if !canHaveAsParent(req.Kind, pkind) {
		return apperr.Validation(hierarchyErrorMessage(req.Kind, pkind))
	}

	const q = `
		INSERT INTO zones (site_id, parent_zone_id, slug, name, kind, description, icon, color, geometry)
		VALUES ($1, $2, $3, $4, $5::zone_kind, $6, $7, $8, $9)
		RETURNING id, site_id, parent_zone_id, slug, name, kind::text, description, icon, color, geometry
	`
	var z ZoneOut
	var geomBytes any
	if len(req.Geometry) > 0 {
		geomBytes = []byte(req.Geometry)
	}
	if err := h.pool.QueryRow(c.Request().Context(), q,
		siteID, req.ParentZoneID, req.Slug, req.Name, req.Kind,
		req.Description, req.Icon, req.Color, geomBytes,
	).Scan(&z.ID, &z.SiteID, &z.ParentZoneID, &z.Slug, &z.Name, &z.Kind, &z.Description, &z.Icon, &z.Color, &z.Geometry); err != nil {
		if isUniqueViolation(err) {
			return apperr.Validation("a zone with this slug already exists in this site")
		}
		return apperr.Wrap(apperr.KindInternal, "insert zone", err)
	}

	if cl := callerClaims(c); cl != nil {
		uid, _ := uuid.Parse(cl.Subject)
		h.audit.Log(c.Request().Context(), audit.Event{
			TenantID: tid, ActorID: &uid,
			Action: "zone.create", TargetType: "zone", TargetID: &z.ID, TargetName: z.Name,
			Metadata: map[string]any{"site_id": siteID, "kind": z.Kind, "parent": z.ParentZoneID},
		})
	}
	return c.JSON(http.StatusCreated, z)
}

type updateZoneReq struct {
	Name         *string         `json:"name,omitempty"`
	Kind         *string         `json:"kind,omitempty"`
	ParentZoneID *uuid.UUID      `json:"parent_zone_id,omitempty"`
	Description  *string         `json:"description,omitempty"`
	Icon         *string         `json:"icon,omitempty"`
	Color        *string         `json:"color,omitempty"`
	Geometry     json.RawMessage `json:"geometry,omitempty"`
}

func (h *ZonesHandler) Update(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid zone id")
	}
	var req updateZoneReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if req.Kind != nil && !isValidKind(*req.Kind) {
		return apperr.Validation("kind must be one of " + validZoneKinds)
	}

	// Charge la zone pour vérifier l'isolation tenant.
	var siteID uuid.UUID
	tid := tenantID(c)
	if err := h.pool.QueryRow(c.Request().Context(), `
		SELECT z.site_id FROM zones z
		JOIN sites s ON s.id = z.site_id
		WHERE z.id = $1 AND s.tenant_id = $2`, zoneID, tid).Scan(&siteID); err != nil {
		return apperr.NotFound("zone")
	}

	// Anti-cycle : un parent ne peut pas être un descendant.
	if req.ParentZoneID != nil {
		if *req.ParentZoneID == zoneID {
			return apperr.Validation("a zone cannot be its own parent")
		}
		if err := h.assertParentInSameSite(c, siteID, *req.ParentZoneID); err != nil {
			return err
		}
		isDesc, err := h.isDescendant(c, *req.ParentZoneID, zoneID)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "cycle check", err)
		}
		if isDesc {
			return apperr.Validation("cannot move a zone under one of its descendants")
		}
	}

	// Validation hiérarchique : le couple (kind, parentKind) doit être autorisé.
	// On résout le kind effectif (req.Kind si fourni, sinon le kind actuel
	// stocké en DB) et le parent effectif idem.
	effectiveKind := ""
	if req.Kind != nil {
		effectiveKind = *req.Kind
	} else {
		_ = h.pool.QueryRow(c.Request().Context(), `SELECT kind::text FROM zones WHERE id = $1`, zoneID).Scan(&effectiveKind)
	}
	var effectiveParent *uuid.UUID
	if req.ParentZoneID != nil {
		effectiveParent = req.ParentZoneID
	} else {
		var pid *uuid.UUID
		_ = h.pool.QueryRow(c.Request().Context(), `SELECT parent_zone_id FROM zones WHERE id = $1`, zoneID).Scan(&pid)
		effectiveParent = pid
	}
	pkind, err := h.parentKind(c, effectiveParent)
	if err != nil {
		return err
	}
	if !canHaveAsParent(effectiveKind, pkind) {
		return apperr.Validation(hierarchyErrorMessage(effectiveKind, pkind))
	}

	var geomBytes any
	if len(req.Geometry) > 0 {
		geomBytes = []byte(req.Geometry)
	}

	const q = `
		UPDATE zones SET
			name           = COALESCE($2, name),
			kind           = COALESCE($3::zone_kind, kind),
			parent_zone_id = COALESCE($4, parent_zone_id),
			description    = COALESCE($5, description),
			icon           = COALESCE($6, icon),
			color          = COALESCE($7, color),
			geometry       = COALESCE($8, geometry),
			updated_at     = now()
		WHERE id = $1
		RETURNING id, site_id, parent_zone_id, slug, name, kind::text, description, icon, color, geometry
	`
	var z ZoneOut
	if err := h.pool.QueryRow(c.Request().Context(), q,
		zoneID, req.Name, req.Kind, req.ParentZoneID,
		req.Description, req.Icon, req.Color, geomBytes,
	).Scan(&z.ID, &z.SiteID, &z.ParentZoneID, &z.Slug, &z.Name, &z.Kind, &z.Description, &z.Icon, &z.Color, &z.Geometry); err != nil {
		return apperr.Wrap(apperr.KindInternal, "update zone", err)
	}

	if cl := callerClaims(c); cl != nil {
		uid, _ := uuid.Parse(cl.Subject)
		h.audit.Log(c.Request().Context(), audit.Event{
			TenantID: tid, ActorID: &uid,
			Action: "zone.update", TargetType: "zone", TargetID: &z.ID, TargetName: z.Name,
		})
	}
	return c.JSON(http.StatusOK, z)
}

func (h *ZonesHandler) Delete(c echo.Context) error {
	zoneID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid zone id")
	}
	tid := tenantID(c)

	// Charge nom + site pour audit + isolation.
	var (
		name   string
		siteID uuid.UUID
	)
	if err := h.pool.QueryRow(c.Request().Context(), `
		SELECT z.name, z.site_id FROM zones z
		JOIN sites s ON s.id = z.site_id
		WHERE z.id = $1 AND s.tenant_id = $2`, zoneID, tid).Scan(&name, &siteID); err != nil {
		return apperr.NotFound("zone")
	}

	// Refuse si la zone contient des sous-zones ou des devices.
	var hasChildren, hasDevices bool
	_ = h.pool.QueryRow(c.Request().Context(),
		`SELECT EXISTS(SELECT 1 FROM zones WHERE parent_zone_id = $1)`, zoneID).Scan(&hasChildren)
	_ = h.pool.QueryRow(c.Request().Context(),
		`SELECT EXISTS(SELECT 1 FROM devices WHERE zone_id = $1)`, zoneID).Scan(&hasDevices)
	switch {
	case hasChildren && hasDevices:
		return apperr.Validation("zone contains sub-zones and devices — move them first")
	case hasChildren:
		return apperr.Validation("zone contains sub-zones — move or delete them first")
	case hasDevices:
		return apperr.Validation("zone contains devices — move or delete them first")
	}

	if _, err := h.pool.Exec(c.Request().Context(), `DELETE FROM zones WHERE id = $1`, zoneID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete zone", err)
	}

	if cl := callerClaims(c); cl != nil {
		uid, _ := uuid.Parse(cl.Subject)
		h.audit.Log(c.Request().Context(), audit.Event{
			TenantID: tid, ActorID: &uid,
			Action: "zone.delete", TargetType: "zone", TargetID: &zoneID, TargetName: name,
		})
	}
	return c.NoContent(http.StatusNoContent)
}

// --- Helpers ---------------------------------------------------------------

func (h *ZonesHandler) assertSiteInTenant(c echo.Context, siteID, tid uuid.UUID) error {
	var ok bool
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT EXISTS(SELECT 1 FROM sites WHERE id = $1 AND tenant_id = $2)`,
		siteID, tid).Scan(&ok); err != nil || !ok {
		return apperr.NotFound("site")
	}
	return nil
}

func (h *ZonesHandler) assertParentInSameSite(c echo.Context, siteID, parentID uuid.UUID) error {
	var ok bool
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT EXISTS(SELECT 1 FROM zones WHERE id = $1 AND site_id = $2)`,
		parentID, siteID).Scan(&ok); err != nil || !ok {
		return apperr.Validation("parent_zone_id is not a zone of this site")
	}
	return nil
}

// isDescendant retourne true si `candidate` est descendant de `ancestor`.
// Utilisé pour empêcher la création d'un cycle lors d'un Update.
func (h *ZonesHandler) isDescendant(c echo.Context, candidate, ancestor uuid.UUID) (bool, error) {
	const q = `
		WITH RECURSIVE down AS (
			SELECT id, parent_zone_id FROM zones WHERE id = $1
			UNION
			SELECT z.id, z.parent_zone_id FROM zones z
			JOIN down d ON z.parent_zone_id = d.id
		)
		SELECT EXISTS(SELECT 1 FROM down WHERE id = $2)
	`
	var ok bool
	if err := h.pool.QueryRow(c.Request().Context(), q, ancestor, candidate).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}
