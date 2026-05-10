package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"

	"github.com/zeina/hyperviseur/packages/shared/domain"
	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	sharedmqtt "github.com/zeina/hyperviseur/packages/shared/mqtt"
	"github.com/zeina/hyperviseur/packages/shared/topics"
)

type DevicesHandler struct {
	pool       *pgxpool.Pool
	mqtt       *sharedmqtt.Client
	tenantSlug string // tenant slug pour construire les topics MQTT
}

func NewDevicesHandler(pool *pgxpool.Pool, mqtt *sharedmqtt.Client, tenantSlug string) *DevicesHandler {
	return &DevicesHandler{pool: pool, mqtt: mqtt, tenantSlug: tenantSlug}
}

// RegisterReadOnly enregistre les routes accessibles à tous les rôles
// authentifiés (viewer/manager/admin).
func (h *DevicesHandler) RegisterReadOnly(g *echo.Group) {
	g.GET("/devices/:id", h.Get)
	g.GET("/devices/:id/latest", h.Latest)
	g.GET("/devices/:id/measurements", h.Measurements)
	g.GET("/devices/:id/measurements-metadata", h.MeasurementsMetadata)
	g.GET("/sites/:id/devices", h.ListBySite)
	g.GET("/sites/:id/zones", h.ListZonesBySite)
}

// RegisterWrite enregistre les routes nécessitant >= manager.
func (h *DevicesHandler) RegisterWrite(g *echo.Group) {
	g.POST("/sites/:id/devices", h.Create)
	g.PUT("/devices/:id", h.Update)
	g.DELETE("/devices/:id", h.Delete)
	g.POST("/devices/:id/measurements", h.PublishMeasurement)
}

type deviceOut struct {
	ID          uuid.UUID  `json:"id"`
	ZoneID      uuid.UUID  `json:"zone_id"`
	SiteID      uuid.UUID  `json:"site_id"`
	Slug        string     `json:"slug"`
	Name        *string    `json:"name,omitempty"`
	Type        string     `json:"type"`
	Category    *string    `json:"category,omitempty"`
	Model       *string    `json:"model,omitempty"`
	Status      string     `json:"status"`
	LastSeen    *time.Time `json:"last_seen_at,omitempty"`
	InstalledAt *time.Time `json:"installed_at,omitempty"`
	// Username MQTT du device — non exposé en API (détail de provisioning).
	// Retourné uniquement à la création via createDeviceResp.MQTTUsername.
	MQTTID   string          `json:"-"`
	Metadata json.RawMessage `json:"metadata,omitempty"`
	ModelID  *uuid.UUID      `json:"model_id,omitempty"`
}

// ensureDeviceVisible vérifie que device appartient au tenant courant et
// retourne ses infos basiques.
func (h *DevicesHandler) ensureDeviceVisible(c echo.Context, id uuid.UUID) (*deviceOut, error) {
	d := &deviceOut{}
	err := h.pool.QueryRow(c.Request().Context(), `
		SELECT d.id, d.zone_id, z.site_id, d.slug, d.name, d.type::text,
		       d.category, d.model, d.status::text, d.last_seen_at, d.installed_at, d.mqtt_id, d.metadata, d.model_id
		FROM devices d
		JOIN zones z ON z.id = d.zone_id
		JOIN sites s ON s.id = z.site_id
		WHERE d.id = $1 AND s.tenant_id = $2`, id, tenantID(c)).
		Scan(&d.ID, &d.ZoneID, &d.SiteID, &d.Slug, &d.Name, &d.Type,
			&d.Category, &d.Model, &d.Status, &d.LastSeen, &d.InstalledAt, &d.MQTTID, &d.Metadata, &d.ModelID)
	if err != nil {
		return nil, apperr.NotFound("device")
	}
	return d, nil
}

func (h *DevicesHandler) Get(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid device id")
	}
	d, err := h.ensureDeviceVisible(c, id)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, d)
}

type latestOut struct {
	Measurement string    `json:"measurement"`
	TS          time.Time `json:"ts"`
	Value       float64   `json:"value"`
	Quality     string    `json:"quality"`
}

