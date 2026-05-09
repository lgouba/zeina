package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"
	mw "github.com/zeina/hyperviseur/services/api/internal/middleware"
)

type DashboardsHandler struct {
	pool *pgxpool.Pool
}

func NewDashboardsHandler(pool *pgxpool.Pool) *DashboardsHandler {
	return &DashboardsHandler{pool: pool}
}

func (h *DashboardsHandler) RegisterReadOnly(g *echo.Group) {
	g.GET("/sites/:id/dashboards", h.ListBySite)
	g.GET("/dashboards/:id", h.Get)
}

func (h *DashboardsHandler) RegisterWrite(g *echo.Group) {
	g.POST("/sites/:id/dashboards", h.Create)
	g.PUT("/dashboards/:id", h.Update)
	g.DELETE("/dashboards/:id", h.Delete)
	g.POST("/dashboards/:id/widgets", h.CreateWidget)
	g.PUT("/widgets/:id", h.UpdateWidget)
	g.DELETE("/widgets/:id", h.DeleteWidget)
	g.PUT("/dashboards/:id/layouts", h.UpdateLayouts)
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type dashboardOut struct {
	ID          uuid.UUID `json:"id"`
	SiteID      uuid.UUID `json:"site_id"`
	Name        string    `json:"name"`
	Description *string   `json:"description,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type widgetOut struct {
	ID        uuid.UUID       `json:"id"`
	Type      string          `json:"type"`
	Title     string          `json:"title"`
	Position  int             `json:"position"`
	Config    json.RawMessage `json:"config"`
	Layout    json.RawMessage `json:"layout"` // {x,y,w,h} ou {} si défaut
	CreatedAt time.Time       `json:"created_at"`
}

type dashboardDetail struct {
	dashboardOut
	Widgets []widgetOut `json:"widgets"`
}

// ----------------------------------------------------------------------------
// Helpers : vérification d'accès
// ----------------------------------------------------------------------------

// ensureDashboardVisible vérifie qu'un dashboard appartient à un site du tenant
// courant et retourne ses infos basiques.
func (h *DashboardsHandler) ensureDashboardVisible(c echo.Context, id uuid.UUID) (*dashboardOut, error) {
	tid := tenantID(c)
	d := &dashboardOut{}
	err := h.pool.QueryRow(c.Request().Context(), `
		SELECT d.id, d.site_id, d.name, d.description, d.created_at, d.updated_at
		FROM dashboards d
		JOIN sites s ON s.id = d.site_id
		WHERE d.id = $1 AND s.tenant_id = $2`, id, tid).
		Scan(&d.ID, &d.SiteID, &d.Name, &d.Description, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, apperr.NotFound("dashboard")
	}
	return d, nil
}

// ensureWidgetVisible vérifie qu'un widget appartient à un dashboard d'un
// site du tenant et retourne le dashboard parent + le widget.
func (h *DashboardsHandler) ensureWidgetVisible(c echo.Context, widgetID uuid.UUID) (*dashboardOut, *widgetOut, error) {
	tid := tenantID(c)
	d := &dashboardOut{}
	w := &widgetOut{}
	err := h.pool.QueryRow(c.Request().Context(), `
		SELECT d.id, d.site_id, d.name, d.description, d.created_at, d.updated_at,
		       w.id, w.type::text, w.title, w.position, w.config, w.layout, w.created_at
		FROM dashboard_widgets w
		JOIN dashboards d ON d.id = w.dashboard_id
		JOIN sites s ON s.id = d.site_id
		WHERE w.id = $1 AND s.tenant_id = $2`, widgetID, tid).
		Scan(&d.ID, &d.SiteID, &d.Name, &d.Description, &d.CreatedAt, &d.UpdatedAt,
			&w.ID, &w.Type, &w.Title, &w.Position, &w.Config, &w.Layout, &w.CreatedAt)
	if err != nil {
		return nil, nil, apperr.NotFound("widget")
	}
	return d, w, nil
}

// ----------------------------------------------------------------------------
// Dashboards CRUD
// ----------------------------------------------------------------------------

func (h *DashboardsHandler) ListBySite(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)

	var ok bool
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT EXISTS(SELECT 1 FROM sites WHERE id = $1 AND tenant_id = $2)`,
		siteID, tid).Scan(&ok); err != nil || !ok {
		return apperr.NotFound("site")
	}

	rows, err := h.pool.Query(c.Request().Context(), `
		SELECT d.id, d.site_id, d.name, d.description, d.created_at, d.updated_at,
		       (SELECT count(*) FROM dashboard_widgets w WHERE w.dashboard_id = d.id) AS widget_count
		FROM dashboards d
		WHERE d.site_id = $1
		ORDER BY d.created_at DESC`, siteID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query dashboards", err)
	}
	defer rows.Close()

	type item struct {
		dashboardOut
		WidgetCount int `json:"widget_count"`
	}
	out := []item{}
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.ID, &it.SiteID, &it.Name, &it.Description, &it.CreatedAt, &it.UpdatedAt, &it.WidgetCount); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan", err)
		}
		out = append(out, it)
	}
	return c.JSON(http.StatusOK, out)
}

