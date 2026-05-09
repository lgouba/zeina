// aggregate.go — évaluation périodique des règles à trigger `aggregate` et
// `anomaly`. Un ticker recheck toutes les 30s ; pour chaque règle concernée
// on calcule l'agrégat sur les CAGGs Timescale et on compare à la valeur
// seuil.
//
// Diffère du flux temps-réel (onMessage) :
//   - threshold/value_change → push : déclenchent dès qu'une valeur change
//   - aggregate/anomaly      → pull : recheck périodique, indépendant des MQTT
package engine

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/zeina/hyperviseur/services/rules-engine/internal/definition"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/metrics"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/store"
)

const aggregateTickInterval = 30 * time.Second

// startAggregateLoop lance le ticker qui évalue aggregate/anomaly rules.
func (e *Engine) startAggregateLoop(ctx context.Context) {
	t := time.NewTicker(aggregateTickInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			e.evaluateAggregateRules(ctx)
		}
	}
}

func (e *Engine) evaluateAggregateRules(ctx context.Context) {
	now := time.Now()
	for _, r := range e.store.All() {
		t := r.Definition.Trigger
		if t.Type != "aggregate" && t.Type != "anomaly" {
			continue
		}
		if !r.Definition.TimeWindow.IsActiveAt(now) {
			metrics.TriggerEvaluations.WithLabelValues(t.Type, "out_of_window").Inc()
			continue
		}
		targets := e.aggregateTargets(r)
		for _, deviceSlug := range targets {
			e.evaluateAggregateOne(ctx, r, deviceSlug)
		}
	}
}

// aggregateTargets retourne les device_slug à évaluer pour une règle agrégat.
// Pour zone_scope : tous les devices de la zone (filtrés par device_type).
// Sinon : juste le device_slug du trigger.
func (e *Engine) aggregateTargets(r store.Loaded) []string {
	t := r.Definition.Trigger
	if t.ZoneScope == nil {
		return []string{t.DeviceSlug}
	}
	out := []string{}
	prefix := r.TenantSlug + "/"
	e.devMu.RLock()
	defer e.devMu.RUnlock()
	for k, d := range e.dev {
		if d.ZoneID != t.ZoneScope.ZoneID {
			continue
		}
		if t.ZoneScope.DeviceType != "" && d.DeviceType != t.ZoneScope.DeviceType {
			continue
		}
		if len(k) <= len(prefix) || k[:len(prefix)] != prefix {
			continue
		}
		out = append(out, k[len(prefix):])
	}
	return out
}

func (e *Engine) evaluateAggregateOne(ctx context.Context, r store.Loaded, deviceSlug string) {
	t := r.Definition.Trigger
	var current float64
	var matched bool
	var err error

	switch t.Type {
	case "aggregate":
		current, err = e.computeAggregate(ctx, r.TenantSlug, deviceSlug, t.Measurement, t.Aggregate)
		if err != nil {
			e.log.Warn().Err(err).Str("rule_id", r.ID.String()).Str("device", deviceSlug).Msg("aggregate compute failed")
			return
		}
		matched = definition.Compare(current, t.Value, t.Op)
	case "anomaly":
		current, matched, err = e.computeAnomaly(ctx, r.TenantSlug, deviceSlug, t.Measurement, t.Anomaly)
		if err != nil {
			e.log.Warn().Err(err).Str("rule_id", r.ID.String()).Str("device", deviceSlug).Msg("anomaly compute failed")
			return
		}
	}

	if !matched {
		metrics.TriggerEvaluations.WithLabelValues(t.Type, "nomatch").Inc()
		return
	}
	metrics.TriggerEvaluations.WithLabelValues(t.Type, "matched").Inc()

	// Copie sûre avec device_slug injecté pour cooldown/templating.
	loaded := withDeviceSlug(r, deviceSlug)
	tplCtx := e.buildTplContext(loaded, &current)
	e.fire(ctx, loaded, tplCtx)
}

