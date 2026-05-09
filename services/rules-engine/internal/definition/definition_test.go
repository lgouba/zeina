package definition

import (
	"strings"
	"testing"
	"time"
)

func TestTimeWindowNilAlwaysActive(t *testing.T) {
	var w *TimeWindow
	if !w.IsActiveAt(time.Now()) {
		t.Error("nil TimeWindow should always be active")
	}
}

func TestTimeWindowDays(t *testing.T) {
	// Lundi-vendredi (1..5) uniquement.
	w := &TimeWindow{Days: []int{1, 2, 3, 4, 5}}
	mon := time.Date(2026, 5, 4, 10, 0, 0, 0, time.UTC)  // lundi
	sat := time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC)  // samedi
	if !w.IsActiveAt(mon) {
		t.Error("monday should be active")
	}
	if w.IsActiveAt(sat) {
		t.Error("saturday should be inactive")
	}
}

func TestTimeWindowHours(t *testing.T) {
	// 8h-18h
	w := &TimeWindow{StartHour: 8, EndHour: 18}
	at7 := time.Date(2026, 5, 4, 7, 0, 0, 0, time.UTC)
	at12 := time.Date(2026, 5, 4, 12, 0, 0, 0, time.UTC)
	at18 := time.Date(2026, 5, 4, 18, 0, 0, 0, time.UTC)
	if w.IsActiveAt(at7) {
		t.Error("07:00 should be inactive")
	}
	if !w.IsActiveAt(at12) {
		t.Error("12:00 should be active")
	}
	if w.IsActiveAt(at18) {
		t.Error("18:00 should be inactive (exclusive end)")
	}
}

func TestTimeWindowOvernight(t *testing.T) {
	// 22h-6h (nuit)
	w := &TimeWindow{StartHour: 22, EndHour: 6}
	at23 := time.Date(2026, 5, 4, 23, 0, 0, 0, time.UTC)
	at5 := time.Date(2026, 5, 4, 5, 0, 0, 0, time.UTC)
	at12 := time.Date(2026, 5, 4, 12, 0, 0, 0, time.UTC)
	if !w.IsActiveAt(at23) {
		t.Error("23:00 should be active (overnight)")
	}
	if !w.IsActiveAt(at5) {
		t.Error("05:00 should be active (overnight)")
	}
	if w.IsActiveAt(at12) {
		t.Error("12:00 should be inactive (overnight)")
	}
}

func TestTimeWindowTimezone(t *testing.T) {
	// 8h-18h heure de Paris.
	w := &TimeWindow{StartHour: 8, EndHour: 18, Timezone: "Europe/Paris"}
	// 7h UTC = 9h Paris (été) → actif
	utc7 := time.Date(2026, 7, 1, 7, 0, 0, 0, time.UTC)
	if !w.IsActiveAt(utc7) {
		t.Error("07:00 UTC should be 09:00 Paris (active in summer)")
	}
}

func TestWebhookValidate(t *testing.T) {
	a := Action{Type: "webhook"}
	if err := a.validate(); err == nil {
		t.Error("webhook without url should fail")
	}
	a.URL = "https://hooks.slack.com/abc"
	if err := a.validate(); err != nil {
		t.Errorf("webhook with url should pass: %v", err)
	}
	a.Method = "BOGUS"
	if err := a.validate(); err == nil {
		t.Error("webhook with bad method should fail")
	}
	a.Method = "POST"
	if err := a.validate(); err != nil {
		t.Errorf("POST should pass: %v", err)
	}
}

func TestCompare(t *testing.T) {
	cases := []struct {
		val, threshold float64
		op             string
		want           bool
	}{
		{5, 3, ">", true},
		{3, 5, ">", false},
		{3, 3, ">=", true},
		{3, 3, "<", false},
		{3, 3, "<=", true},
		{3, 3, "==", true},
		{3, 4, "!=", true},
		{3, 3, "!=", false},
		// op inconnu ⇒ false (pas de match)
		{3, 3, "garbage", false},
		{3, 3, "", false},
	}
	for _, c := range cases {
		t.Run(c.op, func(t *testing.T) {
			got := Compare(c.val, c.threshold, c.op)
			if got != c.want {
				t.Errorf("Compare(%v, %v, %q) = %v, want %v", c.val, c.threshold, c.op, got, c.want)
			}
		})
	}
}

func TestRule_Validate_Trigger(t *testing.T) {
	cases := []struct {
		name    string
		t       Trigger
		wantErr string // sous-chaîne attendue dans l'erreur, "" = pas d'erreur
	}{
		{
			name: "threshold ok",
			t:    Trigger{Type: "threshold", DeviceSlug: "d1", Measurement: "co2", Op: ">", Value: 1000},
		},
		{
			name:    "threshold without device_slug",
			t:       Trigger{Type: "threshold", Measurement: "co2", Op: ">"},
			wantErr: "(device_slug OR zone_scope)",
		},
		{
			name:    "threshold invalid op",
			t:       Trigger{Type: "threshold", DeviceSlug: "d1", Measurement: "co2", Op: "~"},
			wantErr: "invalid op",
		},
		{
			name: "value_change ok",
			t:    Trigger{Type: "value_change", DeviceSlug: "d1", Measurement: "presence"},
		},
		{
			name:    "value_change without measurement",
			t:       Trigger{Type: "value_change", DeviceSlug: "d1"},
			wantErr: "needs (device_slug OR zone_scope) + measurement",
		},
		{
			name: "cron ok",
			t:    Trigger{Type: "cron", Schedule: "0 18 * * 1-5"},
		},
		{
			name:    "cron empty schedule",
			t:       Trigger{Type: "cron"},
			wantErr: "needs schedule",
		},
		{
			name:    "unknown type",
			t:       Trigger{Type: "wat"},
			wantErr: "unknown trigger type",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := &Rule{Trigger: c.t, Actions: []Action{{Type: "notify", Message: "x"}}}
			err := r.Validate()
			if c.wantErr == "" {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Errorf("err = %v, want substring %q", err, c.wantErr)
			}
		})
	}
}