func (h *DashboardsHandler) Get(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid dashboard id")
	}
	d, err := h.ensureDashboardVisible(c, id)
	if err != nil {
		return err
	}

	wRows, err := h.pool.Query(c.Request().Context(), `
		SELECT id, type::text, title, position, config, layout, created_at
		FROM dashboard_widgets
		WHERE dashboard_id = $1
		ORDER BY position ASC, created_at ASC`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query widgets", err)
	}
	defer wRows.Close()

	widgets := []widgetOut{}
	for wRows.Next() {
		var w widgetOut
		if err := wRows.Scan(&w.ID, &w.Type, &w.Title, &w.Position, &w.Config, &w.Layout, &w.CreatedAt); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan widget", err)
		}
		widgets = append(widgets, w)
	}

	return c.JSON(http.StatusOK, dashboardDetail{dashboardOut: *d, Widgets: widgets})
}

type createDashboardReq struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

func (h *DashboardsHandler) Create(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	var req createDashboardReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if req.Name == "" {
		return apperr.Validation("name is required")
	}

	tid := tenantID(c)
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

	var d dashboardOut
	err = h.pool.QueryRow(c.Request().Context(), `
		INSERT INTO dashboards (site_id, name, description, created_by)
		VALUES ($1, $2, $3, $4)
		RETURNING id, site_id, name, description, created_at, updated_at`,
		siteID, req.Name, nullableText(req.Description), createdBy).
		Scan(&d.ID, &d.SiteID, &d.Name, &d.Description, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "insert dashboard", err)
	}
	return c.JSON(http.StatusCreated, d)
}

type updateDashboardReq struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

func (h *DashboardsHandler) Update(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid dashboard id")
	}
	if _, err := h.ensureDashboardVisible(c, id); err != nil {
		return err
	}
	var req updateDashboardReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	_, err = h.pool.Exec(c.Request().Context(), `
		UPDATE dashboards SET
		  name = COALESCE($2, name),
		  description = COALESCE($3, description),
		  updated_at = now()
		WHERE id = $1`, id, req.Name, req.Description)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "update dashboard", err)
	}
	d, _ := h.ensureDashboardVisible(c, id)
	return c.JSON(http.StatusOK, d)
}

func (h *DashboardsHandler) Delete(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid dashboard id")
	}
	if _, err := h.ensureDashboardVisible(c, id); err != nil {
		return err
	}
	if _, err := h.pool.Exec(c.Request().Context(), `DELETE FROM dashboards WHERE id = $1`, id); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete dashboard", err)
	}
	return c.NoContent(http.StatusNoContent)
}

// ----------------------------------------------------------------------------
// Widgets CRUD
// ----------------------------------------------------------------------------

type createWidgetReq struct {
	Type   string          `json:"type"`
	Title  string          `json:"title"`
	Config json.RawMessage `json:"config"`
}

func (h *DashboardsHandler) CreateWidget(c echo.Context) error {
	dashID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid dashboard id")
	}
	if _, err := h.ensureDashboardVisible(c, dashID); err != nil {
		return err
	}
	var req createWidgetReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	switch req.Type {
	case "value", "line", "area", "bar", "gauge", "state", "map":
	default:
		return apperr.Validation("invalid widget type")
	}
	if req.Title == "" {
		return apperr.Validation("title is required")
	}
	if len(req.Config) == 0 {
		req.Config = json.RawMessage(`{}`)
	}

	// Validation légère : le device_id (si présent) doit appartenir au tenant
	if devID, ok := extractStringFromConfig(req.Config, "device_id"); ok {
		if _, err := uuid.Parse(devID); err != nil {
			return apperr.Validation("config.device_id must be a UUID")
		}
		var visible bool
		if err := h.pool.QueryRow(c.Request().Context(), `
			SELECT EXISTS(
			  SELECT 1 FROM devices d
			  JOIN zones z ON z.id = d.zone_id
			  JOIN sites s ON s.id = z.site_id
			  WHERE d.id = $1 AND s.tenant_id = $2)`,
			devID, tenantID(c)).Scan(&visible); err != nil || !visible {
			return apperr.Validation("config.device_id does not belong to this tenant")
		}
	}

	// Position = max(position) + 1
	var nextPos int
	_ = h.pool.QueryRow(c.Request().Context(),
		`SELECT COALESCE(MAX(position), -1) + 1 FROM dashboard_widgets WHERE dashboard_id = $1`,
		dashID).Scan(&nextPos)

	var w widgetOut
	err = h.pool.QueryRow(c.Request().Context(), `
		INSERT INTO dashboard_widgets (dashboard_id, type, title, position, config)
		VALUES ($1, $2::widget_type, $3, $4, $5::jsonb)
		RETURNING id, type::text, title, position, config, layout, created_at`,
		dashID, req.Type, req.Title, nextPos, []byte(req.Config)).
		Scan(&w.ID, &w.Type, &w.Title, &w.Position, &w.Config, &w.Layout, &w.CreatedAt)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "insert widget", err)
	}
	return c.JSON(http.StatusCreated, w)
}

