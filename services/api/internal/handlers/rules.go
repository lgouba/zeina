package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"
	mw "github.com/zeina/hyperviseur/services/api/internal/middleware"
)

type RulesHandler struct {
	pool *pgxpool.Pool
}

func NewRulesHandler(pool *pgxpool.Pool) *RulesHandler {
	return &RulesHandler{pool: pool}
}

func (h *RulesHandler) RegisterReadOnly(g *echo.Group) {
	g.GET("/sites/:id/rules", h.ListBySite)
	g.GET("/rules/:id", h.Get)
	g.GET("/rules/:id/executions", h.ListExecutions)
}

func (h *RulesHandler) RegisterWrite(g *echo.Group) {
	g.POST("/sites/:id/rules", h.Create)
	g.PUT("/rules/:id", h.Update)
	g.DELETE("/rules/:id", h.Delete)
	g.POST("/rules/:id/enable", h.Enable)
	g.POST("/rules/:id/disable", h.Disable)
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type ruleOut struct {
	ID              uuid.UUID       `json:"id"`
	TenantID        uuid.UUID       `json:"tenant_id"`
	SiteID          uuid.UUID       `json:"site_id"`
	Name            string          `json:"name"`
	Description     *string         `json:"description,omitempty"`
	Enabled         bool            `json:"enabled"`
	Definition      json.RawMessage `json:"definition"`
	DefinitionGraph json.RawMessage `json:"definition_graph,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

type executionOut struct {
	ID           uuid.UUID       `json:"id"`
	RuleID       uuid.UUID       `json:"rule_id"`
	TriggeredAt  time.Time       `json:"triggered_at"`
	ActionTaken  json.RawMessage `json:"action_taken"`
	Result       string          `json:"result"`
	ErrorMessage *string         `json:"error_message,omitempty"`
	LatencyMs    int             `json:"latency_ms"`
}

// ensureRuleVisible vérifie qu'une règle appartient au tenant courant.
// L'autorisation fine (par site) est faite via le middleware
// RequirePermission qui résout le site via SiteFromRule.
func (h *RulesHandler) ensureRuleVisible(c echo.Context, id uuid.UUID) (*ruleOut, error) {
	tid := tenantID(c)
	r := &ruleOut{}
	err := h.pool.QueryRow(c.Request().Context(), `
		SELECT id, tenant_id, site_id, name, description, enabled, definition, definition_graph, created_at, updated_at
		FROM rules WHERE id = $1 AND tenant_id = $2`, id, tid).
		Scan(&r.ID, &r.TenantID, &r.SiteID, &r.Name, &r.Description, &r.Enabled, &r.Definition, &r.DefinitionGraph, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, apperr.NotFound("rule")
	}
	return r, nil
}

// ListBySite renvoie les règles attachées au site (rules.site_id).
func (h *RulesHandler) ListBySite(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)

	rows, err := h.pool.Query(c.Request().Context(), `
		SELECT id, tenant_id, site_id, name, description, enabled, definition, definition_graph, created_at, updated_at
		FROM rules
		WHERE site_id = $1 AND tenant_id = $2
		ORDER BY created_at DESC`, siteID, tid)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query rules", err)
	}
	defer rows.Close()

	out := []ruleOut{}
	for rows.Next() {
		var r ruleOut
		if err := rows.Scan(&r.ID, &r.TenantID, &r.SiteID, &r.Name, &r.Description, &r.Enabled, &r.Definition, &r.DefinitionGraph, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan", err)
		}
		out = append(out, r)
	}
	return c.JSON(http.StatusOK, out)
}

func (h *RulesHandler) Get(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid rule id")
	}
	r, err := h.ensureRuleVisible(c, id)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, r)
}

// ----------------------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------------------

type createRuleReq struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Enabled     bool            `json:"enabled"`
	// Definition (legacy linéaire). Optionnelle si definition_graph fourni
	// — dans ce cas le backend la compile depuis le graph.
	Definition json.RawMessage `json:"definition,omitempty"`
	// DefinitionGraph (nouveau format visuel : nodes + edges).
	DefinitionGraph json.RawMessage `json:"definition_graph,omitempty"`
}

func (h *RulesHandler) Create(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	var req createRuleReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if req.Name == "" {
		return apperr.Validation("name is required")
	}

	// Compile graph → definition si necessaire (le moteur lit `definition`).
	if len(req.Definition) == 0 && len(req.DefinitionGraph) > 0 {
		compiled, cerr := compileGraphToDefinition(req.DefinitionGraph)
		if cerr != nil {
			return apperr.Validation("invalid graph: " + cerr.Error())
		}
		req.Definition = compiled
	}
	if len(req.Definition) == 0 {
		return apperr.Validation("definition or definition_graph is required")
	}

	tid := tenantID(c)

	// Vérifier site appartient au tenant
	var ok bool
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT EXISTS(SELECT 1 FROM sites WHERE id = $1 AND tenant_id = $2)`,
		siteID, tid).Scan(&ok); err != nil || !ok {
		return apperr.NotFound("site")
	}

	claims, _ := c.Get(mw.CtxKeyClaims).(*jwt.Claims)
	var createdBy *uuid.UUID
	if claims != nil {
		if uid, err := uuid.Parse(claims.Subject); err == nil {
			createdBy = &uid
		}
	}

	var graphArg interface{}
	if len(req.DefinitionGraph) > 0 {
		graphArg = []byte(req.DefinitionGraph)
	}

	var r ruleOut
	err = h.pool.QueryRow(c.Request().Context(), `
		INSERT INTO rules (tenant_id, site_id, name, description, enabled, definition, definition_graph, created_by)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
		RETURNING id, tenant_id, site_id, name, description, enabled, definition, definition_graph, created_at, updated_at`,
		tid, siteID, req.Name, nullableText(req.Description), req.Enabled, []byte(req.Definition), graphArg, createdBy).
		Scan(&r.ID, &r.TenantID, &r.SiteID, &r.Name, &r.Description, &r.Enabled, &r.Definition, &r.DefinitionGraph, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "insert rule", err)
	}
	return c.JSON(http.StatusCreated, r)
}