// computeAggregate exécute la fonction d'agrégat sur la fenêtre rolling.
// Choisit le CAGG le plus fin compatible avec window_minutes.
func (e *Engine) computeAggregate(ctx context.Context, tenantSlug, deviceSlug, measurement string, spec *definition.AggregateSpec) (float64, error) {
	deviceID, err := e.resolveDeviceID(ctx, tenantSlug, deviceSlug)
	if err != nil {
		return 0, err
	}
	to := time.Now().UTC()
	from := to.Add(-time.Duration(spec.WindowMinutes) * time.Minute)

	tableName, bucketCol, valueCol := pickCAGG(spec.WindowMinutes, spec.Op)
	pgFn := pgFnFor(spec.Op)
	q := "SELECT COALESCE(" + pgFn + "(" + valueCol + "), 0) FROM " + tableName +
		" WHERE device_id = $1 AND measurement = $2 AND " + bucketCol + " >= $3 AND " + bucketCol + " < $4"
	var v float64
	if err := e.pool.QueryRow(ctx, q, deviceID, measurement, from, to).Scan(&v); err != nil {
		return 0, err
	}
	return v, nil
}

// computeAnomaly compare la valeur courante moy(1h) à la baseline historique
// (même heure de la journée sur les N derniers jours). Anomaly si l'écart
// dépasse Sigma écarts-types.
func (e *Engine) computeAnomaly(ctx context.Context, tenantSlug, deviceSlug, measurement string, spec *definition.AnomalySpec) (float64, bool, error) {
	deviceID, err := e.resolveDeviceID(ctx, tenantSlug, deviceSlug)
	if err != nil {
		return 0, false, err
	}
	to := time.Now().UTC()
	from := to.Add(-1 * time.Hour)

	// Valeur courante = moyenne sur la dernière heure.
	var current float64
	err = e.pool.QueryRow(ctx,
		`SELECT COALESCE(AVG(avg_value), 0) FROM measurements_1h
		 WHERE device_id = $1 AND measurement = $2 AND bucket >= $3 AND bucket < $4`,
		deviceID, measurement, from, to).Scan(&current)
	if err != nil {
		return 0, false, err
	}
	if current == 0 {
		return 0, false, nil
	}

	// Baseline : moyenne + écart-type sur même heure de la journée sur N jours.
	baselineFrom := to.AddDate(0, 0, -spec.BaselineDays)
	baselineTo := to.AddDate(0, 0, -1)
	hour := to.Hour()
	var mu, sigma float64
	err = e.pool.QueryRow(ctx,
		`SELECT COALESCE(AVG(avg_value), 0), COALESCE(STDDEV_SAMP(avg_value), 0)
		 FROM measurements_1h
		 WHERE device_id = $1 AND measurement = $2
		   AND bucket >= $3 AND bucket < $4
		   AND EXTRACT(HOUR FROM bucket)::int = $5`,
		deviceID, measurement, baselineFrom, baselineTo, hour).Scan(&mu, &sigma)
	if err != nil {
		return current, false, err
	}
	if sigma <= 0 {
		return current, false, nil
	}
	deviation := math.Abs(current - mu)
	matched := deviation > spec.Sigma*sigma
	return current, matched, nil
}

// resolveDeviceID : (tenant, device_slug) → uuid via la DB.
func (e *Engine) resolveDeviceID(ctx context.Context, tenantSlug, deviceSlug string) (uuid.UUID, error) {
	var id uuid.UUID
	err := e.pool.QueryRow(ctx, `
		SELECT d.id FROM devices d
		JOIN zones z ON z.id = d.zone_id
		JOIN sites s ON s.id = z.site_id
		JOIN tenants t ON t.id = s.tenant_id
		WHERE t.slug = $1 AND d.slug = $2`, tenantSlug, deviceSlug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	return id, err
}

// pickCAGG choisit la table/colonnes Timescale adaptées à la fenêtre.
// Retourne (tableName, bucketColumn, valueColumn).
func pickCAGG(windowMinutes int, op string) (string, string, string) {
	valueCol := aggValueCol(op)
	switch {
	case windowMinutes <= 60:
		return "measurements_1min", "bucket", valueCol
	case windowMinutes <= 24*60:
		return "measurements_15min", "bucket", valueCol
	case windowMinutes <= 7*24*60:
		return "measurements_1h", "bucket", valueCol
	default:
		return "measurements_1d", "bucket", valueCol
	}
}

func aggValueCol(op string) string {
	switch op {
	case "min":
		return "min_value"
	case "max":
		return "max_value"
	default:
		return "avg_value"
	}
}

func pgFnFor(op string) string {
	switch op {
	case "sum":
		return "SUM"
	case "min":
		return "MIN"
	case "max":
		return "MAX"
	case "count":
		return "COUNT"
	default:
		return "AVG"
	}
}