type updateWidgetReq struct {
	Title    *string         `json:"title,omitempty"`
	Position *int            `json:"position,omitempty"`
	Config   json.RawMessage `json:"config,omitempty"`
	Layout   json.RawMessage `json:"layout,omitempty"`
}

func (h *DashboardsHandler) UpdateWidget(c echo.Context) error {
	wID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid widget id")
	}
	_, _, err = h.ensureWidgetVisible(c, wID)
	if err != nil {
		return err
	}
	var req updateWidgetReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}

	var configBytes, layoutBytes interface{} = nil, nil
	if len(req.Config) > 0 {
		configBytes = []byte(req.Config)
	}
	if len(req.Layout) > 0 {
		layoutBytes = []byte(req.Layout)
	}

	_, err = h.pool.Exec(c.Request().Context(), `
		UPDATE dashboard_widgets SET
		  title = COALESCE($2, title),
		  position = COALESCE($3, position),
		  config = COALESCE($4::jsonb, config),
		  layout = COALESCE($5::jsonb, layout),
		  updated_at = now()
		WHERE id = $1`, wID, req.Title, req.Position, configBytes, layoutBytes)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "update widget", err)
	}

	_, w, _ := h.ensureWidgetVisible(c, wID)
	return c.JSON(http.StatusOK, w)
}

func (h *DashboardsHandler) DeleteWidget(c echo.Context) error {
	wID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid widget id")
	}
	if _, _, err := h.ensureWidgetVisible(c, wID); err != nil {
		return err
	}
	if _, err := h.pool.Exec(c.Request().Context(), `DELETE FROM dashboard_widgets WHERE id = $1`, wID); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete widget", err)
	}
	return c.NoContent(http.StatusNoContent)
}

// extractStringFromConfig essaie de lire une clé string dans un payload JSON.
func extractStringFromConfig(raw json.RawMessage, key string) (string, bool) {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return "", false
	}
	v, ok := m[key]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

// pgxRowsAffected — placeholder pour silencer un import inutilisé si besoin.
//
//nolint:unused
var _ = pgx.ErrNoRows

// ----------------------------------------------------------------------------
// PUT /v1/dashboards/:id/layouts
//
// Mise à jour batch des layouts (positions/tailles) de tous les widgets après
// un drag/resize côté UI. Body :
//
//   { "layouts": [
//       { "widget_id": "uuid", "x": 0, "y": 0, "w": 4, "h": 3 },
//       ...
//     ]
//   }
//
// Une seule transaction pour atomique. Tous les widgets référencés doivent
// appartenir au dashboard fourni dans l'URL (sinon 403/404).
// ----------------------------------------------------------------------------

type layoutEntry struct {
	WidgetID uuid.UUID `json:"widget_id"`
	X        int       `json:"x"`
	Y        int       `json:"y"`
	W        int       `json:"w"`
	H        int       `json:"h"`
}

type updateLayoutsReq struct {
	Layouts []layoutEntry `json:"layouts"`
}

func (h *DashboardsHandler) UpdateLayouts(c echo.Context) error {
	dashID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid dashboard id")
	}
	if _, err := h.ensureDashboardVisible(c, dashID); err != nil {
		return err
	}
	var req updateLayoutsReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if len(req.Layouts) == 0 {
		return c.NoContent(http.StatusNoContent)
	}

	ctx := c.Request().Context()
	tx, err := h.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin tx", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, l := range req.Layouts {
		if l.W <= 0 || l.H <= 0 {
			return apperr.Validation("w and h must be > 0")
		}
		layoutJSON, _ := json.Marshal(map[string]int{"x": l.X, "y": l.Y, "w": l.W, "h": l.H})
		ct, err := tx.Exec(ctx, `
			UPDATE dashboard_widgets SET layout = $2::jsonb, updated_at = now()
			WHERE id = $1 AND dashboard_id = $3`, l.WidgetID, layoutJSON, dashID)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "update layout", err)
		}
		if ct.RowsAffected() == 0 {
			return apperr.NotFound("widget not in this dashboard")
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit", err)
	}
	return c.NoContent(http.StatusNoContent)
}
