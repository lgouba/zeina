// Package actions — provider d'envoi de SMS via webhook HTTP générique.
//
// Le webhook reçoit un POST JSON :
//
//   {
//     "to":      "+22670123456",
//     "message": "Texte du SMS",
//     "rule_id": "uuid"
//   }
//
// L'envoi est fait en série pour chaque destinataire (un POST par numéro)
// pour rester compatible avec la majorité des passerelles (Twilio, OVH,
// Orange, etc.) — on transforme côté backend si on veut grouper.
//
// Configuration via variables d'environnement :
//
//   SMS_WEBHOOK_URL    — URL du POST (vide = mode stub)
//   SMS_WEBHOOK_AUTH   — header Authorization complet
//                        (ex: "Bearer xxx" ou "Basic base64(...)")
//   SMS_WEBHOOK_HEADER — header optionnel "Nom: Valeur" (peut être répété
//                        comme une liste séparée par "|")
//
// Si SMS_WEBHOOK_URL est vide, le provider est stub : Send retourne
// (false, nil) et l'action est marquée success avec delivered=false.

package actions

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type SMSConfig struct {
	WebhookURL   string
	AuthHeader   string   // valeur complète du header Authorization
	ExtraHeaders []string // "Nom: Valeur" – listé séparé par "|" en env
	Timeout      time.Duration
}

func (c SMSConfig) Configured() bool { return c.WebhookURL != "" }

type SMSProvider struct {
	cfg SMSConfig
	c   *http.Client
}

func NewSMSProvider(cfg SMSConfig) *SMSProvider {
	t := cfg.Timeout
	if t == 0 {
		t = 10 * time.Second
	}
	return &SMSProvider{cfg: cfg, c: &http.Client{Timeout: t}}
}

// Send POST le payload pour chaque destinataire. Retourne (delivered, err).
// delivered=true si TOUS les destinataires ont été acceptés ; sinon err
// concatène les échecs.
func (p *SMSProvider) Send(ctx context.Context, ruleID uuid.UUID, to []string, message string) (bool, error) {
	if !p.cfg.Configured() {
		return false, nil
	}
	if len(to) == 0 {
		return false, fmt.Errorf("no recipient")
	}

	var errs []string
	for _, num := range to {
		if err := p.postOne(ctx, ruleID, num, message); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", num, err))
		}
	}
	if len(errs) > 0 {
		return false, fmt.Errorf("sms partial: %s", strings.Join(errs, "; "))
	}
	return true, nil
}

func (p *SMSProvider) postOne(ctx context.Context, ruleID uuid.UUID, to, msg string) error {
	body, _ := json.Marshal(map[string]string{
		"to":      to,
		"message": msg,
		"rule_id": ruleID.String(),
	})
	req, err := http.NewRequestWithContext(ctx, "POST", p.cfg.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.cfg.AuthHeader != "" {
		req.Header.Set("Authorization", p.cfg.AuthHeader)
	}
	for _, h := range p.cfg.ExtraHeaders {
		k, v, ok := strings.Cut(h, ":")
		if !ok {
			continue
		}
		req.Header.Set(strings.TrimSpace(k), strings.TrimSpace(v))
	}
	resp, err := p.c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}
