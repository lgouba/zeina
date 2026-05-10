package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"
	mw "github.com/zeina/hyperviseur/services/api/internal/middleware"
)

// AlarmsHandler — endpoints pour la liste / le détail / les transitions d'état
// (acknowledge / resolve / archive) des alarmes générées par le moteur.
type AlarmsHandler struct {
	pool *pgxpool.Pool
}

func NewAlarmsHandler(pool *pgxpool.Pool) *AlarmsHandler {
	return &AlarmsHandler{pool: pool}
}

func (h *AlarmsHandler) RegisterReadOnly(g *echo.Group) {
	g.GET("/sites/:id/alarms", h.ListBySite)
	g.GET("/sites/:id/alarms/counts", h.Counts)
	g.GET("/alarms/:id", h.Get)
	g.GET("/alarms/:id/events", h.ListEvents)
	g.GET("/alarms/:id/comments", h.ListComments)
}

func (h *AlarmsHandler) RegisterWrite(g *echo.Group) {
	g.POST("/alarms/:id/acknowledge", h.Acknowledge)
	g.POST("/alarms/:id/resolve", h.Resolve)
	g.POST("/alarms/:id/archive", h.Archive)
	g.POST("/alarms/:id/comments", h.AddComment)
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type alarmOut struct {
	ID               uuid.UUID  `json:"id"`
	TenantID         uuid.UUID  `json:"tenant_id"`
	SiteID           uuid.UUID  `json:"site_id"`
	RuleID           uuid.UUID  `json:"rule_id"`
	RuleName         string     `json:"rule_name"`
	DeviceID         *uuid.UUID `json:"device_id,omitempty"`
	DeviceSlug       *string    `json:"device_slug,omitempty"`
	DeviceName       *string    `json:"device_name,omitempty"`
	ZoneID           *uuid.UUID `json:"zone_id,omitempty"`
	ZoneName         *string    `json:"zone_name,omitempty"`
	Label            string     `json:"label"`
	Name             string     `json:"name"`
	Description      *string    `json:"description,omitempty"`
	Severity         string     `json:"severity"`
	Model            string     `json:"model"`
	StatusText       *string    `json:"status_text,omitempty"`
	State            string     `json:"state"`
	Attribute        *string    `json:"attribute,omitempty"`
	TriggerCount     int        `json:"trigger_count"`
	LastValue        *float64   `json:"last_value,omitempty"`
	Unit             *string    `json:"unit,omitempty"`
	OpenedAt         time.Time  `json:"opened_at"`
	LastTriggeredAt  time.Time  `json:"last_triggered_at"`
	AckedAt          *time.Time `json:"acked_at,omitempty"`
	ResolvedAt       *time.Time `json:"resolved_at,omitempty"`
	ArchivedAt       *time.Time `json:"archived_at,omitempty"`
	AckUserEmail     *string    `json:"ack_user_email,omitempty"`
	ResolveUserEmail *string    `json:"resolve_user_email,omitempty"`
}

type alarmEventOut struct {
	ID           uuid.UUID `json:"id"`
	AlarmID      uuid.UUID `json:"alarm_id"`
	TS           time.Time `json:"ts"`
	State        string    `json:"state"`
	Severity     string    `json:"severity"`
	Description  *string   `json:"description,omitempty"`
	TriggerCount *int      `json:"trigger_count,omitempty"`
	Value        *float64  `json:"value,omitempty"`
	UserEmail    *string   `json:"user_email,omitempty"`
}

type alarmCommentOut struct {
	ID        uuid.UUID `json:"id"`
	AlarmID   uuid.UUID `json:"alarm_id"`
	UserEmail *string   `json:"user_email,omitempty"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}

type alarmCountsOut struct {
	Triggered    int `json:"triggered"`
	Acknowledged int `json:"acknowledged"`
	Resolved     int `json:"resolved"`
	Archived     int `json:"archived"`
	Active       int `json:"active"` // triggered + acknowledged
	All          int `json:"all"`
}

// ----------------------------------------------------------------------------
// Endpoints
// ----------------------------------------------------------------------------

// GET /v1/sites/:id/alarms?state=triggered&search=...&limit=100
//
// `state` peut être : triggered | acknowledged | resolved | archived | active | all
//   - active = triggered ∪ acknowledged (filtre par défaut côté UI)
//   - all    = toutes
func (h *AlarmsHandler) ListBySite(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	state := strings.ToLower(c.QueryParam("state"))
	search := strings.ToLower(strings.TrimSpace(c.QueryParam("search")))
	limit := 200
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}

	var stateClause string
	switch state {
	case "triggered", "acknowledged", "resolved", "archived":
		stateClause = "AND a.state = $2"
	case "", "active":
		stateClause = "AND a.state IN ('triggered','acknowledged')"
	case "all":
		stateClause = ""
	default:
		return apperr.Validation("invalid state")
	}

	q := `
		SELECT a.id, a.tenant_id, a.site_id, a.rule_id, r.name,
		       a.device_id, d.slug, d.name,
		       a.zone_id, z.name,
		       a.label, a.name, a.description, a.severity::text, a.model, a.status_text,
		       a.state::text, a.attribute, a.trigger_count, a.last_value, a.unit,
		       a.opened_at, a.last_triggered_at, a.acked_at, a.resolved_at, a.archived_at,
		       u_ack.email, u_res.email
		FROM alarms a
		JOIN rules r          ON r.id = a.rule_id
		LEFT JOIN devices d   ON d.id = a.device_id
		LEFT JOIN zones z     ON z.id = a.zone_id
		LEFT JOIN users u_ack ON u_ack.id = a.ack_user_id
		LEFT JOIN users u_res ON u_res.id = a.resolve_user_id
		WHERE a.site_id = $1 ` + stateClause + `
		ORDER BY a.opened_at DESC
		LIMIT ` + strconv.Itoa(limit)

	args := []any{siteID}
	if stateClause != "" && state != "" && state != "active" && state != "all" {
		args = append(args, state)
	}

	rows, err := h.pool.Query(c.Request().Context(), q, args...)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list alarms", err)
	}
	defer rows.Close()

	out := []alarmOut{}
	for rows.Next() {
		var a alarmOut
		if err := rows.Scan(
			&a.ID, &a.TenantID, &a.SiteID, &a.RuleID, &a.RuleName,
			&a.DeviceID, &a.DeviceSlug, &a.DeviceName,
			&a.ZoneID, &a.ZoneName,
			&a.Label, &a.Name, &a.Description, &a.Severity, &a.Model, &a.StatusText,
			&a.State, &a.Attribute, &a.TriggerCount, &a.LastValue, &a.Unit,
			&a.OpenedAt, &a.LastTriggeredAt, &a.AckedAt, &a.ResolvedAt, &a.ArchivedAt,
			&a.AckUserEmail, &a.ResolveUserEmail,
		); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan alarm", err)
		}
		// Filtre search côté serveur — match sur name/rule_name/device_name/zone_name.
		if search != "" {
			hay := strings.ToLower(a.Name) + " " + strings.ToLower(a.RuleName)
			if a.DeviceName != nil {
				hay += " " + strings.ToLower(*a.DeviceName)
			}
			if a.ZoneName != nil {
				hay += " " + strings.ToLower(*a.ZoneName)
			}
			if !strings.Contains(hay, search) {
				continue
			}
		}
		out = append(out, a)
	}
	return c.JSON(http.StatusOK, out)
}

// GET /v1/sites/:id/alarms/counts — compteurs par état pour les onglets UI.
func (h *AlarmsHandler) Counts(c echo.Context) error {
	siteID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid site id")
	}
	var counts alarmCountsOut
	err = h.pool.QueryRow(c.Request().Context(), `
		SELECT
		  COUNT(*) FILTER (WHERE state = 'triggered'),
		  COUNT(*) FILTER (WHERE state = 'acknowledged'),
		  COUNT(*) FILTER (WHERE state = 'resolved'),
		  COUNT(*) FILTER (WHERE state = 'archived'),
		  COUNT(*) FILTER (WHERE state IN ('triggered','acknowledged')),
		  COUNT(*)
		FROM alarms WHERE site_id = $1`, siteID).Scan(
		&counts.Triggered, &counts.Acknowledged, &counts.Resolved, &counts.Archived,
		&counts.Active, &counts.All,
	)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "alarm counts", err)
	}
	return c.JSON(http.StatusOK, counts)
}

// GET /v1/alarms/:id — détail d'une alarme.
func (h *AlarmsHandler) Get(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid alarm id")
	}
	var a alarmOut
	err = h.pool.QueryRow(c.Request().Context(), `
		SELECT a.id, a.tenant_id, a.site_id, a.rule_id, r.name,
		       a.device_id, d.slug, d.name,
		       a.zone_id, z.name,
		       a.label, a.name, a.description, a.severity::text, a.model, a.status_text,
		       a.state::text, a.attribute, a.trigger_count, a.last_value, a.unit,
		       a.opened_at, a.last_triggered_at, a.acked_at, a.resolved_at, a.archived_at,
		       u_ack.email, u_res.email
		FROM alarms a
		JOIN rules r          ON r.id = a.rule_id
		LEFT JOIN devices d   ON d.id = a.device_id
		LEFT JOIN zones z     ON z.id = a.zone_id
		LEFT JOIN users u_ack ON u_ack.id = a.ack_user_id
		LEFT JOIN users u_res ON u_res.id = a.resolve_user_id
		WHERE a.id = $1`, id).Scan(
		&a.ID, &a.TenantID, &a.SiteID, &a.RuleID, &a.RuleName,
		&a.DeviceID, &a.DeviceSlug, &a.DeviceName,
		&a.ZoneID, &a.ZoneName,
		&a.Label, &a.Name, &a.Description, &a.Severity, &a.Model, &a.StatusText,
		&a.State, &a.Attribute, &a.TriggerCount, &a.LastValue, &a.Unit,
		&a.OpenedAt, &a.LastTriggeredAt, &a.AckedAt, &a.ResolvedAt, &a.ArchivedAt,
		&a.AckUserEmail, &a.ResolveUserEmail,
	)
	if err == pgx.ErrNoRows {
		return apperr.NotFound("alarm")
	}
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "get alarm", err)
	}
	return c.JSON(http.StatusOK, a)
}

// GET /v1/alarms/:id/events
func (h *AlarmsHandler) ListEvents(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid alarm id")
	}
	rows, err := h.pool.Query(c.Request().Context(), `
		SELECT e.id, e.alarm_id, e.ts, e.state::text, e.severity::text,
		       e.description, e.trigger_count, e.value, u.email
		FROM alarm_events e
		LEFT JOIN users u ON u.id = e.user_id
		WHERE e.alarm_id = $1
		ORDER BY e.ts DESC
		LIMIT 500`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list events", err)
	}
	defer rows.Close()
	out := []alarmEventOut{}
	for rows.Next() {
		var e alarmEventOut
		if err := rows.Scan(&e.ID, &e.AlarmID, &e.TS, &e.State, &e.Severity,
			&e.Description, &e.TriggerCount, &e.Value, &e.UserEmail); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan event", err)
		}
		out = append(out, e)
	}
	return c.JSON(http.StatusOK, out)
}

// GET /v1/alarms/:id/comments
func (h *AlarmsHandler) ListComments(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid alarm id")
	}
	rows, err := h.pool.Query(c.Request().Context(), `
		SELECT c.id, c.alarm_id, COALESCE(u.email, c.user_email), c.body, c.created_at
		FROM alarm_comments c
		LEFT JOIN users u ON u.id = c.user_id
		WHERE c.alarm_id = $1
		ORDER BY c.created_at DESC
		LIMIT 500`, id)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list comments", err)
	}
	defer rows.Close()
	out := []alarmCommentOut{}
	for rows.Next() {
		var c alarmCommentOut
		if err := rows.Scan(&c.ID, &c.AlarmID, &c.UserEmail, &c.Body, &c.CreatedAt); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan comment", err)
		}
		out = append(out, c)
	}
	return c.JSON(http.StatusOK, out)
}

// POST /v1/alarms/:id/acknowledge — passe l'alarme en `acknowledged` et logue
// un alarm_event. No-op si déjà ack/resolved.
func (h *AlarmsHandler) Acknowledge(c echo.Context) error {
	return h.transition(c, "acknowledged", "Prise en compte")
}

// POST /v1/alarms/:id/resolve — passe l'alarme en `resolved`.
func (h *AlarmsHandler) Resolve(c echo.Context) error {
	return h.transition(c, "resolved", "Acquittée")
}

// POST /v1/alarms/:id/archive — passe l'alarme en `archived`.
func (h *AlarmsHandler) Archive(c echo.Context) error {
	return h.transition(c, "archived", "Archivée")
}

func (h *AlarmsHandler) transition(c echo.Context, target, label string) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid alarm id")
	}
	claims, _ := c.Get(mw.CtxKeyClaims).(*jwt.Claims)
	var userID *uuid.UUID
	if claims != nil {
		uid, err := uuid.Parse(claims.Subject)
		if err == nil {
			userID = &uid
		}
	}

	// Met à jour l'alarme + insère l'évènement en transaction.
	tx, err := h.pool.Begin(c.Request().Context())
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "begin tx", err)
	}
	defer func() { _ = tx.Rollback(c.Request().Context()) }()

	var setExtra string
	switch target {
	case "acknowledged":
		setExtra = ", acked_at = COALESCE(acked_at, now()), ack_user_id = $3"
	case "resolved":
		setExtra = ", resolved_at = COALESCE(resolved_at, now()), resolve_user_id = $3"
	case "archived":
		setExtra = ", archived_at = COALESCE(archived_at, now())"
	}

	args := []any{id, target}
	if target != "archived" {
		args = append(args, userID)
	}

	row := tx.QueryRow(c.Request().Context(), `
		UPDATE alarms
		SET state = $2::alarm_state, updated_at = now() `+setExtra+`
		WHERE id = $1
		RETURNING severity::text, trigger_count`, args...)
	var severity string
	var triggerCount int
	if err := row.Scan(&severity, &triggerCount); err != nil {
		if err == pgx.ErrNoRows {
			return apperr.NotFound("alarm")
		}
		return apperr.Wrap(apperr.KindInternal, "update alarm", err)
	}

	// Évènement de transition : on volontairement n'enregistre PAS la valeur de
	// mesure (`value` = NULL) — elle ne change pas lors d'un ack/resolve/archive,
	// donc la répéter dans la timeline parasite la lecture.
	_, err = tx.Exec(c.Request().Context(), `
		INSERT INTO alarm_events (alarm_id, state, severity, description, trigger_count, value, user_id)
		VALUES ($1, $2::alarm_state, $3::alarm_severity, $4, $5, NULL, $6)`,
		id, target, severity, label, triggerCount, userID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "insert event", err)
	}
	if err := tx.Commit(c.Request().Context()); err != nil {
		return apperr.Wrap(apperr.KindInternal, "commit", err)
	}
	return c.JSON(http.StatusOK, map[string]string{"state": target})
}

// POST /v1/alarms/:id/comments
func (h *AlarmsHandler) AddComment(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid alarm id")
	}
	var req struct {
		Body string `json:"body"`
	}
	if err := c.Bind(&req); err != nil || strings.TrimSpace(req.Body) == "" {
		return apperr.Validation("body required")
	}
	claims, _ := c.Get(mw.CtxKeyClaims).(*jwt.Claims)
	var userID *uuid.UUID
	var userEmail *string
	if claims != nil {
		if uid, err := uuid.Parse(claims.Subject); err == nil {
			userID = &uid
			// Récupère l'email depuis la table users pour le snapshot.
			var email string
			if err := h.pool.QueryRow(c.Request().Context(), `SELECT email FROM users WHERE id = $1`, uid).Scan(&email); err == nil {
				userEmail = &email
			}
		}
	}
	var out alarmCommentOut
	err = h.pool.QueryRow(c.Request().Context(), `
		INSERT INTO alarm_comments (alarm_id, user_id, user_email, body)
		VALUES ($1, $2, $3, $4)
		RETURNING id, alarm_id, user_email, body, created_at`,
		id, userID, userEmail, strings.TrimSpace(req.Body),
	).Scan(&out.ID, &out.AlarmID, &out.UserEmail, &out.Body, &out.CreatedAt)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "insert comment", err)
	}
	return c.JSON(http.StatusCreated, out)
}

// Empêche dependency unused warning sur encoding/json.
var _ = json.Marshal