func (h *DevicesHandler) Latest(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid device id")
	}
	if _, err := h.ensureDeviceVisible(c, id); err != nil {
		return err
	}

	rows, err := h.pool.Query(c.Request().Context(), `
		SELECT DISTINCT ON (measurement) measurement, ts, value, quality::text
		FROM measurements
		WHERE device_id = $1
		ORDER BY measurement, ts DESC`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query latest", err)
	}
	defer rows.Close()

	out := []latestOut{}
	for rows.Next() {
		var l latestOut
		if err := rows.Scan(&l.Measurement, &l.TS, &l.Value, &l.Quality); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan latest", err)
		}
		out = append(out, l)
	}
	return c.JSON(http.StatusOK, out)
}

type seriesPoint struct {
	TS    time.Time `json:"ts"`
	Value float64   `json:"value"`
	Min   *float64  `json:"min,omitempty"`
	Max   *float64  `json:"max,omitempty"`
}

// Measurements — endpoint principal pour les graphes.
//
//	GET /v1/devices/{id}/measurements?measurement=temperature&from=...&to=...&aggregation=raw|1min|15min|1h|1d
//
// Si aggregation absent, retourne raw. Pour les fenêtres courtes (< 6h),
// raw convient ; pour 24h+, l'UI utilise 15min ou 1h.
func (h *DevicesHandler) Measurements(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid device id")
	}
	measurement := c.QueryParam("measurement")
	if measurement == "" {
		return apperr.Validation("measurement query param required")
	}
	if _, err := h.ensureDeviceVisible(c, id); err != nil {
		return err
	}

	to := time.Now().UTC()
	if t := c.QueryParam("to"); t != "" {
		if parsed, err := time.Parse(time.RFC3339, t); err == nil {
			to = parsed
		}
	}
	from := to.Add(-6 * time.Hour)
	if t := c.QueryParam("from"); t != "" {
		if parsed, err := time.Parse(time.RFC3339, t); err == nil {
			from = parsed
		}
	}
	if from.After(to) {
		return apperr.Validation("from must be before to")
	}

	agg := c.QueryParam("aggregation")
	if agg == "" {
		agg = "raw"
	}
	var query string
	switch agg {
	case "raw":
		query = `SELECT ts, value FROM measurements
			WHERE device_id = $1 AND measurement = $2 AND ts >= $3 AND ts < $4
			ORDER BY ts ASC LIMIT 5000`
	case "1min":
		query = `SELECT bucket AS ts, avg_value, min_value, max_value FROM measurements_1min
			WHERE device_id = $1 AND measurement = $2 AND bucket >= $3 AND bucket < $4
			ORDER BY bucket ASC LIMIT 5000`
	case "15min":
		query = `SELECT bucket AS ts, avg_value, min_value, max_value FROM measurements_15min
			WHERE device_id = $1 AND measurement = $2 AND bucket >= $3 AND bucket < $4
			ORDER BY bucket ASC LIMIT 5000`
	case "1h":
		query = `SELECT bucket AS ts, avg_value, min_value, max_value FROM measurements_1h
			WHERE device_id = $1 AND measurement = $2 AND bucket >= $3 AND bucket < $4
			ORDER BY bucket ASC LIMIT 5000`
	case "1d":
		query = `SELECT bucket AS ts, avg_value, min_value, max_value FROM measurements_1d
			WHERE device_id = $1 AND measurement = $2 AND bucket >= $3 AND bucket < $4
			ORDER BY bucket ASC LIMIT 5000`
	default:
		return apperr.Validation("invalid aggregation (raw|1min|15min|1h|1d)")
	}

	rows, err := h.pool.Query(c.Request().Context(), query, id, measurement, from, to)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query measurements", err)
	}
	defer rows.Close()

	pts := []seriesPoint{}
	for rows.Next() {
		var p seriesPoint
		if agg == "raw" {
			if err := rows.Scan(&p.TS, &p.Value); err != nil {
				return apperr.Wrap(apperr.KindInternal, "scan", err)
			}
		} else {
			if err := rows.Scan(&p.TS, &p.Value, &p.Min, &p.Max); err != nil {
				return apperr.Wrap(apperr.KindInternal, "scan", err)
			}
		}
		pts = append(pts, p)
	}
	return c.JSON(http.StatusOK, map[string]any{
		"measurement": measurement,
		"aggregation": agg,
		"from":        from,
		"to":          to,
		"points":      pts,
	})
}

