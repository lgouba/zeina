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
)

// AuditHandler — consultation du journal d'audit du tenant.
// Réservé aux owners du tenant et superadmins.
type AuditHandler struct {
	pool *pgxpool.Pool
}

func NewAuditHandler(pool *pgxpool.Pool) *AuditHandler {
	return &AuditHandler{pool: pool}
}

func (h *AuditHandler) Register(g *echo.Group) {
	g.GET("/audit", h.List)
}

type auditOut struct {
	ID         uuid.UUID       `json:"id"`
	ActorID    *uuid.UUID      `json:"actor_id,omitempty"`
	ActorEmail *string         `json:"actor_email,omitempty"`
	Action     string          `json:"action"`
	TargetType *string         `json:"target_type,omitempty"`
	TargetID   *uuid.UUID      `json:"target_id,omitempty"`
	TargetName *string         `json:"target_name,omitempty"`
	Metadata   json.RawMessage `json:"metadata"`
	CreatedAt  time.Time       `json:"created_at"`
}

// List renvoie les N derniers événements d'audit du tenant courant.
//
// Query params :
//   - limit : 1..500 (défaut 100)
//   - action : filtre exact (ex: "site.create")
func (h *AuditHandler) List(c echo.Context) error {
	tid := tenantID(c)
	limit := 100
	if l := c.QueryParam("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	action := c.QueryParam("action")

	q := `
		SELECT id, actor_id, actor_email, action, target_type, target_id, target_name, metadata, created_at
		FROM audit_events
		WHERE tenant_id = $1`
	args := []any{tid}
	if action != "" {
		q += ` AND action = $2`
		args = append(args, action)
	}
	q += ` ORDER BY created_at DESC LIMIT ` + strconv.Itoa(limit)

	rows, err := h.pool.Query(c.Request().Context(), q, args...)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "query audit", err)
	}
	defer rows.Close()

	out := []auditOut{}
	for rows.Next() {
		var a auditOut
		if err := rows.Scan(&a.ID, &a.ActorID, &a.ActorEmail, &a.Action, &a.TargetType, &a.TargetID, &a.TargetName, &a.Metadata, &a.CreatedAt); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan audit", err)
		}
		out = append(out, a)
	}
	return c.JSON(http.StatusOK, out)
}