type updateRuleReq struct {
	Name            *string         `json:"name,omitempty"`
	Description     *string         `json:"description,omitempty"`
	Enabled         *bool           `json:"enabled,omitempty"`
	Definition      json.RawMessage `json:"definition,omitempty"`
	DefinitionGraph json.RawMessage `json:"definition_graph,omitempty"`
}

func (h *RulesHandler) Update(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid rule id")
	}
	if _, err := h.ensureRuleVisible(c, id); err != nil {
		return err
	}
	var req updateRuleReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	// Si on reçoit un graph mais pas de definition, on recompile.
	if len(req.Definition) == 0 && len(req.DefinitionGraph) > 0 {
		compiled, cerr := compileGraphToDefinition(req.DefinitionGraph)
		if cerr != nil {
			return apperr.Validation("invalid graph: " + cerr.Error())
		}
		req.Definition = compiled
	}
	var defBytes, graphBytes interface{}
	if len(req.Definition) > 0 {
		defBytes = []byte(req.Definition)
	}
	if len(req.DefinitionGraph) > 0 {
		graphBytes = []byte(req.DefinitionGraph)
	}
	_, err = h.pool.Exec(c.Request().Context(), `
		UPDATE rules SET
		  name = COALESCE($2, name),
		  description = COALESCE($3, description),
		  enabled = COALESCE($4, enabled),
		  definition = COALESCE($5::jsonb, definition),
		  definition_graph = COALESCE($6::jsonb, definition_graph),
		  updated_at = now()
		WHERE id = $1`, id, req.Name, req.Description, req.Enabled, defBytes, graphBytes)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "update rule", err)
	}
	r, _ := h.ensureRuleVisible(c, id)
	return c.JSON(http.StatusOK, r)
}

func (h *RulesHandler) Delete(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid rule id")
	}
	if _, err := h.ensureRuleVisible(c, id); err != nil {
		return err
	}
	if _, err := h.pool.Exec(c.Request().Context(), `DELETE FROM rules WHERE id = $1`, id); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete rule", err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *RulesHandler) Enable(c echo.Context) error  { return h.toggle(c, true) }
func (h *RulesHandler) Disable(c echo.Context) error { return h.toggle(c, false) }

func (h *RulesHandler) toggle(c echo.Context, enabled bool) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid rule id")
	}
	if _, err := h.ensureRuleVisible(c, id); err != nil {
		return err
	}
	if _, err := h.pool.Exec(c.Request().Context(),
		`UPDATE rules SET enabled = $2, updated_at = now() WHERE id = $1`, id, enabled); err != nil {
		return apperr.Wrap(apperr.KindInternal, "toggle rule", err)
	}
	r, _ := h.ensureRuleVisible(c, id)
	return c.JSON(http.StatusOK, r)
}

// ListExecutions retourne les N dernières exécutions d'une règle.
func (h *RulesHandler) ListExecutions(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid rule id")
	}
	if _, err := h.ensureRuleVisible(c, id); err != nil {
		return err
	}
	limit := 50
	if l := c.QueryParam("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	rows, err := h.pool.Query(c.Request().Context(), `
		SELECT id, rule_id, triggered_at, action_taken, result::text, error_message, latency_ms
		FROM rule_executions
		WHERE rule_id = $1
		ORDER BY triggered_at DESC
		LIMIT $2`, id, limit)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query executions", err)
	}
	defer rows.Close()
	out := []executionOut{}
	for rows.Next() {
		var e executionOut
		if err := rows.Scan(&e.ID, &e.RuleID, &e.TriggeredAt, &e.ActionTaken, &e.Result, &e.ErrorMessage, &e.LatencyMs); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan", err)
		}
		out = append(out, e)
	}
	return c.JSON(http.StatusOK, out)
}
