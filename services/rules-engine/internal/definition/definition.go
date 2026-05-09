// Package definition décrit le format JSON d'une règle ZEINA.
//
// Format minimal :
//
//	{
//	  "trigger": {
//	    "type": "threshold" | "value_change" | "cron",
//	    ... params spécifiques au type ...
//	  },
//	  "conditions_op": "AND" | "OR",   // optionnel, défaut AND
//	  "conditions": [
//	    { "device_slug": "pir-01", "measurement": "presence", "op": "==", "value": 1 }
//	  ],
//	  "actions": [
//	    { "type": "set_actuator", "device_slug": "relay-light-01", "state": "off" },
//	    { "type": "notify", "level": "warning", "message": "..." }
//	  ],
//	  "cooldown_seconds": 300
//	}
//
// Le moteur reconnaît :
//   - trigger.type = "threshold"     : franchissement de seuil sur une mesure,
//     avec option `sustained_seconds` pour
//     exiger la condition pendant N secondes
//   - trigger.type = "value_change"  : transition d'une valeur à une autre
//     (ex: presence 1→0)
//   - trigger.type = "cron"          : déclenchement à des heures fixes
//     (expression cron 5 champs Unix)
package definition

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Rule — règle complète parsée depuis JSONB.
type Rule struct {
	Trigger         Trigger     `json:"trigger"`
	ConditionsOp    string      `json:"conditions_op,omitempty"` // AND (défaut) | OR
	Conditions      []Condition `json:"conditions,omitempty"`
	Actions         []Action    `json:"actions"`
	CooldownSeconds int         `json:"cooldown_seconds,omitempty"`
	// TimeWindow — créneau pendant lequel la règle est active. Hors créneau,
	// le trigger n'est même pas évalué. Optionnel : nil = toujours active.
	TimeWindow *TimeWindow `json:"time_window,omitempty"`
}

// TimeWindow définit un créneau temporel récurrent (jours + heures + fuseau)
// pendant lequel la règle s'évalue. Le fuseau permet d'aligner sur l'heure
// locale du site (ex: Africa/Ouagadougou) plutôt que UTC.
type TimeWindow struct {
	// Days — jours actifs (0=dimanche, 1=lundi, …, 6=samedi). Vide = tous.
	Days []int `json:"days,omitempty"`
	// StartHour / EndHour — bornes en heures locales (0-24). Si End < Start,
	// la fenêtre traverse minuit (ex: 22h → 6h pour les nuits).
	StartHour float64 `json:"start_hour,omitempty"`
	EndHour   float64 `json:"end_hour,omitempty"`
	// Timezone — IANA tz name (ex: "Europe/Paris", "Africa/Ouagadougou").
	// Vide = UTC.
	Timezone string `json:"timezone,omitempty"`
}

// Trigger — élément déclencheur de la règle.
type Trigger struct {
	Type             string  `json:"type"` // threshold | value_change | cron | aggregate | anomaly
	DeviceSlug       string  `json:"device_slug,omitempty"`
	Measurement      string  `json:"measurement,omitempty"`
	Op               string  `json:"op,omitempty"` // > | >= | < | <= | == | !=
	Value            float64 `json:"value,omitempty"`
	SustainedSeconds int     `json:"sustained_seconds,omitempty"`

	// value_change
	From *float64 `json:"from,omitempty"`
	To   *float64 `json:"to,omitempty"`

	// cron
	Schedule string `json:"schedule,omitempty"` // expression cron 5 champs : "0 18 * * 1-5"

	// Scope par zone — alternative à DeviceSlug. Si ZoneScope est non-nil, le
	// trigger s'applique à TOUS les devices de la zone qui exposent
	// `Measurement`. Le champ DeviceSlug est ignoré dans ce mode.
	ZoneScope *ZoneScope `json:"zone_scope,omitempty"`

	// Aggregate — pour trigger.type == "aggregate". Calcule un agrégat
	// (avg/sum/min/max/count) sur une fenêtre rolling et compare à Value.
	Aggregate *AggregateSpec `json:"aggregate,omitempty"`

	// Anomaly — pour trigger.type == "anomaly". Détecte une dérive vs une
	// baseline statistique calculée sur les N derniers jours à la même heure.
	Anomaly *AnomalySpec `json:"anomaly,omitempty"`
}

// ZoneScope — étend un trigger à tous les devices d'une zone qui ont la mesure
// référencée. La règle se déclenche par device individuellement (un cooldown
// par device, pas par règle).
type ZoneScope struct {
	ZoneID string `json:"zone_id"`
	// DeviceType — filtre optionnel par type (ex: "environment", "linky").
	DeviceType string `json:"device_type,omitempty"`
}

// AggregateSpec — agrégat rolling sur les CAGGs Timescale.
//
//	{ op: "avg" | "sum" | "min" | "max" | "count", window_minutes: 60 }
type AggregateSpec struct {
	Op            string `json:"op"`             // avg | sum | min | max | count
	WindowMinutes int    `json:"window_minutes"` // taille de la fenêtre rolling
}

