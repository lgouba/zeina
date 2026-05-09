// Catalogue de modèles de capteurs : CRUD + listing des attributs.
//
// Le catalogue est partagé entre tous les tenants (référentiel constructeur).
// Seul le rôle admin peut créer/modifier/supprimer un modèle. La lecture
// est ouverte à tous les rôles authentifiés.
package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
)

type DeviceModelsHandler struct {
	pool *pgxpool.Pool
}

func NewDeviceModelsHandler(pool *pgxpool.Pool) *DeviceModelsHandler {
	return &DeviceModelsHandler{pool: pool}
}

func (h *DeviceModelsHandler) RegisterReadOnly(g *echo.Group) {
	g.GET("/device-models", h.List)
	g.GET("/device-models/:id", h.Get)
}

func (h *DeviceModelsHandler) RegisterWrite(g *echo.Group) {
	g.POST("/device-models", h.Create)
	g.PUT("/device-models/:id", h.Update)
	g.DELETE("/device-models/:id", h.Delete)
	g.POST("/device-models/:id/attributes", h.AddAttribute)
	g.DELETE("/model-attributes/:id", h.DeleteAttribute)
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type modelAttributeOut struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	Unit         string    `json:"unit"`
	MinValue     *float64  `json:"min_value,omitempty"`
	MaxValue     *float64  `json:"max_value,omitempty"`
	Description  *string   `json:"description,omitempty"`
	Position     int       `json:"position"`
	Configurable bool      `json:"configurable"`
}

type deviceModelOut struct {
	ID                     uuid.UUID           `json:"id"`
	Brand                  string              `json:"brand"`
	Code                   string              `json:"code"`
	Category               string              `json:"category"`
	Protocol               *string             `json:"protocol,omitempty"`
	Description            *string             `json:"description,omitempty"`
	DefaultIntervalMinutes *int                `json:"default_interval_minutes,omitempty"`
	CreatedAt              time.Time           `json:"created_at"`
	UpdatedAt              time.Time           `json:"updated_at"`
	Attributes             []modelAttributeOut `json:"attributes,omitempty"`
}

// ----------------------------------------------------------------------------
// List + Get
// ----------------------------------------------------------------------------

// List renvoie les modèles, sans les attributs (pour rester léger). Filtres
// optionnels : ?category=Environnement, ?brand=Milesight.
func (h *DeviceModelsHandler) List(c echo.Context) error {
	cat := c.QueryParam("category")
	brand := c.QueryParam("brand")

	rows, err := h.pool.Query(c.Request().Context(), `
		SELECT id, brand, code, category, protocol, description,
		       default_interval_minutes, created_at, updated_at
		FROM device_models
		WHERE ($1 = '' OR category = $1) AND ($2 = '' OR brand = $2)
		ORDER BY brand, code`, cat, brand)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query models", err)
	}
	defer rows.Close()

	out := []deviceModelOut{}
	for rows.Next() {
		var m deviceModelOut
		if err := rows.Scan(&m.ID, &m.Brand, &m.Code, &m.Category, &m.Protocol, &m.Description,
			&m.DefaultIntervalMinutes, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan model", err)
		}
		out = append(out, m)
	}
	return c.JSON(http.StatusOK, out)
}

// Get renvoie un modèle complet avec ses attributs.
func (h *DeviceModelsHandler) Get(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid model id")
	}
	var m deviceModelOut
	err = h.pool.QueryRow(c.Request().Context(), `
		SELECT id, brand, code, category, protocol, description,
		       default_interval_minutes, created_at, updated_at
		FROM device_models WHERE id = $1`, id).
		Scan(&m.ID, &m.Brand, &m.Code, &m.Category, &m.Protocol, &m.Description,
			&m.DefaultIntervalMinutes, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return apperr.NotFound("device model")
	}

	attrs, err := h.fetchAttributes(c, id)
	if err != nil {
		return err
	}
	m.Attributes = attrs
	return c.JSON(http.StatusOK, m)
}

func (h *DeviceModelsHandler) fetchAttributes(c echo.Context, modelID uuid.UUID) ([]modelAttributeOut, error) {
	rows, err := h.pool.Query(c.Request().Context(), `
		SELECT id, name, unit, min_value, max_value, description, position, configurable
		FROM device_model_attributes
		WHERE device_model_id = $1
		ORDER BY position, name`, modelID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "query attrs", err)
	}
	defer rows.Close()
	out := []modelAttributeOut{}
	for rows.Next() {
		var a modelAttributeOut
		if err := rows.Scan(&a.ID, &a.Name, &a.Unit, &a.MinValue, &a.MaxValue, &a.Description, &a.Position, &a.Configurable); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "scan attr", err)
		}
		out = append(out, a)
	}
	return out, nil
}

// ----------------------------------------------------------------------------
// Create + Update + Delete model
// ----------------------------------------------------------------------------

type createModelReq struct {
	Brand                  string `json:"brand"`
	Code                   string `json:"code"`
	Category               string `json:"category"`
	Protocol               string `json:"protocol,omitempty"`
	Description            string `json:"description,omitempty"`
	DefaultIntervalMinutes *int   `json:"default_interval_minutes,omitempty"`
	// Permet de poster les attributs en même temps que le modèle.
	Attributes []createAttributeReq `json:"attributes,omitempty"`
}

