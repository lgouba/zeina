// Package actions exécute les effets d'une règle déclenchée :
//
//   - set_actuator → publie une commande MQTT cmd/set sur le device cible
//   - notify       → publie un événement sur un topic d'alerte que l'API
//     relayera vers les clients WebSocket
//
// L'exécuteur a besoin de résoudre le device_slug + tenant_slug en topic MQTT
// complet. Pour cela il interroge la DB une fois par règle et cache le mapping
// (slug, tenant) → (site_slug, zone_slug) dans la mémoire de l'engine — voir
// internal/engine.
package actions

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/zeina/hyperviseur/packages/shared/domain"
	sharedmqtt "github.com/zeina/hyperviseur/packages/shared/mqtt"
	"github.com/zeina/hyperviseur/packages/shared/topics"

	"github.com/zeina/hyperviseur/services/rules-engine/internal/definition"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/template"
)

// DeviceLookup est implémenté par engine.Engine — résout (tenantSlug,
// deviceSlug) → (siteSlug, zoneSlug) sans connaître la DB.
type DeviceLookup interface {
	ResolveDevice(tenantSlug, deviceSlug string) (siteSlug, zoneSlug string, ok bool)
}

type Executor struct {
	mqtt       *sharedmqtt.Client
	lookup     DeviceLookup
	log        zerolog.Logger
	email      *EmailProvider
	sms        *SMSProvider
	alarmStore AlarmStore
}

func NewExecutor(mqtt *sharedmqtt.Client, lookup DeviceLookup, log zerolog.Logger) *Executor {
	return &Executor{
		mqtt:   mqtt,
		lookup: lookup,
		log:    log.With().Str("component", "actions").Logger(),
		email:  NewEmailProvider(EmailConfig{}),
		sms:    NewSMSProvider(SMSConfig{}),
	}
}

// SetProviders permet à main.go d'injecter des providers configurés.
func (e *Executor) SetProviders(email *EmailProvider, sms *SMSProvider) {
	if email != nil {
		e.email = email
	}
	if sms != nil {
		e.sms = sms
	}
}