// AnomalySpec — détection d'écart vs baseline.
//
//	{ baseline_days: 14, sigma: 3 }
//
// Pour la valeur courante v, on calcule mu (moyenne) et sigma sur les N
// derniers jours à la même heure. Anomaly si |v - mu| > Sigma * sigma_obs.
type AnomalySpec struct {
	BaselineDays int     `json:"baseline_days"`
	Sigma        float64 `json:"sigma"` // ex: 3.0 (3-sigma rule)
}

// Condition — booléen évalué sur le dernier état observé d'un device.
type Condition struct {
	DeviceSlug  string  `json:"device_slug"`
	Measurement string  `json:"measurement"`
	Op          string  `json:"op"` // > | >= | < | <= | == | !=
	Value       float64 `json:"value"`
}

// Action — effet à appliquer si la règle se déclenche.
type Action struct {
	Type string `json:"type"` // set_actuator | notify | email | sms | webhook | alarm

	// set_actuator
	DeviceSlug string `json:"device_slug,omitempty"`
	State      string `json:"state,omitempty"`

	// notify
	Level   string `json:"level,omitempty"` // info | warning | critical
	Message string `json:"message,omitempty"`

	// email
	Recipients []string `json:"recipients,omitempty"` // adresses destinataires
	Subject    string   `json:"subject,omitempty"`

	// sms — utilise Recipients pour les numéros, Message pour le corps

	// webhook — POST/PUT/PATCH/GET vers une URL externe.
	URL     string            `json:"url,omitempty"`
	Method  string            `json:"method,omitempty"` // défaut POST
	Headers map[string]string `json:"headers,omitempty"`
	Body    string            `json:"body,omitempty"`

	// alarm — crée (ou réveille) une alarme dans la table `alarms`. Chaque
	// re-déclenchement de la même règle sur le même device incrémente le
	// compteur et ajoute un event au lieu de créer une nouvelle alarme.
	Severity    string `json:"severity,omitempty"`     // minor | major | critical
	Label       string `json:"label,omitempty"`        // ex: "Dépassement de seuil"
	Name        string `json:"name,omitempty"`         // ex: "CO₂ Salle 204"
	Description string `json:"description,omitempty"`
	Model       string `json:"model,omitempty"`        // ex: "Standard"
	StatusText  string `json:"status_text,omitempty"`  // ex: "Comportement anormal"
}

// Validate vérifie l'invariant de structure d'une règle.
func (r *Rule) Validate() error {
	if err := r.Trigger.validate(); err != nil {
		return err
	}
	if op := r.ConditionsOp; op != "" && op != "AND" && op != "OR" {
		return fmt.Errorf("conditions_op must be AND or OR")
	}
	for i, c := range r.Conditions {
		if err := c.validate(); err != nil {
			return fmt.Errorf("condition[%d]: %w", i, err)
		}
	}
	if len(r.Actions) == 0 {
		return fmt.Errorf("at least one action required")
	}
	for i, a := range r.Actions {
		if err := a.validate(); err != nil {
			return fmt.Errorf("action[%d]: %w", i, err)
		}
	}
	if r.TimeWindow != nil {
		if err := r.TimeWindow.validate(); err != nil {
			return fmt.Errorf("time_window: %w", err)
		}
	}
	return nil
}

func (w TimeWindow) validate() error {
	for _, d := range w.Days {
		if d < 0 || d > 6 {
			return fmt.Errorf("day must be 0-6 (got %d)", d)
		}
	}
	if w.StartHour < 0 || w.StartHour > 24 || w.EndHour < 0 || w.EndHour > 24 {
		return fmt.Errorf("start_hour and end_hour must be 0-24")
	}
	return nil
}

func (t Trigger) validate() error {
	switch t.Type {
	case "threshold":
		if (t.DeviceSlug == "" && t.ZoneScope == nil) || t.Measurement == "" || t.Op == "" {
			return fmt.Errorf("threshold needs (device_slug OR zone_scope) + measurement + op + value")
		}
		if !validOp(t.Op) {
			return fmt.Errorf("invalid op %q", t.Op)
		}
	case "value_change":
		if (t.DeviceSlug == "" && t.ZoneScope == nil) || t.Measurement == "" {
			return fmt.Errorf("value_change needs (device_slug OR zone_scope) + measurement")
		}
	case "cron":
		if t.Schedule == "" {
			return fmt.Errorf("cron needs schedule")
		}
	case "aggregate":
		if (t.DeviceSlug == "" && t.ZoneScope == nil) || t.Measurement == "" || t.Op == "" {
			return fmt.Errorf("aggregate needs (device_slug OR zone_scope) + measurement + op + value")
		}
		if !validOp(t.Op) {
			return fmt.Errorf("invalid op %q", t.Op)
		}
		if t.Aggregate == nil {
			return fmt.Errorf("aggregate trigger needs aggregate spec")
		}
		if err := t.Aggregate.validate(); err != nil {
			return err
		}
	case "anomaly":
		if (t.DeviceSlug == "" && t.ZoneScope == nil) || t.Measurement == "" {
			return fmt.Errorf("anomaly needs (device_slug OR zone_scope) + measurement")
		}
		if t.Anomaly == nil {
			return fmt.Errorf("anomaly trigger needs anomaly spec")
		}
		if err := t.Anomaly.validate(); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown trigger type %q", t.Type)
	}
	if t.ZoneScope != nil {
		if t.ZoneScope.ZoneID == "" {
			return fmt.Errorf("zone_scope needs zone_id")
		}
	}
	return nil
}

