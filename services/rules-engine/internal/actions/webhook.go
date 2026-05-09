// webhook.go — action HTTP générique. Permet de brancher n'importe quel
// service externe (Slack, Teams, Discord, n8n, IFTTT, Zapier, …) sans
// modifier le moteur. URL/body/headers sont templatables.
package actions

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/zeina/hyperviseur/services/rules-engine/internal/definition"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/template"
)

// httpClientWebhook — timeouts agressifs : l'engine doit pas se bloquer
// pour un Slack qui rame.
var httpClientWebhook = &http.Client{Timeout: 10 * time.Second}

// sendWebhook construit la requête HTTP, applique les templates, l'envoie,
// publie un récap UI. Considère 2xx/3xx comme succès.
func (e *Executor) sendWebhook(ctx context.Context, ruleID uuid.UUID, tenantSlug string, a definition.Action, tplCtx template.Context) (bool, error) {
	url := template.Resolve(a.URL, tplCtx)
	if url == "" {
		return false, fmt.Errorf("webhook needs url")
	}
	method := strings.ToUpper(a.Method)
	if method == "" {
		method = "POST"
	}
	body := template.Resolve(a.Body, tplCtx)

	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewBufferString(body))
	if err != nil {
		return false, fmt.Errorf("build request: %w", err)
	}
	// Headers templatables. Si pas d'override de Content-Type et qu'on a un
	// body, on met application/json par défaut.
	for k, v := range a.Headers {
		req.Header.Set(k, template.Resolve(v, tplCtx))
	}
	if body != "" && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}

	level := a.Level
	if level == "" {
		level = "info"
	}

	resp, err := httpClientWebhook.Do(req)
	if err != nil {
		uiMsg := fmt.Sprintf("🔗 Webhook → %s a échoué : %v", hostOf(url), err)
		_ = e.publishAlert(ctx, tenantSlug, ruleID, level, uiMsg)
		e.log.Warn().Err(err).Str("rule_id", ruleID.String()).Str("url", url).Msg("webhook failed")
		return false, err
	}
	defer resp.Body.Close()
	// Drain pour permettre la réutilisation de la connexion.
	_, _ = io.Copy(io.Discard, resp.Body)

	delivered := resp.StatusCode >= 200 && resp.StatusCode < 400
	uiMsg := fmt.Sprintf("🔗 Webhook → %s [%d]", hostOf(url), resp.StatusCode)
	_ = e.publishAlert(ctx, tenantSlug, ruleID, level, uiMsg)

	if !delivered {
		e.log.Warn().Str("rule_id", ruleID.String()).Str("url", url).Int("status", resp.StatusCode).Msg("webhook non-2xx")
		return false, fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	e.log.Info().Str("rule_id", ruleID.String()).Str("url", url).Int("status", resp.StatusCode).Msg("webhook delivered")
	return true, nil
}

// hostOf extrait juste l'hôte de l'URL pour le bandeau UI (évite de
// fuiter des tokens présents dans le path / query).
func hostOf(u string) string {
	s := u
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	if s == "" {
		return u
	}
	return s
}