// ExecuteAll exécute toutes les actions de la règle. Retourne :
//   - taken  : description JSON sérialisable de ce qui a été fait
//   - status : success | partial | failure
//   - errMsg : concaténation des erreurs si partiel/échec
//
// Le tplCtx contient les valeurs dynamiques (device.name, value, threshold,
// zone, …) substituées dans les messages email/sms/notify et l'URL/body
// de webhook via le package template.
func (e *Executor) ExecuteAll(ctx context.Context, ruleID uuid.UUID, tenantSlug string, acts []definition.Action, tplCtx template.Context) (taken []byte, status, errMsg string) {
	type executed struct {
		Type   string         `json:"type"`
		Detail map[string]any `json:"detail"`
		Error  string         `json:"error,omitempty"`
	}
	out := make([]executed, 0, len(acts))
	okCount, errCount := 0, 0

	for _, a := range acts {
		ex := executed{Type: a.Type, Detail: map[string]any{}}
		// Niveau peut être surchargé par action — on en garde une copie locale
		// pour le contexte template.
		actCtx := tplCtx
		actCtx.Level = a.Level
		switch a.Type {
		case "set_actuator":
			err := e.setActuator(ctx, ruleID, tenantSlug, a)
			ex.Detail["device_slug"] = a.DeviceSlug
			ex.Detail["state"] = a.State
			if err != nil {
				ex.Error = err.Error()
				errCount++
			} else {
				okCount++
			}
		case "notify":
			msg := template.Resolve(a.Message, actCtx)
			err := e.notify(ctx, ruleID, tenantSlug, a, msg)
			ex.Detail["level"] = a.Level
			ex.Detail["message"] = msg
			if err != nil {
				ex.Error = err.Error()
				errCount++
			} else {
				okCount++
			}
		case "email":
			subject := template.Resolve(a.Subject, actCtx)
			body := template.Resolve(a.Message, actCtx)
			recipients := template.ResolveSlice(a.Recipients, actCtx)
			delivered, err := e.sendEmail(ctx, ruleID, tenantSlug, a, recipients, subject, body)
			ex.Detail["recipients"] = recipients
			ex.Detail["subject"] = subject
			ex.Detail["delivered"] = delivered
			if !delivered && err == nil {
				ex.Detail["reason"] = "smtp not configured"
			}
			if err != nil {
				ex.Error = err.Error()
				errCount++
			} else {
				okCount++
			}
		case "sms":
			body := template.Resolve(a.Message, actCtx)
			recipients := template.ResolveSlice(a.Recipients, actCtx)
			delivered, err := e.sendSMS(ctx, ruleID, tenantSlug, a, recipients, body)
			ex.Detail["recipients"] = recipients
			ex.Detail["delivered"] = delivered
			if !delivered && err == nil {
				ex.Detail["reason"] = "sms gateway not configured"
			}
			if err != nil {
				ex.Error = err.Error()
				errCount++
			} else {
				okCount++
			}
		case "webhook":
			delivered, err := e.sendWebhook(ctx, ruleID, tenantSlug, a, actCtx)
			ex.Detail["url"] = template.Resolve(a.URL, actCtx)
			ex.Detail["method"] = a.Method
			ex.Detail["delivered"] = delivered
			if err != nil {
				ex.Error = err.Error()
				errCount++
			} else {
				okCount++
			}
		case "alarm":
			alarmID, err := e.raiseAlarm(ctx, ruleID, tenantSlug, a, actCtx)
			ex.Detail["severity"] = a.Severity
			ex.Detail["name"] = a.Name
			if alarmID != uuid.Nil {
				ex.Detail["alarm_id"] = alarmID.String()
			}
			if err != nil {
				ex.Error = err.Error()
				errCount++
			} else {
				okCount++
			}
		default:
			ex.Error = "unknown action type"
			errCount++
		}
		out = append(out, ex)
	}

	switch {
	case okCount == len(acts):
		status = "success"
	case okCount == 0:
		status = "failure"
	default:
		status = "partial"
	}
	if errCount > 0 {
		errMsg = fmt.Sprintf("%d/%d actions failed", errCount, len(acts))
	}
	taken, _ = json.Marshal(out)
	return
}

// setActuator publie une commande MQTT cmd/set sur le device cible.
// Le simulator ou l'actionneur réel reçoit, applique, et republie son state.
func (e *Executor) setActuator(ctx context.Context, ruleID uuid.UUID, tenantSlug string, a definition.Action) error {
	siteSlug, zoneSlug, ok := e.lookup.ResolveDevice(tenantSlug, a.DeviceSlug)
	if !ok {
		return fmt.Errorf("device %q not found in tenant %q", a.DeviceSlug, tenantSlug)
	}
	topic, err := topics.BuildCommandTopic(tenantSlug, siteSlug, zoneSlug, a.DeviceSlug, "set")
	if err != nil {
		return err
	}
	cmd := domain.CommandPayload{
		ID:      "rule-" + ruleID.String(),
		TS:      time.Now().UTC(),
		Payload: jsonRaw(map[string]string{"state": a.State}),
	}
	body, _ := cmd.Encode()
	if err := e.mqtt.Publish(ctx, topic, 1, false, body); err != nil {
		return fmt.Errorf("publish %s: %w", topic, err)
	}
	e.log.Info().
		Str("rule_id", ruleID.String()).
		Str("topic", topic).
		Str("state", a.State).
		Msg("actuator command sent")
	return nil
}

