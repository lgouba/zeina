package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/zeina/hyperviseur/packages/shared/domain"
	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"
	sharedmqtt "github.com/zeina/hyperviseur/packages/shared/mqtt"
	"github.com/zeina/hyperviseur/packages/shared/topics"
	mw "github.com/zeina/hyperviseur/services/api/internal/middleware"
)

type CommandsHandler struct {
	pool   *pgxpool.Pool
	mqtt   *sharedmqtt.Client
	tenant string // tenant slug pour construire le topic
}

func NewCommandsHandler(pool *pgxpool.Pool, mqttClient *sharedmqtt.Client, tenantSlug string) *CommandsHandler {
	return &CommandsHandler{pool: pool, mqtt: mqttClient, tenant: tenantSlug}
}

func (h *CommandsHandler) Register(g *echo.Group) {
	g.POST("/devices/:id/command", h.Send)
}

type cmdReq struct {
	Action  string          `json:"action"` // ex: "set"
	Payload json.RawMessage `json:"payload"`
}

type cmdResp struct {
	CommandID uuid.UUID `json:"command_id"`
	Topic     string    `json:"topic"`
	IssuedAt  time.Time `json:"issued_at"`
}

func (h *CommandsHandler) Send(c echo.Context) error {
	deviceID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid device id")
	}
	var req cmdReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if req.Action == "" || len(req.Payload) == 0 {
		return apperr.Validation("action and payload are required")
	}

	ctx := c.Request().Context()
	tid := tenantID(c)

	// Fetch device with site/zone slugs pour construire le topic
	var (
		zoneSlug, siteSlug, deviceSlug string
		deviceType                     string
	)
	err = h.pool.QueryRow(ctx, `
		SELECT z.slug, s.slug, d.slug, d.type::text
		FROM devices d
		JOIN zones z ON z.id = d.zone_id
		JOIN sites s ON s.id = z.site_id
		WHERE d.id = $1 AND s.tenant_id = $2`, deviceID, tid).
		Scan(&zoneSlug, &siteSlug, &deviceSlug, &deviceType)
	if err != nil {
		return apperr.NotFound("device")
	}
	if deviceType != "actuator" {
		return apperr.Validation("device is not commandable")
	}

	// Insert command (status=pending)
	claims, _ := c.Get(mw.CtxKeyClaims).(*jwt.Claims)
	var issuedBy *uuid.UUID
	if claims != nil {
		if uid, err := uuid.Parse(claims.Subject); err == nil {
			issuedBy = &uid
		}
	}

	var cmdID uuid.UUID
	var issuedAt time.Time
	err = h.pool.QueryRow(ctx, `
		INSERT INTO commands (device_id, action, payload, status, issued_by)
		VALUES ($1, $2, $3, 'pending', $4)
		RETURNING id, issued_at`,
		deviceID, req.Action, []byte(req.Payload), issuedBy).Scan(&cmdID, &issuedAt)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "insert command", err)
	}

	// Publish MQTT
	topic, err := topics.BuildCommandTopic(h.tenant, siteSlug, zoneSlug, deviceSlug, req.Action)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "build topic", err)
	}
	pload := domain.CommandPayload{
		ID:      cmdID.String(),
		TS:      time.Now().UTC(),
		Payload: req.Payload,
	}
	body, _ := pload.Encode()
	if err := h.mqtt.Publish(ctx, topic, 1, false, body); err != nil {
		// Marque comme failed mais on retourne 200 quand même puisque la commande
		// est tracée — l'opérateur saura via le status. (Optionnel: 503 si on
		// veut que l'UI sache de retry.)
		_, _ = h.pool.Exec(ctx, `UPDATE commands SET status = 'failed', error_message = $2 WHERE id = $1`,
			cmdID, err.Error())
		return apperr.Wrap(apperr.KindUnavailable, "publish mqtt", err)
	}
	_, _ = h.pool.Exec(ctx, `UPDATE commands SET status = 'sent', sent_at = now() WHERE id = $1`, cmdID)

	return c.JSON(http.StatusAccepted, cmdResp{CommandID: cmdID, Topic: topic, IssuedAt: issuedAt})
}