func TestRule_Validate_Action(t *testing.T) {
	base := Trigger{Type: "cron", Schedule: "0 18 * * *"}

	cases := []struct {
		name    string
		a       Action
		wantErr string
	}{
		{"set_actuator ok", Action{Type: "set_actuator", DeviceSlug: "relay-1", State: "on"}, ""},
		{"set_actuator missing state", Action{Type: "set_actuator", DeviceSlug: "relay-1"}, "needs device_slug + state"},
		{"notify ok", Action{Type: "notify", Message: "hello"}, ""},
		{"notify empty message", Action{Type: "notify"}, "needs message"},
		{"email ok", Action{Type: "email", Recipients: []string{"a@b.com"}, Subject: "x", Message: "y"}, ""},
		{"email no recipients", Action{Type: "email", Subject: "x", Message: "y"}, "needs at least one recipient"},
		{"email invalid address", Action{Type: "email", Recipients: []string{"not-an-email"}, Subject: "x", Message: "y"}, "invalid email"},
		{"email no subject", Action{Type: "email", Recipients: []string{"a@b.com"}, Message: "y"}, "needs subject"},
		{"sms ok", Action{Type: "sms", Recipients: []string{"+22670000000"}, Message: "alerte"}, ""},
		{"sms no recipients", Action{Type: "sms", Message: "x"}, "needs at least one phone number"},
		{"unknown type", Action{Type: "magic"}, "unknown action type"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := &Rule{Trigger: base, Actions: []Action{c.a}}
			err := r.Validate()
			if c.wantErr == "" {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Errorf("err = %v, want substring %q", err, c.wantErr)
			}
		})
	}
}

func TestRule_Validate_NoActions(t *testing.T) {
	r := &Rule{Trigger: Trigger{Type: "cron", Schedule: "0 0 * * *"}, Actions: nil}
	if err := r.Validate(); err == nil || !strings.Contains(err.Error(), "at least one action") {
		t.Errorf("expected 'at least one action' error, got %v", err)
	}
}

func TestRule_Validate_ConditionsOp(t *testing.T) {
	cases := []struct {
		op      string
		wantErr bool
	}{
		{"AND", false},
		{"OR", false},
		{"", false}, // défaut → AND
		{"and", true},
		{"XOR", true},
	}
	for _, c := range cases {
		t.Run(c.op, func(t *testing.T) {
			r := &Rule{
				Trigger:      Trigger{Type: "cron", Schedule: "0 0 * * *"},
				ConditionsOp: c.op,
				Actions:      []Action{{Type: "notify", Message: "x"}},
			}
			err := r.Validate()
			if c.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !c.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestRule_Validate_Condition(t *testing.T) {
	r := &Rule{
		Trigger: Trigger{Type: "cron", Schedule: "0 0 * * *"},
		Conditions: []Condition{
			{DeviceSlug: "d1", Measurement: "presence", Op: "==", Value: 1},
		},
		Actions: []Action{{Type: "notify", Message: "x"}},
	}
	if err := r.Validate(); err != nil {
		t.Errorf("valid rule rejected: %v", err)
	}

	// op invalide
	r.Conditions[0].Op = "~~"
	if err := r.Validate(); err == nil || !strings.Contains(err.Error(), "invalid op") {
		t.Errorf("expected invalid op, got %v", err)
	}
}

func TestParse_RoundTrip(t *testing.T) {
	raw := []byte(`{
		"trigger": {"type":"threshold","device_slug":"d1","measurement":"co2","op":">","value":1000,"sustained_seconds":60},
		"conditions_op": "AND",
		"conditions": [{"device_slug":"d1","measurement":"presence","op":"==","value":1}],
		"actions": [
			{"type":"notify","level":"warning","message":"CO2 trop élevé"},
			{"type":"email","recipients":["ops@acme.test"],"subject":"Alerte","message":"CO2 trop élevé"}
		],
		"cooldown_seconds": 300
	}`)
	r, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if r.Trigger.Type != "threshold" || r.Trigger.Value != 1000 {
		t.Errorf("trigger lost: %+v", r.Trigger)
	}
	if r.CooldownSeconds != 300 {
		t.Errorf("cooldown = %d, want 300", r.CooldownSeconds)
	}
	if len(r.Actions) != 2 {
		t.Errorf("actions = %d, want 2", len(r.Actions))
	}
	if r.Actions[1].Type != "email" || len(r.Actions[1].Recipients) != 1 {
		t.Errorf("email action lost: %+v", r.Actions[1])
	}
}

func TestParse_RejectsInvalid(t *testing.T) {
	cases := []struct {
		name string
		raw  string
	}{
		{"unknown trigger", `{"trigger":{"type":"magic"},"actions":[{"type":"notify","message":"x"}]}`},
		{"no actions", `{"trigger":{"type":"cron","schedule":"0 0 * * *"},"actions":[]}`},
		{"malformed json", `{"trigger":}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := Parse([]byte(c.raw)); err == nil {
				t.Error("expected error, got nil")
			}
		})
	}
}