// notify publie une alerte sur un topic dédié que le WS broadcaster API
// transforme en événement pour les clients connectés.
//
// Topic : qlab/{tenant}/_alerts/rule-engine
// Payload : {"ts":"...","rule_id":"...","level":"warning","message":"..."}
//
// Note : on n'a pas étendu shared/topics pour ce cas — on construit le topic
// à la main, et on enregistre une exception côté ACL Mosquitto si besoin.
func (e *Executor) notify(ctx context.Context, ruleID uuid.UUID, tenantSlug string, a definition.Action, message string) error {
	topic := "qlab/" + tenantSlug + "/_alerts/rule-engine"
	level := a.Level
	if level == "" {
		level = "info"
	}
	body, _ := json.Marshal(map[string]any{
		"ts":      time.Now().UTC(),
		"rule_id": ruleID.String(),
		"level":   level,
		"message": message,
	})
	if err := e.mqtt.Publish(ctx, topic, 0, false, body); err != nil {
		return fmt.Errorf("publish notify %s: %w", topic, err)
	}
	e.log.Info().
		Str("rule_id", ruleID.String()).
		Str("level", level).
		Msg("notify published")
	return nil
}

// sendEmail tente d'envoyer le mail via le provider SMTP. Quel que soit le
// résultat, on publie aussi une alerte MQTT pour que le bandeau de
// notification de l'UI affiche le déclenchement (utile en démo + sert de
// trace si le SMTP est down).
func (e *Executor) sendEmail(ctx context.Context, ruleID uuid.UUID, tenantSlug string, a definition.Action, recipients []string, subject, body string) (bool, error) {
	delivered, err := e.email.Send(recipients, subject, body)

	level := a.Level
	if level == "" {
		level = "info"
	}
	uiMsg := subject
	if uiMsg == "" {
		uiMsg = body
	}
	uiMsg = fmt.Sprintf("📧 %s → %d destinataire(s)", uiMsg, len(recipients))
	if !delivered && err == nil {
		uiMsg += " (SMTP non configuré)"
	}
	_ = e.publishAlert(ctx, tenantSlug, ruleID, level, uiMsg)

	logCtx := e.log.Info().
		Str("rule_id", ruleID.String()).
		Strs("to", recipients).
		Bool("delivered", delivered)
	if err != nil {
		logCtx.Err(err).Msg("email send failed")
	} else if delivered {
		logCtx.Msg("email sent")
	} else {
		logCtx.Msg("email simulated (no smtp config)")
	}
	return delivered, err
}

// sendSMS tente l'envoi via webhook + publie l'alerte UI.
func (e *Executor) sendSMS(ctx context.Context, ruleID uuid.UUID, tenantSlug string, a definition.Action, recipients []string, body string) (bool, error) {
	delivered, err := e.sms.Send(ctx, ruleID, recipients, body)

	level := a.Level
	if level == "" {
		level = "info"
	}
	uiMsg := fmt.Sprintf("📱 SMS → %d destinataire(s) : %s", len(recipients), body)
	if !delivered && err == nil {
		uiMsg += " (passerelle SMS non configurée)"
	}
	_ = e.publishAlert(ctx, tenantSlug, ruleID, level, uiMsg)

	logCtx := e.log.Info().
		Str("rule_id", ruleID.String()).
		Strs("to", recipients).
		Bool("delivered", delivered)
	if err != nil {
		logCtx.Err(err).Msg("sms send failed")
	} else if delivered {
		logCtx.Msg("sms sent")
	} else {
		logCtx.Msg("sms simulated (no gateway config)")
	}
	return delivered, err
}

// publishAlert : helper partagé pour pousser une alerte vers le bandeau UI.
func (e *Executor) publishAlert(ctx context.Context, tenantSlug string, ruleID uuid.UUID, level, message string) error {
	topic := "qlab/" + tenantSlug + "/_alerts/rule-engine"
	body, _ := json.Marshal(map[string]any{
		"ts":      time.Now().UTC(),
		"rule_id": ruleID.String(),
		"level":   level,
		"message": message,
	})
	return e.mqtt.Publish(ctx, topic, 0, false, body)
}

func jsonRaw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