type createAttributeReq struct {
	Name         string   `json:"name"`
	Unit         string   `json:"unit"`
	MinValue     *float64 `json:"min_value,omitempty"`
	MaxValue     *float64 `json:"max_value,omitempty"`
	Description  string   `json:"description,omitempty"`
	Position     int      `json:"position,omitempty"`
	Configurable *bool    `json:"configurable,omitempty"`
}

func (h *DeviceModelsHandler) Create(c echo.Context) error {
	var req createModelReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if req.Brand == "" || req.Code == "" || req.Category == "" {
		return apperr.Validation("brand, code and category are required")
	}

	ctx := c.Request().Context()
	tx, err := h.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin tx", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var m deviceModelOut
	err = tx.QueryRow(ctx, `
		INSERT INTO device_models (brand, code, category, protocol, description, default_interval_minutes)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, brand, code, category, protocol, description, default_interval_minutes, created_at, updated_at`,
		req.Brand, req.Code, req.Category,
		nullableText(req.Protocol), nullableText(req.Description), req.DefaultIntervalMinutes,
	).Scan(&m.ID, &m.Brand, &m.Code, &m.Category, &m.Protocol, &m.Description,
		&m.DefaultIntervalMinutes, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return apperr.Conflict("a model with this brand+code already exists")
		}
		return apperr.Wrap(apperr.KindInternal, "insert model", err)
	}

	// Attributs (optionnels)
	for i, a := range req.Attributes {
		if a.Name == "" || a.Unit == "" {
			return apperr.Validation("attribute name and unit are required")
		}
		conf := true
		if a.Configurable != nil {
			conf = *a.Configurable
		}
		pos := a.Position
		if pos == 0 {
			pos = i + 1
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO device_model_attributes (device_model_id, name, unit, min_value, max_value, description, position, configurable)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			m.ID, strings.TrimSpace(a.Name), strings.TrimSpace(a.Unit),
			a.MinValue, a.MaxValue, nullableText(a.Description), pos, conf)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "insert attribute", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit", err)
	}

	// Retourner le modèle complet avec ses attributs
	attrs, _ := h.fetchAttributes(c, m.ID)
	m.Attributes = attrs
	return c.JSON(http.StatusCreated, m)
}

type updateModelReq struct {
	Brand                  *string `json:"brand,omitempty"`
	Code                   *string `json:"code,omitempty"`
	Category               *string `json:"category,omitempty"`
	Protocol               *string `json:"protocol,omitempty"`
	Description            *string `json:"description,omitempty"`
	DefaultIntervalMinutes *int    `json:"default_interval_minutes,omitempty"`
}

func (h *DeviceModelsHandler) Update(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid model id")
	}
	var req updateModelReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	_, err = h.pool.Exec(c.Request().Context(), `
		UPDATE device_models SET
		  brand    = COALESCE($2, brand),
		  code     = COALESCE($3, code),
		  category = COALESCE($4, category),
		  protocol = COALESCE($5, protocol),
		  description = COALESCE($6, description),
		  default_interval_minutes = COALESCE($7, default_interval_minutes),
		  updated_at = now()
		WHERE id = $1`,
		id, req.Brand, req.Code, req.Category, req.Protocol, req.Description, req.DefaultIntervalMinutes)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "update model", err)
	}
	return h.Get(c)
}

func (h *DeviceModelsHandler) Delete(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid model id")
	}
	// Refuse la suppression si des devices référencent encore ce modèle
	var count int
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT count(*) FROM devices WHERE model_id = $1`, id).Scan(&count); err == nil && count > 0 {
		return apperr.Conflict("model is used by " + strconv.Itoa(count) + " device(s)")
	}
	if _, err := h.pool.Exec(c.Request().Context(), `DELETE FROM device_models WHERE id = $1`, id); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete model", err)
	}
	return c.NoContent(http.StatusNoContent)
}

// ----------------------------------------------------------------------------
// Attributes : add + delete
// ----------------------------------------------------------------------------

func (h *DeviceModelsHandler) AddAttribute(c echo.Context) error {
	modelID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid model id")
	}
	var req createAttributeReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if req.Name == "" || req.Unit == "" {
		return apperr.Validation("name and unit are required")
	}
	conf := true
	if req.Configurable != nil {
		conf = *req.Configurable
	}
	var a modelAttributeOut
	err = h.pool.QueryRow(c.Request().Context(), `
		INSERT INTO device_model_attributes (device_model_id, name, unit, min_value, max_value, description, position, configurable)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, name, unit, min_value, max_value, description, position, configurable`,
		modelID, req.Name, req.Unit, req.MinValue, req.MaxValue, nullableText(req.Description), req.Position, conf,
	).Scan(&a.ID, &a.Name, &a.Unit, &a.MinValue, &a.MaxValue, &a.Description, &a.Position, &a.Configurable)
	if err != nil {
		if isUniqueViolation(err) {
			return apperr.Conflict("an attribute with this name already exists for this model")
		}
		return apperr.Wrap(apperr.KindInternal, "insert attribute", err)
	}
	return c.JSON(http.StatusCreated, a)
}

func (h *DeviceModelsHandler) DeleteAttribute(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid attribute id")
	}
	if _, err := h.pool.Exec(c.Request().Context(), `DELETE FROM device_model_attributes WHERE id = $1`, id); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete attribute", err)
	}
	return c.NoContent(http.StatusNoContent)
}
