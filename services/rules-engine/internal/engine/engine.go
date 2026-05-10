// Package engine est l'orchestrateur du moteur de règles.
//
// Pour chaque message MQTT de mesure :
//  1. on cache la dernière valeur dans Redis (sert aux conditions des autres
//     règles)
//  2. on cherche les règles dont le trigger pourrait matcher (par device_slug
//     + measurement) et on les évalue.
//
// Pour les règles cron : on enregistre leurs schedules dans robfig/cron qui
// les déclenche aux bons moments.
//
// Si une règle déclenche → évaluation des conditions → cooldown check →
// exécution des actions → log dans rule_executions.
package engine

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/robfig/cron/v3"
	"github.com/rs/zerolog"

	"github.com/zeina/hyperviseur/packages/shared/domain"
	sharedmqtt "github.com/zeina/hyperviseur/packages/shared/mqtt"
	"github.com/zeina/hyperviseur/packages/shared/topics"

	"github.com/zeina/hyperviseur/services/rules-engine/internal/actions"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/definition"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/evaluator"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/metrics"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/state"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/store"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/template"
)

// AlarmResolver — sous-ensemble de l'API alarms.Store que l'engine utilise
// pour auto-résoudre les alarmes au retour à la normale (mode edge).
type AlarmResolver interface {
	AutoResolveByRuleAndDevice(ctx context.Context, ruleID uuid.UUID, tenantSlug, deviceSlug string, currentValue float64) (int, error)
}

// Engine assemble store + state + actions + cron + MQTT consumer.
type Engine struct {
	pool   *pgxpool.Pool
	store  *store.Store
	state  *state.State
	mqtt   *sharedmqtt.Client
	exec   *actions.Executor
	cron   *cron.Cron
	log    zerolog.Logger
	alarms AlarmResolver // optionnel, set via SetAlarmResolver

	// Cache device_slug → (site_slug, zone_slug) par tenant — utilisé par
	// l'executor pour construire les topics MQTT cmd. Refresh périodique.
	devMu sync.RWMutex
	dev   map[string]devLoc // key = tenant + "/" + device_slug

	// Tracking des cron entry ids actifs pour pouvoir les retirer au reload.
	cronMu      sync.Mutex
	cronEntries map[uuid.UUID]cron.EntryID
}

type devLoc struct {
	SiteSlug   string
	SiteName   string
	ZoneID     string
	ZoneSlug   string
	ZoneName   string
	DeviceName string
	DeviceType string
}

// withDeviceSlug — clone superficiel d'un Loaded avec la définition pour
// remplacer le device_slug du trigger. Évite de muter la map partagée du
// store (Definition est un pointeur).
func withDeviceSlug(r store.Loaded, deviceSlug string) store.Loaded {
	def := *r.Definition
	def.Trigger.DeviceSlug = deviceSlug
	r.Definition = &def
	return r
}

func New(pool *pgxpool.Pool, st *store.Store, sst *state.State, mqtt *sharedmqtt.Client, log zerolog.Logger) *Engine {
	e := &Engine{
		pool:        pool,
		store:       st,
		state:       sst,
		mqtt:        mqtt,
		log:         log.With().Str("component", "engine").Logger(),
		dev:         make(map[string]devLoc),
		cronEntries: make(map[uuid.UUID]cron.EntryID),
	}
	e.exec = actions.NewExecutor(mqtt, e, log)
	e.cron = cron.New()
	return e
}

// SetActionProviders permet à main.go d'injecter des providers email / sms
// configurés. Doit être appelé avant Start().
func (e *Engine) SetActionProviders(email *actions.EmailProvider, sms *actions.SMSProvider) {
	e.exec.SetProviders(email, sms)
}

// SetAlarmStore — branche le store d'alarmes pour l'action `alarm` ET pour
// l'auto-résolution edge-triggered.
func (e *Engine) SetAlarmStore(s actions.AlarmStore) {
	e.exec.SetAlarmStore(s)
	if r, ok := s.(AlarmResolver); ok {
		e.alarms = r
	}
}

