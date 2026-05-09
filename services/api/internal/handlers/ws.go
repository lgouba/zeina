package handlers

import (
	"context"
	"encoding/json"
	"net/url"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/labstack/echo/v4"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"
	"github.com/zeina/hyperviseur/services/api/internal/ws"
)

type WSHandler struct {
	signer  *jwt.Signer
	bcaster *ws.Broadcaster
	// Hostnames (avec port optionnel) acceptés en Origin du WebSocket.
	// coder/websocket attend des "hostname[:port]", pas des URLs complètes.
	originPatterns []string
}

// NewWSHandler accepte la liste CORS sous forme d'URLs complètes
// (ex: "http://localhost:5173") et en extrait l'host pour le WS.
func NewWSHandler(signer *jwt.Signer, bcaster *ws.Broadcaster, allowedOrigins []string) *WSHandler {
	patterns := make([]string, 0, len(allowedOrigins))
	for _, o := range allowedOrigins {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			patterns = append(patterns, u.Host) // "localhost:5173"
		} else {
			patterns = append(patterns, o) // déjà un hostname
		}
	}
	return &WSHandler{signer: signer, bcaster: bcaster, originPatterns: patterns}
}

func (h *WSHandler) Register(g *echo.Group) {
	// Note : pas de RequireAuth middleware ici — l'upgrade WebSocket arrive
	// avec ?token=... dans la query string (les browsers ne supportent pas
	// d'envoyer un Authorization header sur l'upgrade). On parse à la main.
	g.GET("/ws", h.Handle)
}

func (h *WSHandler) Handle(c echo.Context) error {
	tok := c.QueryParam("token")
	if tok == "" {
		return apperr.Unauthorized("missing token")
	}
	claims, err := h.signer.ParseAccess(tok)
	if err != nil {
		return apperr.Unauthorized("invalid token")
	}

	conn, err := websocket.Accept(c.Response(), c.Request(), &websocket.AcceptOptions{
		OriginPatterns: h.originPatterns,
	})
	if err != nil {
		return apperr.Wrap(apperr.KindBadRequest, "ws upgrade", err)
	}
	defer func() { _ = conn.CloseNow() }()

	ctx, cancel := context.WithCancel(c.Request().Context())
	defer cancel()

	sub := h.bcaster.Subscribe()
	defer h.bcaster.Unsubscribe(sub)

	// Welcome message — utile pour le frontend pour confirmer la connexion.
	welcome := map[string]any{
		"type":      "welcome",
		"tenant_id": claims.TenantID,
		"role":      claims.Role,
		"server_ts": time.Now().UTC(),
	}
	wctx, wcancel := context.WithTimeout(ctx, 5*time.Second)
	if err := wsjson.Write(wctx, conn, welcome); err != nil {
		wcancel()
		return nil
	}
	wcancel()

	// Reader — détecte la déconnexion / handle les pings client.
	go func() {
		defer cancel()
		for {
			_, _, err := conn.Read(ctx)
			if err != nil {
				return
			}
			// On n'attend rien du client pour le MVP, mais on lit pour
			// libérer les frames de contrôle.
		}
	}()

	// Writer — push tout ce qui sort du broadcaster.
	for {
		select {
		case <-ctx.Done():
			return nil
		case env, ok := <-sub.Out():
			if !ok {
				return nil
			}
			data, err := json.Marshal(env)
			if err != nil {
				continue
			}
			wctx, wcancel := context.WithTimeout(ctx, 5*time.Second)
			err = conn.Write(wctx, websocket.MessageText, data)
			wcancel()
			if err != nil {
				return nil
			}
		}
	}
}