func (a AggregateSpec) validate() error {
	switch a.Op {
	case "avg", "sum", "min", "max", "count":
	default:
		return fmt.Errorf("aggregate op must be avg|sum|min|max|count (got %q)", a.Op)
	}
	if a.WindowMinutes <= 0 {
		return fmt.Errorf("window_minutes must be > 0")
	}
	return nil
}

func (a AnomalySpec) validate() error {
	if a.BaselineDays < 1 || a.BaselineDays > 90 {
		return fmt.Errorf("baseline_days must be 1-90")
	}
	if a.Sigma <= 0 {
		return fmt.Errorf("sigma must be > 0")
	}
	return nil
}

func (c Condition) validate() error {
	if c.DeviceSlug == "" || c.Measurement == "" || c.Op == "" {
		return fmt.Errorf("device_slug, measurement and op required")
	}
	if !validOp(c.Op) {
		return fmt.Errorf("invalid op %q", c.Op)
	}
	return nil
}

func (a Action) validate() error {
	switch a.Type {
	case "set_actuator":
		if a.DeviceSlug == "" || a.State == "" {
			return fmt.Errorf("set_actuator needs device_slug + state")
		}
	case "notify":
		if a.Message == "" {
			return fmt.Errorf("notify needs message")
		}
	case "email":
		if len(a.Recipients) == 0 {
			return fmt.Errorf("email needs at least one recipient")
		}
		if a.Subject == "" {
			return fmt.Errorf("email needs subject")
		}
		if a.Message == "" {
			return fmt.Errorf("email needs message")
		}
		for _, r := range a.Recipients {
			if !strings.Contains(r, "@") || !strings.Contains(r, ".") {
				return fmt.Errorf("invalid email %q", r)
			}
		}
	case "sms":
		if len(a.Recipients) == 0 {
			return fmt.Errorf("sms needs at least one phone number")
		}
		if a.Message == "" {
			return fmt.Errorf("sms needs message")
		}
	case "webhook":
		if a.URL == "" {
			return fmt.Errorf("webhook needs url")
		}
		m := strings.ToUpper(a.Method)
		if m != "" && m != "GET" && m != "POST" && m != "PUT" && m != "PATCH" && m != "DELETE" {
			return fmt.Errorf("webhook invalid method %q", a.Method)
		}
	case "alarm":
		if a.Name == "" {
			return fmt.Errorf("alarm needs name")
		}
		if a.Severity != "" && a.Severity != "minor" && a.Severity != "major" && a.Severity != "critical" {
			return fmt.Errorf("alarm invalid severity %q (minor|major|critical)", a.Severity)
		}
	default:
		return fmt.Errorf("unknown action type %q", a.Type)
	}
	return nil
}

// IsActiveAt indique si le créneau est ouvert au moment t (en convertissant
// dans le fuseau de la fenêtre). Une fenêtre nil = toujours active.
func (w *TimeWindow) IsActiveAt(t time.Time) bool {
	if w == nil {
		return true
	}
	loc := time.UTC
	if w.Timezone != "" {
		if l, err := time.LoadLocation(w.Timezone); err == nil {
			loc = l
		}
	}
	t = t.In(loc)

	// Filtre par jour de semaine si Days non vide.
	if len(w.Days) > 0 {
		wd := int(t.Weekday())
		ok := false
		for _, d := range w.Days {
			if d == wd {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}

	// Filtre par heure. Si Start == End, fenêtre toujours active (cas
	// "tous horaires"). Si End < Start, fenêtre traverse minuit.
	if w.StartHour == 0 && w.EndHour == 0 {
		return true
	}
	hours := float64(t.Hour()) + float64(t.Minute())/60.0
	if w.EndHour >= w.StartHour {
		return hours >= w.StartHour && hours < w.EndHour
	}
	// Fenêtre nocturne (ex: 22h → 6h).
	return hours >= w.StartHour || hours < w.EndHour
}

func validOp(op string) bool {
	switch op {
	case ">", ">=", "<", "<=", "==", "!=":
		return true
	}
	return false
}

// Compare évalue val OP threshold.
func Compare(val, threshold float64, op string) bool {
	switch op {
	case ">":
		return val > threshold
	case ">=":
		return val >= threshold
	case "<":
		return val < threshold
	case "<=":
		return val <= threshold
	case "==":
		return val == threshold
	case "!=":
		return val != threshold
	}
	return false
}

// Parse — désérialise une règle depuis JSON et valide.
func Parse(raw []byte) (*Rule, error) {
	var r Rule
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("rule json: %w", err)
	}
	if err := r.Validate(); err != nil {
		return nil, err
	}
	return &r, nil
}