// ResolveDevice — implémente actions.DeviceLookup.
func (e *Engine) ResolveDevice(tenantSlug, deviceSlug string) (string, string, bool) {
	e.devMu.RLock()
	defer e.devMu.RUnlock()
	d, ok := e.dev[tenantSlug+"/"+deviceSlug]
	if !ok {
		return "", "", false
	}
	return d.SiteSlug, d.ZoneSlug, true
}

// RefreshDeviceMap recharge le mapping (tenant, slug) → infos de localisation
// utilisés pour construire les topics MQTT cmd ET pour résoudre les variables
// de templating (device.name, zone.name, etc.).
func (e *Engine) RefreshDeviceMap(ctx context.Context) error {
	rows, err := e.pool.Query(ctx, `
		SELECT t.slug, s.slug, s.name, z.id, z.slug, z.name, d.slug, COALESCE(d.name, d.slug), d.type::text
		FROM devices d
		JOIN zones z ON z.id = d.zone_id
		JOIN sites s ON s.id = z.site_id
		JOIN tenants t ON t.id = s.tenant_id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	next := make(map[string]devLoc, 64)
	for rows.Next() {
		var ts, ss, sn, zs, zn, ds, dn, dt string
		var zid uuid.UUID
		if err := rows.Scan(&ts, &ss, &sn, &zid, &zs, &zn, &ds, &dn, &dt); err != nil {
			continue
		}
		next[ts+"/"+ds] = devLoc{
			SiteSlug: ss, SiteName: sn,
			ZoneID: zid.String(), ZoneSlug: zs, ZoneName: zn,
			DeviceName: dn, DeviceType: dt,
		}
	}
	e.devMu.Lock()
	e.dev = next
	e.devMu.Unlock()
	return nil
}

// LookupDevice retourne le devLoc pour (tenant, device_slug) ou false.
func (e *Engine) LookupDevice(tenantSlug, deviceSlug string) (devLoc, bool) {
	e.devMu.RLock()
	defer e.devMu.RUnlock()
	d, ok := e.dev[tenantSlug+"/"+deviceSlug]
	return d, ok
}

// Start démarre le consumer MQTT + le cron + une boucle de refresh map.
func (e *Engine) Start(ctx context.Context) error {
	if err := e.RefreshDeviceMap(ctx); err != nil {
		return err
	}
	go func() {
		t := time.NewTicker(60 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				_ = e.RefreshDeviceMap(ctx)
			}
		}
	}()

	// Cron pour les règles type "cron"
	e.cron.Start()
	e.RefreshCron()
	go func() {
		// Re-syncer les entrées cron à chaque reload (ratelimited)
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				e.cron.Stop()
				return
			case <-t.C:
				e.RefreshCron()
			}
		}
	}()

	// Boucle d'évaluation périodique pour les triggers aggregate / anomaly
	// (qui ne se déclenchent pas par message MQTT mais par recheck calendaire).
	go e.startAggregateLoop(ctx)

	// Subscribe à toutes les mesures (qlab/+/+/+/+/+)
	filter := topics.SubscriptionAllMeasurements()
	e.log.Info().Str("filter", filter).Msg("subscribing")
	return e.mqtt.Subscribe(ctx, filter, 0, e.onMessage)
}

// onMessage est appelé par paho à chaque mesure publiée. Doit être rapide.
func (e *Engine) onMessage(topic string, payload []byte) {
	parts, err := topics.Parse(topic)
	if err != nil || parts.Kind != topics.KindMeasurement {
		return
	}
	p, err := domain.DecodePayload(payload)
	if err != nil {
		return
	}

	// Cache last value (5 min default TTL géré par state).
	bgCtx := context.Background()
	_ = e.state.SetLastValue(bgCtx, parts.Device, parts.Measurement, p.Value)

	// Pour chaque règle dont le trigger pourrait matcher (par device + meas),
	// on évalue.
	// Lookup du device qui a publié pour pouvoir comparer aux zone_scope.
	pubLoc, hasPubLoc := e.LookupDevice(parts.Tenant, parts.Device)

	for _, r := range e.store.All() {
		if r.TenantSlug != parts.Tenant {
			continue
		}
		t := r.Definition.Trigger
		if t.Type != "threshold" && t.Type != "value_change" {
			continue
		}
		if t.Measurement != parts.Measurement {
			continue
		}
		// Match par device_slug exact OU par zone_scope.
		if t.ZoneScope != nil {
			if !hasPubLoc || pubLoc.ZoneID != t.ZoneScope.ZoneID {
				continue
			}
			if t.ZoneScope.DeviceType != "" && pubLoc.DeviceType != t.ZoneScope.DeviceType {
				continue
			}
		} else {
			if t.DeviceSlug != parts.Device {
				continue
			}
		}
		// Time window : la règle ne s'évalue qu'à l'intérieur de son créneau.
		if !r.Definition.TimeWindow.IsActiveAt(time.Now()) {
			metrics.TriggerEvaluations.WithLabelValues(t.Type, "out_of_window").Inc()
			continue
		}
		// Pour zone_scope : on évalue avec le device qui vient de publier
		// comme contexte (pas le device_slug de la règle qui peut être vide).
		evalRule := r
		if t.ZoneScope != nil {
			evalRule = withDeviceSlug(r, parts.Device)
		}
		e.evaluateAndMaybeExecute(bgCtx, evalRule, p.Value)
	}
}

// evaluateAndMaybeExecute teste le trigger, puis les conditions, puis exécute.
//
// Mode edge (défaut) : la règle déclenche une seule fois quand la condition
// devient vraie, puis attend le retour à la normale (condition fausse) avant
// de pouvoir re-déclencher. Au retour normal, on auto-résout les alarmes
// ouvertes. Évite le spam (1 mail par incident, pas par mesure).
//
// Mode level (legacy) : la règle déclenche tant que la condition est vraie
// dans la limite de cooldown_seconds.
func (e *Engine) evaluateAndMaybeExecute(ctx context.Context, r store.Loaded, currentValue float64) {
	t := r.Definition.Trigger

	// 1. Check trigger
	matched, err := e.checkTrigger(ctx, r.ID, t.DeviceSlug, t, currentValue)
	if err != nil {
		e.log.Warn().Err(err).Str("rule_id", r.ID.String()).Msg("trigger check failed")
		return
	}

	// État précédent (uniquement pertinent pour le mode edge).
	wasTriggered, _ := e.state.IsTriggered(ctx, r.ID, t.DeviceSlug)

	if matched {
		metrics.TriggerEvaluations.WithLabelValues(t.Type, "matched").Inc()
		// Mode edge : si déjà triggered, ne pas re-fire (1 seule notif par incident).
		if r.Definition.IsEdgeTriggered() && wasTriggered {
			return
		}
		tplCtx := e.buildTplContext(r, &currentValue)
		e.fire(ctx, r, tplCtx)
		// Marque triggered après un fire réussi (cooldown / conditions échouées
		// sont gérés dans fire et n'aboutissent pas à un déclenchement réel).
		_ = e.state.SetTriggered(ctx, r.ID, t.DeviceSlug)
		return
	}

	metrics.TriggerEvaluations.WithLabelValues(t.Type, "nomatch").Inc()

	// Mode edge : retour à la normale → auto-résoudre les alarmes ouvertes
	// liées à ce (rule, device) et clear l'état triggered.
	if r.Definition.IsEdgeTriggered() && wasTriggered {
		e.handleResolution(ctx, r, currentValue)
	}
}

// handleResolution traite le retour à la normale (condition redevient fausse
// après avoir été vraie). Auto-résout les alarmes ouvertes, log l'événement
// et clear l'état triggered. Aucune notification n'est envoyée par défaut
// pour ne pas spammer (le user peut surveiller la page Alarmes).
func (e *Engine) handleResolution(ctx context.Context, r store.Loaded, currentValue float64) {
	t := r.Definition.Trigger
	deviceSlug := t.DeviceSlug

	// Auto-résoudre les alarmes ouvertes pour ce rule×device.
	if e.alarms != nil {
		n, err := e.alarms.AutoResolveByRuleAndDevice(ctx, r.ID, r.TenantSlug, deviceSlug, currentValue)
		if err != nil {
			e.log.Warn().Err(err).Str("rule_id", r.ID.String()).Msg("auto-resolve alarms failed")
		} else if n > 0 {
			e.log.Info().
				Str("rule_id", r.ID.String()).
				Str("device", deviceSlug).
				Int("alarms_resolved", n).
				Float64("current_value", currentValue).
				Msg("auto-resolved alarms on return to normal")
		}
	}

	// Clear l'état triggered → la prochaine traversée de seuil pourra fire.
	_ = e.state.ClearTriggered(ctx, r.ID, deviceSlug)
}

// buildTplContext rassemble les infos exposables aux templates de messages.
// `currentValue` est nil pour les triggers cron (pas de mesure courante).
func (e *Engine) buildTplContext(r store.Loaded, currentValue *float64) template.Context {
	tpl := template.Context{
		RuleID:     r.ID,
		RuleName:   r.Name,
		TenantSlug: r.TenantSlug,
		Timestamp:  time.Now().UTC(),
	}
	t := r.Definition.Trigger
	tpl.DeviceSlug = t.DeviceSlug
	tpl.Measurement = t.Measurement
	tpl.Op = t.Op
	if t.Type == "threshold" {
		v := t.Value
		tpl.Threshold = &v
	}
	if currentValue != nil {
		v := *currentValue
		tpl.Value = &v
	}
	if d, ok := e.LookupDevice(r.TenantSlug, t.DeviceSlug); ok {
		tpl.SiteSlug = d.SiteSlug
		tpl.SiteName = d.SiteName
		tpl.ZoneSlug = d.ZoneSlug
		tpl.ZoneName = d.ZoneName
		tpl.DeviceName = d.DeviceName
	}
	return tpl
}

func (e *Engine) checkTrigger(ctx context.Context, ruleID uuid.UUID, deviceSlug string, t definition.Trigger, current float64) (bool, error) {
	switch t.Type {
	case "threshold":
		matched := definition.Compare(current, t.Value, t.Op)
		if t.SustainedSeconds <= 0 {
			return matched, nil
		}
		if !matched {
			// La condition redevient fausse → on reset le compteur sustained.
			_ = e.state.ClearSustained(ctx, ruleID, deviceSlug)
			return false, nil
		}
		// Condition vraie : pose la marque "since" et vérifie la durée.
		since, err := e.state.MarkSustainedSince(ctx, ruleID, deviceSlug, time.Duration(t.SustainedSeconds)*time.Second)
		if err != nil {
			return false, err
		}
		elapsed := time.Now().Unix() - since
		return elapsed >= int64(t.SustainedSeconds), nil

	case "value_change":
		// Récupère la valeur précédente AVANT que SetLastValue (déjà appelé)
		// l'écrase. Ici on n'a plus accès à l'ancienne — pour faire propre il
		// faudrait stocker prev/curr séparément. MVP : on déclenche dès que
		// la valeur courante == To et que From est nil ou différent.
		if t.To != nil && current != *t.To {
			return false, nil
		}
		if t.From != nil {
			// Pour MVP simple, on ne vérifie pas From (nécessite stockage prev).
			_ = t.From
		}
		return true, nil
	}
	return false, nil
}

// fire vérifie conditions + cooldown puis exécute les actions.
func (e *Engine) fire(ctx context.Context, r store.Loaded, tplCtx template.Context) {
	// 2. Conditions
	ok, err := evaluator.EvaluateConditions(ctx, e.state, r.Definition.Conditions, r.Definition.ConditionsOp)
	if err != nil {
		e.log.Warn().Err(err).Str("rule_id", r.ID.String()).Msg("conditions eval failed")
		return
	}
	if !ok {
		return
	}

	// 3. Cooldown — keyé par device pour zone_scope (chaque device a son
	// propre cooldown indépendant).
	cooldownDevice := r.Definition.Trigger.DeviceSlug
	inCool, _ := e.state.IsInCooldown(ctx, r.ID, cooldownDevice)
	if inCool {
		metrics.RuleSkippedCooldown.Inc()
		return
	}

	// 4. Execute
	start := time.Now()
	taken, status, errMsg := e.exec.ExecuteAll(ctx, r.ID, r.TenantSlug, r.Definition.Actions, tplCtx)
	latency := time.Since(start)
	metrics.ExecutionLatency.Observe(latency.Seconds())
	metrics.RuleExecutions.WithLabelValues(status).Inc()

	// 5. Audit
	e.store.LogExecution(ctx, r.ID, taken, status, errMsg, int(latency.Milliseconds()))

	// 6. Cooldown
	if r.Definition.CooldownSeconds > 0 {
		_ = e.state.SetCooldown(ctx, r.ID, cooldownDevice, time.Duration(r.Definition.CooldownSeconds)*time.Second)
	}

	// 7. Reset sustained (la règle s'est déclenchée → on repart à zéro pour
	// la prochaine fois).
	if r.Definition.Trigger.Type == "threshold" && r.Definition.Trigger.SustainedSeconds > 0 {
		_ = e.state.ClearSustained(ctx, r.ID, cooldownDevice)
	}

	e.log.Info().
		Str("rule_id", r.ID.String()).
		Str("rule", r.Name).
		Str("status", status).
		Dur("latency", latency).
		Msg("rule fired")
}

// RefreshCron synchronise les entrées cron de robfig avec les règles type cron.
// Appelée après chaque reload du store.
func (e *Engine) RefreshCron() {
	e.cronMu.Lock()
	defer e.cronMu.Unlock()

	current := e.store.All()

	// Retirer les entrées cron pour les règles disparues / non-cron.
	for ruleID, entryID := range e.cronEntries {
		r, ok := current[ruleID]
		if !ok || r.Definition.Trigger.Type != "cron" {
			e.cron.Remove(entryID)
			delete(e.cronEntries, ruleID)
		}
	}
	// Ajouter les nouvelles
	for id, r := range current {
		if r.Definition.Trigger.Type != "cron" {
			continue
		}
		if _, ok := e.cronEntries[id]; ok {
			continue
		}
		ruleCopy := r
		entryID, err := e.cron.AddFunc(r.Definition.Trigger.Schedule, func() {
			// Time window : skip si le cron tombe hors créneau.
			if !ruleCopy.Definition.TimeWindow.IsActiveAt(time.Now()) {
				metrics.TriggerEvaluations.WithLabelValues("cron", "out_of_window").Inc()
				return
			}
			metrics.TriggerEvaluations.WithLabelValues("cron", "matched").Inc()
			ctxBg := context.Background()
			tpl := e.buildTplContext(ruleCopy, nil)
			e.fire(ctxBg, ruleCopy, tpl)
		})
		if err != nil {
			e.log.Warn().Err(err).Str("rule_id", id.String()).Str("cron", r.Definition.Trigger.Schedule).Msg("invalid cron expression")
			continue
		}
		e.cronEntries[id] = entryID
		e.log.Info().Str("rule_id", id.String()).Str("cron", r.Definition.Trigger.Schedule).Msg("cron registered")
	}
	metrics.RulesActive.Set(float64(len(current)))
}