// ============================================================================
// CRUD Devices + Zones list
// ============================================================================

type zoneOut struct {
	ID           uuid.UUID  `json:"id"`
	SiteID       uuid.UUID  `json:"site_id"`
	ParentZoneID *uuid.UUID `json:"parent_zone_id,omitempty"`
	Slug         string     `json:"slug"`
	Name         string     `json:"name"`
}

func (h *DevicesHandler) ListZonesBySite(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)

	// Vérification appartenance
	var exists bool
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT EXISTS(SELECT 1 FROM sites WHERE id = $1 AND tenant_id = $2)`,
		id, tid).Scan(&exists); err != nil || !exists {
		return apperr.NotFound("site")
	}

	rows, err := h.pool.Query(c.Request().Context(),
		`SELECT id, site_id, parent_zone_id, slug, name FROM zones WHERE site_id = $1 ORDER BY name`,
		id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query zones", err)
	}
	defer rows.Close()
	out := []zoneOut{}
	for rows.Next() {
		var z zoneOut
		if err := rows.Scan(&z.ID, &z.SiteID, &z.ParentZoneID, &z.Slug, &z.Name); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan zone", err)
		}
		out = append(out, z)
	}
	return c.JSON(http.StatusOK, out)
}

type deviceListItem struct {
	deviceOut
	ZoneSlug string `json:"zone_slug"`
	ZoneName string `json:"zone_name"`
}

func (h *DevicesHandler) ListBySite(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	tid := tenantID(c)

	// Filtres optionnels via query string
	cat := c.QueryParam("category")
	typ := c.QueryParam("type")
	status := c.QueryParam("status")

	rows, err := h.pool.Query(c.Request().Context(), `
		SELECT d.id, d.zone_id, z.site_id, d.slug, d.name, d.type::text,
		       d.category, d.model, d.status::text, d.last_seen_at, d.installed_at, d.mqtt_id, d.metadata, d.model_id,
		       z.slug, z.name
		FROM devices d
		JOIN zones z ON z.id = d.zone_id
		JOIN sites s ON s.id = z.site_id
		WHERE z.site_id = $1 AND s.tenant_id = $2
		  AND ($3 = '' OR d.category = $3)
		  AND ($4 = '' OR d.type::text = $4)
		  AND ($5 = '' OR d.status::text = $5)
		ORDER BY z.name, d.slug`, id, tid, cat, typ, status)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query devices", err)
	}
	defer rows.Close()

	out := []deviceListItem{}
	for rows.Next() {
		var d deviceListItem
		if err := rows.Scan(&d.ID, &d.ZoneID, &d.SiteID, &d.Slug, &d.Name, &d.Type,
			&d.Category, &d.Model, &d.Status, &d.LastSeen, &d.InstalledAt, &d.MQTTID, &d.Metadata, &d.ModelID,
			&d.ZoneSlug, &d.ZoneName); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan device", err)
		}
		out = append(out, d)
	}
	return c.JSON(http.StatusOK, out)
}

// --- Création --------------------------------------------------------------

var slugRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

type createDeviceReq struct {
	ZoneID   uuid.UUID       `json:"zone_id"`
	Type     string          `json:"type"`
	Slug     string          `json:"slug"`
	Name     string          `json:"name"`
	Model    string          `json:"model,omitempty"`
	Category string          `json:"category,omitempty"` // libre : "Énergie", "Environnement", ...
	Metadata json.RawMessage `json:"metadata,omitempty"` // JSONB libre — utilisé par les connecteurs externes (IoTSens, ...)
	// Mesures à provisionner dans measurements_metadata. Si vide, on applique
	// les mesures par défaut du type (ex: environment → temperature/humidity/co2/lux).
	Measurements []string `json:"measurements,omitempty"`
	// Si fourni, le modèle catalogue gouverne le provisioning :
	//   - le device.model_id pointe vers le modèle
	//   - les attributs (measurements_metadata) sont automatiquement créés
	//     depuis device_model_attributes (configurable=true)
	//   - les champs Type, Model, Category sont remplis depuis le modèle
	//     s'ils ne sont pas explicitement fournis
	ModelID *uuid.UUID `json:"model_id,omitempty"`
}

type createDeviceResp struct {
	Device deviceOut `json:"device"`
	// Mot de passe MQTT en clair, retourné UNE SEULE FOIS — l'utilisateur
	// doit le copier maintenant. Stocké en bcrypt côté DB ; impossible à
	// récupérer ensuite.
	MQTTPassword string `json:"mqtt_password"`
	MQTTUsername string `json:"mqtt_username"`
}

// defaultMeasurementsFor liste les mesures + bornes par défaut pour un type.
type measSpec struct {
	name string
	unit string
	min  float64
	max  float64
}

func defaultMeasurementsFor(deviceType string) []measSpec {
	switch deviceType {
	case "environment":
		return []measSpec{
			{"temperature", "celsius", -10, 60},
			{"humidity", "percent", 0, 100},
			{"co2", "ppm", 350, 5000},
			{"lux", "lux", 0, 100000},
		}
	case "presence":
		return []measSpec{{"presence", "bool", 0, 1}}
	case "linky":
		return []measSpec{
			{"papp", "VA", 0, 60000},
			{"pact", "watt", 0, 60000},
			{"iinst", "ampere", 0, 400},
			{"urms", "volt", 200, 260},
			{"base", "watt-hour", 0, 1e12},
		}
	case "meter":
		return []measSpec{{"value", "unit", 0, 1e12}}
	default:
		return nil
	}
}

func (h *DevicesHandler) Create(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	var req createDeviceReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	// Slug est optionnel : si fourni, on valide le format ; sinon on le
	// génère après avoir résolu le modèle (cf. plus bas).
	if req.Slug != "" && !slugRegex.MatchString(req.Slug) {
		return apperr.Validation("slug must match [a-z0-9][a-z0-9_-]*")
	}
	// Si type fourni, valider tout de suite. Sinon il sera dérivé du modèle.
	if req.Type != "" {
		switch req.Type {
		case "environment", "presence", "actuator", "linky", "meter", "gateway":
		default:
			return apperr.Validation("invalid device type")
		}
	} else if req.ModelID == nil {
		return apperr.Validation("type is required (or use model_id)")
	}

	ctx := c.Request().Context()
	tid := tenantID(c)

	// Vérifier que la zone appartient au site qui appartient au tenant
	var zoneSiteID uuid.UUID
	err = h.pool.QueryRow(ctx, `
		SELECT z.site_id FROM zones z
		JOIN sites s ON s.id = z.site_id
		WHERE z.id = $1 AND s.tenant_id = $2 AND z.site_id = $3`,
		req.ZoneID, tid, siteID).Scan(&zoneSiteID)
	if err != nil {
		return apperr.NotFound("zone (must belong to this site)")
	}

	// Génération mqtt_id + password
	rb := make([]byte, 6)
	if _, err := rand.Read(rb); err != nil {
		return apperr.Wrap(apperr.KindInternal, "rand", err)
	}
	// mqttID sera complété avec finalSlug une fois celui-ci connu (plus bas).
	mqttIDSuffix := base64.RawURLEncoding.EncodeToString(rb)

	pwBytes := make([]byte, 24)
	if _, err := rand.Read(pwBytes); err != nil {
		return apperr.Wrap(apperr.KindInternal, "rand", err)
	}
	mqttPassword := base64.RawURLEncoding.EncodeToString(pwBytes)
	hash, err := bcrypt.GenerateFromPassword([]byte(mqttPassword), 10)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "bcrypt", err)
	}

	// Transaction : insert device + measurements_metadata
	tx, err := h.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin tx", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Default metadata = {} (jsonb non-null requis par schema)
	metaBytes := []byte(req.Metadata)
	if len(metaBytes) == 0 {
		metaBytes = []byte("{}")
	}

	// Si model_id fourni : on charge le modèle catalogue et on remplit les
	// champs Type / Category / Model si l'utilisateur ne les a pas explicitement
	// fournis. Le device.type doit aussi être remplit selon le mapping
	// category → device_type (env→environment, énergie→linky/meter, etc.) si
	// non fourni.
	var modelID *uuid.UUID
	deviceType := req.Type
	deviceCategory := req.Category
	deviceModelLabel := req.Model
	var modelBrand, modelCode string
	if req.ModelID != nil {
		var modelCategory string
		var modelProtocol *string
		err := tx.QueryRow(ctx, `
			SELECT brand, code, category, protocol
			FROM device_models WHERE id = $1`, *req.ModelID).
			Scan(&modelBrand, &modelCode, &modelCategory, &modelProtocol)
		if err != nil {
			return apperr.Validation("device model not found")
		}
		modelID = req.ModelID
		if deviceCategory == "" {
			deviceCategory = modelCategory
		}
		if deviceModelLabel == "" {
			deviceModelLabel = modelBrand + " " + modelCode
		}
		if deviceType == "" {
			deviceType = inferDeviceTypeFromCategory(modelCategory)
		}
	}
	if deviceType == "" {
		return apperr.Validation("type is required (or use a model_id that defines it)")
	}

	// Slug : si non fourni, on le génère depuis le nom (ou la marque/code du
	// modèle), avec un suffixe hex unique au sein de la zone.
	finalSlug := req.Slug
	if finalSlug == "" {
		generated, err := h.generateUniqueSlug(ctx, req.ZoneID, req.Name, modelBrand, modelCode)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "generate slug", err)
		}
		finalSlug = generated
	}
	mqttID := "dev_" + finalSlug + "_" + mqttIDSuffix

	var d deviceOut
	err = tx.QueryRow(ctx, `
		INSERT INTO devices (zone_id, type, model, slug, name, category, mqtt_id, mqtt_password_hash, status, installed_at, metadata, model_id)
		VALUES ($1, $2::device_type, $3, $4, $5, $6, $7, $8, 'provisioned', now(), $9::jsonb, $10)
		RETURNING id, zone_id, slug, name, type::text, category, model, status::text, last_seen_at, installed_at, mqtt_id, metadata, model_id`,
		req.ZoneID, deviceType, nullableText(deviceModelLabel), finalSlug, nullableText(req.Name),
		nullableText(deviceCategory), mqttID, string(hash), metaBytes, modelID,
	).Scan(&d.ID, &d.ZoneID, &d.Slug, &d.Name, &d.Type, &d.Category, &d.Model, &d.Status, &d.LastSeen, &d.InstalledAt, &d.MQTTID, &d.Metadata, &d.ModelID)
	if err != nil {
		if isUniqueViolation(err) {
			return apperr.Conflict("a device with this slug already exists in this zone")
		}
		return apperr.Wrap(apperr.KindInternal, "insert device", err)
	}
	d.SiteID = siteID

	// --- Provisionning des measurements_metadata ---
	// Source de vérité prioritaire :
	//   1. ModelID → on copie depuis device_model_attributes (où configurable=true)
	//   2. sinon, defaultMeasurementsFor(type) (rétrocompat avec ancien chemin)
	// `req.Measurements`, si fourni, agit comme filtre (ne provisionne que ces mesures-là).
	wantFilter := map[string]bool{}
	for _, m := range req.Measurements {
		wantFilter[strings.ToLower(strings.TrimSpace(m))] = true
	}
	hasFilter := len(wantFilter) > 0

	if modelID != nil {
		rows, err := tx.Query(ctx, `
			SELECT name, unit, min_value, max_value, description
			FROM device_model_attributes
			WHERE device_model_id = $1 AND configurable = TRUE`, *modelID)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "load model attrs", err)
		}
		type attrRow struct {
			name, unit  string
			min, max    *float64
			description *string
		}
		var attrs []attrRow
		for rows.Next() {
			var a attrRow
			if err := rows.Scan(&a.name, &a.unit, &a.min, &a.max, &a.description); err != nil {
				rows.Close()
				return apperr.Wrap(apperr.KindInternal, "scan model attr", err)
			}
			attrs = append(attrs, a)
		}
		rows.Close()
		for _, a := range attrs {
			if hasFilter && !wantFilter[a.name] {
				continue
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO measurements_metadata (device_id, measurement, unit, min_value, max_value, description)
				VALUES ($1, $2, $3, $4, $5, $6)`,
				d.ID, a.name, a.unit, a.min, a.max, a.description); err != nil {
				return apperr.Wrap(apperr.KindInternal, "insert measurement metadata (from model)", err)
			}
		}
	} else {
		specs := defaultMeasurementsFor(deviceType)
		for _, s := range specs {
			if hasFilter && !wantFilter[s.name] {
				continue
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO measurements_metadata (device_id, measurement, unit, min_value, max_value)
				VALUES ($1, $2, $3, $4, $5)`,
				d.ID, s.name, s.unit, s.min, s.max); err != nil {
				return apperr.Wrap(apperr.KindInternal, "insert measurement metadata", err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit", err)
	}

	return c.JSON(http.StatusCreated, createDeviceResp{
		Device:       d,
		MQTTUsername: mqttID,
		MQTTPassword: mqttPassword,
	})
}

// --- Update / Delete -------------------------------------------------------

type updateDeviceReq struct {
	Name     *string    `json:"name,omitempty"`
	Model    *string    `json:"model,omitempty"`
	Category *string    `json:"category,omitempty"`
	Status   *string    `json:"status,omitempty"` // 'online'|'offline'|'disabled'
	ZoneID   *uuid.UUID `json:"zone_id,omitempty"`
}

func (h *DevicesHandler) Update(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid device id")
	}
	var req updateDeviceReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}

	ctx := c.Request().Context()
	current, err := h.ensureDeviceVisible(c, id)
	if err != nil {
		return err
	}

	if req.Status != nil {
		switch *req.Status {
		case "online", "offline", "disabled":
		default:
			return apperr.Validation("invalid status")
		}
	}

	// Si on déplace le device : vérifier que la zone cible existe et est dans
	// le MÊME site (anti cross-site smuggling). Refuser aussi si une autre
	// device avec le même slug existe déjà dans la zone cible (contrainte
	// UNIQUE (zone_id, slug) en DB).
	if req.ZoneID != nil && *req.ZoneID != current.ZoneID {
		var targetSiteID uuid.UUID
		tid := tenantID(c)
		if err := h.pool.QueryRow(ctx, `
			SELECT z.site_id FROM zones z
			JOIN sites s ON s.id = z.site_id
			WHERE z.id = $1 AND s.tenant_id = $2`, *req.ZoneID, tid).Scan(&targetSiteID); err != nil {
			return apperr.Validation("zone cible introuvable dans ce tenant")
		}
		if targetSiteID != current.SiteID {
			return apperr.Validation("impossible de déplacer un équipement vers un autre site")
		}
		var slugExists bool
		if err := h.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM devices WHERE zone_id = $1 AND slug = $2 AND id != $3)`,
			*req.ZoneID, current.Slug, id).Scan(&slugExists); err == nil && slugExists {
			return apperr.Validation("un équipement avec ce slug existe déjà dans la zone cible")
		}
	}

	_, err = h.pool.Exec(ctx, `
		UPDATE devices SET
		  name     = COALESCE($2, name),
		  model    = COALESCE($3, model),
		  category = COALESCE($4, category),
		  status   = COALESCE($5::device_status, status),
		  zone_id  = COALESCE($6, zone_id),
		  updated_at = now()
		WHERE id = $1`, id, req.Name, req.Model, req.Category, req.Status, req.ZoneID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "update device", err)
	}

	d, err := h.ensureDeviceVisible(c, id)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, d)
}

