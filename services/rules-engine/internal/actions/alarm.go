// alarm.go — handler de l'action `alarm` : crée ou met à jour une alarme
// dans la table `alarms` via le AlarmStore.
package actions

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/zeina/hyperviseur/services/rules-engine/internal/alarms"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/definition"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/template"
)

// AlarmStore — découpe la dépendance vers le package alarms (pour testabilité).
type AlarmStore interface {
	Trigger(ctx context.Context, in alarms.TriggerInput) (uuid.UUID, bool, error)
	LookupContext(ctx context.Context, tenantSlug, deviceSlug, measurement string) (alarms.LookupResult, error)
}

// SetAlarmStore — injecté par main.go après init de la DB.
func (e *Executor) SetAlarmStore(s AlarmStore) { e.alarmStore = s }

// raiseAlarm crée ou réveille une alarme via le store. Tous les champs
// textuels (name, label, description, status_text) sont templatés avec le
// contexte de la règle.
func (e *Executor) raiseAlarm(ctx context.Context, ruleID uuid.UUID, tenantSlug string, a definition.Action, tplCtx template.Context) (uuid.UUID, error) {
	if e.alarmStore == nil {
		return uuid.Nil, fmt.Errorf("alarm store not configured")
	}
	lookup, err := e.alarmStore.LookupContext(ctx, tenantSlug, tplCtx.DeviceSlug, tplCtx.Measurement)
	if err != nil {
		return uuid.Nil, fmt.Errorf("lookup context: %w", err)
	}
	// Enrichit le tplCtx avec l'unit récupérée si pas déjà présente.
	if tplCtx.Unit == "" && lookup.Unit != "" {
		tplCtx.Unit = lookup.Unit
	}
	in := alarms.TriggerInput{
		TenantID:    lookup.TenantID,
		SiteID:      lookup.SiteID,
		RuleID:      ruleID,
		DeviceID:    lookup.DeviceID,
		ZoneID:      lookup.ZoneID,
		Label:       template.Resolve(orDefault(a.Label, "Dépassement de seuil"), tplCtx),
		Name:        template.Resolve(orDefault(a.Name, tplCtx.RuleName), tplCtx),
		Description: template.Resolve(a.Description, tplCtx),
		Severity:    orDefault(a.Severity, "major"),
		Model:       orDefault(a.Model, "Standard"),
		StatusText:  template.Resolve(a.StatusText, tplCtx),
		Attribute:   tplCtx.Measurement,
		Value:       tplCtx.Value,
		Unit:        tplCtx.Unit,
	}
	id, isNew, err := e.alarmStore.Trigger(ctx, in)
	if err != nil {
		return uuid.Nil, err
	}

	// Bandeau UI : on publie un event MQTT pour que le front puisse afficher
	// l'alarme en temps réel sans refresh manuel.
	level := alarmSeverityToLevel(in.Severity)
	uiMsg := "🚨 " + in.Name
	if isNew {
		uiMsg = "🆕 " + uiMsg
	} else {
		uiMsg = "🔁 " + uiMsg
	}
	_ = e.publishAlert(ctx, tenantSlug, ruleID, level, uiMsg)

	logCtx := e.log.Info().
		Str("rule_id", ruleID.String()).
		Str("alarm_id", id.String()).
		Str("severity", in.Severity).
		Bool("new", isNew)
	if isNew {
		logCtx.Msg("alarm created")
	} else {
		logCtx.Msg("alarm re-triggered")
	}
	return id, nil
}

func alarmSeverityToLevel(sev string) string {
	switch sev {
	case "critical":
		return "critical"
	case "minor":
		return "info"
	default:
		return "warning"
	}
}

func orDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