func (h *DevicesHandler) Delete(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid device id")
	}
	if _, err := h.ensureDeviceVisible(c, id); err != nil {
		return err
	}
	if _, err := h.pool.Exec(c.Request().Context(), `DELETE FROM devices WHERE id = $1`, id); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete device", err)
	}
	return c.NoContent(http.StatusNoContent)
}

// --- helpers ---------------------------------------------------------------

func nullableText(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// slugify normalise une chaîne en slug compatible avec l'enum slug ZEINA :
// lowercase, accents supprimés, séparateurs et caractères non-[a-z0-9_-]
// remplacés par "-", "-" multiples collapsés, trim. Retourne "" si rien
// d'utilisable.
func slugify(s string) string {
	if s == "" {
		return ""
	}
	repl := strings.NewReplacer(
		"à", "a", "â", "a", "ä", "a", "á", "a", "ã", "a", "å", "a", "æ", "ae",
		"è", "e", "é", "e", "ê", "e", "ë", "e",
		"ì", "i", "í", "i", "î", "i", "ï", "i",
		"ò", "o", "ó", "o", "ô", "o", "ö", "o", "õ", "o", "œ", "oe",
		"ù", "u", "ú", "u", "û", "u", "ü", "u",
		"ý", "y", "ÿ", "y", "ñ", "n", "ç", "c", "ß", "ss",
		"À", "a", "Â", "a", "Ä", "a", "Á", "a", "Ã", "a", "Å", "a",
		"È", "e", "É", "e", "Ê", "e", "Ë", "e",
		"Ì", "i", "Í", "i", "Î", "i", "Ï", "i",
		"Ò", "o", "Ó", "o", "Ô", "o", "Ö", "o", "Õ", "o",
		"Ù", "u", "Ú", "u", "Û", "u", "Ü", "u",
		"Ý", "y", "Ñ", "n", "Ç", "c",
	)
	s = strings.ToLower(repl.Replace(s))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	out := b.String()
	for strings.Contains(out, "--") {
		out = strings.ReplaceAll(out, "--", "-")
	}
	out = strings.Trim(out, "-_")
	if len(out) == 0 || !slugRegex.MatchString(out) {
		return ""
	}
	if len(out) > 50 {
		out = strings.TrimRight(out[:50], "-_")
	}
	return out
}

// generateUniqueSlug construit un slug pour un nouveau device. Stratégie :
//
//	base = slugify(name) ou slugify("brand-code"), puis suffixe hex 4 chars.
//
// Vérifie l'absence de collision dans la zone (UNIQUE(zone_id, slug)).
func (h *DevicesHandler) generateUniqueSlug(ctx context.Context, zoneID uuid.UUID, name, modelBrand, modelCode string) (string, error) {
	base := slugify(name)
	if base == "" {
		base = slugify(modelBrand + "-" + modelCode)
	}
	if base == "" {
		base = "device"
	}
	for attempt := 0; attempt < 5; attempt++ {
		buf := make([]byte, 2)
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		candidate := base + "-" + hex.EncodeToString(buf)
		var exists bool
		if err := h.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM devices WHERE zone_id = $1 AND slug = $2)`,
			zoneID, candidate).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("could not generate unique slug after 5 attempts")
}

// inferDeviceTypeFromCategory mappe la catégorie métier d'un modèle vers le
// type technique du device (enum device_type côté SQL). Heuristique :
//
//	Environnement → environment ; Énergie → linky (Wh) ; Mouvement → presence ;
//	Éclairage / Climatisation → actuator. Inconnu → "" (l'appelant doit alors
//	exiger que `type` soit fourni explicitement).
func inferDeviceTypeFromCategory(category string) string {
	switch strings.ToLower(strings.TrimSpace(category)) {
	case "environnement":
		return "environment"
	case "énergie", "energie":
		return "linky"
	case "mouvement", "présence", "presence":
		return "presence"
	case "éclairage", "eclairage", "climatisation":
		return "actuator"
	default:
		return ""
	}
}

func isUniqueViolation(err error) bool {
	// pg error code 23505 = unique_violation
	return err != nil && (strings.Contains(err.Error(), "23505") || strings.Contains(err.Error(), "unique"))
}

// jsonRaw — utilitaire pour les payloads sans struct dédié.
//
//nolint:unused
func jsonRaw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// ----------------------------------------------------------------------------
// Measurements metadata — liste des mesures provisionnées pour un device,
// avec leurs unité + bornes. Sert à la page DeviceDetail pour afficher un
// mini-widget par mesure même quand il n'y a pas encore de données.
// ----------------------------------------------------------------------------

type measurementMeta struct {
	Measurement string   `json:"measurement"`
	Unit        string   `json:"unit"`
	MinValue    *float64 `json:"min_value,omitempty"`
	MaxValue    *float64 `json:"max_value,omitempty"`
	Description *string  `json:"description,omitempty"`
}

func (h *DevicesHandler) MeasurementsMetadata(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid device id")
	}
	if _, err := h.ensureDeviceVisible(c, id); err != nil {
		return err
	}
	rows, err := h.pool.Query(c.Request().Context(), `
		SELECT measurement, unit, min_value, max_value, description
		FROM measurements_metadata
		WHERE device_id = $1
		ORDER BY measurement`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query metadata", err)
	}
	defer rows.Close()
	out := []measurementMeta{}
	for rows.Next() {
		var m measurementMeta
		if err := rows.Scan(&m.Measurement, &m.Unit, &m.MinValue, &m.MaxValue, &m.Description); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan metadata", err)
		}
		out = append(out, m)
	}
	return c.JSON(http.StatusOK, out)
}

// ----------------------------------------------------------------------------
// POST /v1/devices/:id/measurements
//
// Publie une mesure pour le device sur MQTT (au format ZEINA). L'ingestor
// la consomme comme n'importe quelle autre mesure → stockage TimescaleDB +
// broadcast WebSocket → mise à jour live dans les widgets.
//
// Utile pour :
//   - tester rapidement depuis Postman/curl
//   - intégrer un système qui ne sait pas faire MQTT (HTTP-only)
//   - injecter des mesures de calibration / debug
//
// Body :
//   {
//     "measurement": "temperature",   // requis
//     "value":       23.4,            // requis
//     "ts":          "2026-05-06T...", // optionnel — défaut now() UTC
//     "unit":        "celsius",       // optionnel — informatif
//     "quality":     "good"           // optionnel — défaut "good"
//   }
// ----------------------------------------------------------------------------

type publishMeasurementReq struct {
	Measurement string    `json:"measurement"`
	Value       float64   `json:"value"`
	TS          time.Time `json:"ts,omitempty"`
	Unit        string    `json:"unit,omitempty"`
	Quality     string    `json:"quality,omitempty"`
}

type publishMeasurementResp struct {
	Topic       string    `json:"topic"`
	TS          time.Time `json:"ts"`
	Measurement string    `json:"measurement"`
	Value       float64   `json:"value"`
}

func (h *DevicesHandler) PublishMeasurement(c echo.Context) error {
	if h.mqtt == nil {
		return apperr.New(apperr.KindUnavailable, "MQTT publisher not configured")
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid device id")
	}
	var req publishMeasurementReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if !measurementSlugRegex.MatchString(req.Measurement) {
		return apperr.Validation("measurement must match [a-z0-9][a-z0-9_-]*")
	}

	ctx := c.Request().Context()
	tid := tenantID(c)

	// Récupère les slugs pour reconstruire le topic
	var siteSlug, zoneSlug, deviceSlug string
	err = h.pool.QueryRow(ctx, `
		SELECT s.slug, z.slug, d.slug
		FROM devices d
		JOIN zones z ON z.id = d.zone_id
		JOIN sites s ON s.id = z.site_id
		WHERE d.id = $1 AND s.tenant_id = $2`,
		id, tid).Scan(&siteSlug, &zoneSlug, &deviceSlug)
	if err != nil {
		return apperr.NotFound("device")
	}

	if req.TS.IsZero() {
		req.TS = time.Now().UTC()
	}
	q := domain.QualityGood
	if req.Quality != "" {
		q = domain.Quality(req.Quality)
		if !q.Valid() {
			return apperr.Validation("invalid quality (good|uncertain|bad)")
		}
	}

	topic, err := topics.BuildMeasurementTopic(h.tenantSlug, siteSlug, zoneSlug, deviceSlug, req.Measurement)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "build topic", err)
	}
	payload := domain.Payload{TS: req.TS, Value: req.Value, Unit: req.Unit, Quality: q}
	body, err := payload.Encode()
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "encode payload", err)
	}
	if err := h.mqtt.Publish(ctx, topic, 0, false, body); err != nil {
		return apperr.Wrap(apperr.KindUnavailable, "publish mqtt", err)
	}

	return c.JSON(http.StatusAccepted, publishMeasurementResp{
		Topic: topic, TS: req.TS, Measurement: req.Measurement, Value: req.Value,
	})
}

var measurementSlugRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)
