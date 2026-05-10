package profiles

import (
	"context"
	"encoding/json"
	"math/rand"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zeina/hyperviseur/packages/shared/domain"
	"github.com/zeina/hyperviseur/services/simulator/internal/bus"
	"github.com/zeina/hyperviseur/services/simulator/internal/scheduler"
)

func newState(deviceID string, b *bus.Bus, sch *scheduler.Schedule, now time.Time, seed int64) *State {
	return &State{
		DeviceID: deviceID,
		ZoneID:   "z",
		SiteID:   "s",
		Now:      now,
		Rand:     rand.New(rand.NewSource(seed)),
		Schedule: sch,
		Bus:      b,
	}
}

func TestEnvironmentProducesAllMeasurements(t *testing.T) {
	p, err := NewEnvironment([]string{"temperature", "humidity", "co2", "lux"})
	require.NoError(t, err)

	st := newState("env-01", bus.New(), nil, time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC), 42)
	st.Internal = p.InitState()

	out := p.Tick(context.Background(), st)
	require.Len(t, out, 4)

	got := map[string]Reading{}
	for _, r := range out {
		got[r.Name] = r
	}
	assert.Contains(t, got, "temperature")
	assert.Contains(t, got, "humidity")
	assert.Contains(t, got, "co2")
	assert.Contains(t, got, "lux")
	assert.Equal(t, "celsius", got["temperature"].Unit)
	assert.Equal(t, "ppm", got["co2"].Unit)
	assert.Equal(t, "lux", got["lux"].Unit)
}

func TestEnvironmentDeterministicWithSeed(t *testing.T) {
	now := time.Date(2026, 5, 5, 14, 0, 0, 0, time.UTC)

	run := func() []float64 {
		p, _ := NewEnvironment([]string{"temperature"})
		st := newState("env-01", bus.New(), nil, now, 123)
		st.Internal = p.InitState()
		var values []float64
		for i := 0; i < 20; i++ {
			r := p.Tick(context.Background(), st)
			values = append(values, r[0].Value)
		}
		return values
	}

	a := run()
	b := run()
	assert.Equal(t, a, b, "even seed must produce identical sequences")
}

func TestEnvironmentCO2RisesWhenOccupied(t *testing.T) {
	p, _ := NewEnvironment([]string{"co2"})
	b := bus.New()
	b.Set("pir-01", true) // zone occupée

	st := newState("env-01", b, nil, time.Date(2026, 5, 5, 14, 0, 0, 0, time.UTC), 42)
	st.PresenceID = "pir-01"
	st.Internal = p.InitState()

	first := p.Tick(context.Background(), st)[0].Value
	for i := 0; i < 50; i++ {
		st.Now = st.Now.Add(time.Minute)
		p.Tick(context.Background(), st)
	}
	last := p.Tick(context.Background(), st)[0].Value
	assert.Greater(t, last, first+200, "CO2 should rise significantly when occupied for 50min")
}

func TestEnvironmentLuxRespondsToLightRelay(t *testing.T) {
	p, _ := NewEnvironment([]string{"lux"})
	b := bus.New()
	b.Set("relay-light-01", "off")

	now := time.Date(2026, 5, 5, 22, 0, 0, 0, time.UTC) // nuit
	stOff := newState("env-01", b, nil, now, 42)
	stOff.LightRelayID = "relay-light-01"
	stOff.Internal = p.InitState()
	luxOff := p.Tick(context.Background(), stOff)[0].Value

	b.Set("relay-light-01", "on")
	stOn := newState("env-01", b, nil, now, 42)
	stOn.LightRelayID = "relay-light-01"
	stOn.Internal = p.InitState()
	luxOn := p.Tick(context.Background(), stOn)[0].Value

	assert.Greater(t, luxOn, luxOff+300, "lux should jump when light is on at night")
}

func TestPresencePublishesOnBus(t *testing.T) {
	p := &Presence{}
	b := bus.New()
	sch, _ := scheduler.Parse("occupied 08:00-18:00 mon-fri")

	// Lundi 9h — doit être occupé ~90% du temps
	occupied := 0
	for i := 0; i < 200; i++ {
		st := newState("pir-01", b, sch, time.Date(2026, 5, 4, 9, 0, 0, 0, time.UTC), int64(i))
		st.Internal = p.InitState()
		out := p.Tick(context.Background(), st)
		require.Len(t, out, 1)
		if out[0].Value == 1.0 {
			occupied++
		}
	}
	assert.Greater(t, occupied, 150, "should be occupied >75%% of ticks during work hours")
}

func TestPresenceNotCommandable(t *testing.T) {
	p := &Presence{}
	_, err := p.HandleCommand(context.Background(), &State{}, domain.CommandPayload{Payload: json.RawMessage(`{}`)})
	require.Error(t, err)
}

func TestActuatorInitialState(t *testing.T) {
	a := NewActuator("on")
	st := &State{Bus: bus.New(), DeviceID: "relay-01"}
	st.Internal = a.InitState()

	payload := a.InitialStatePayload(st)
	require.NotNil(t, payload)

	var s domain.StatePayload
	require.NoError(t, json.Unmarshal(payload, &s))

	var inner map[string]string
	require.NoError(t, json.Unmarshal(s.State, &inner))
	assert.Equal(t, "on", inner["state"])
	assert.Equal(t, "on", st.Bus.GetString("relay-01", "??"))
}

func TestActuatorHandleCommand(t *testing.T) {
	a := NewActuator("off")
	st := &State{Bus: bus.New(), DeviceID: "relay-01"}
	st.Internal = a.InitState()
	a.InitialStatePayload(st)

	cmd := domain.CommandPayload{
		ID:      "cmd-123",
		TS:      time.Now().UTC(),
		Payload: json.RawMessage(`{"state":"on"}`),
	}
	out, err := a.HandleCommand(context.Background(), st, cmd)
	require.NoError(t, err)

	var s domain.StatePayload
	require.NoError(t, json.Unmarshal(out, &s))
	assert.Equal(t, "cmd-123", s.CmdID, "ACK must reference the issuing command")

	var inner map[string]string
	require.NoError(t, json.Unmarshal(s.State, &inner))
	assert.Equal(t, "on", inner["state"])
	assert.Equal(t, "on", st.Bus.GetString("relay-01", "??"))
}

func TestActuatorRejectsInvalidState(t *testing.T) {
	a := NewActuator("off")
	st := &State{Bus: bus.New(), DeviceID: "relay-01"}
	st.Internal = a.InitState()

	cmd := domain.CommandPayload{Payload: json.RawMessage(`{"state":"maybe"}`)}
	_, err := a.HandleCommand(context.Background(), st, cmd)
	require.Error(t, err)
}

func TestLinkyEnergyMonotonic(t *testing.T) {
	p := &Linky{}
	b := bus.New()
	st := newState("linky-01", b, nil, time.Date(2026, 5, 5, 14, 0, 0, 0, time.UTC), 7)
	st.Internal = p.InitState()

	var lastBase float64 = -1
	for i := 0; i < 30; i++ {
		st.Now = st.Now.Add(10 * time.Second)
		readings := p.Tick(context.Background(), st)
		var base float64
		for _, r := range readings {
			if r.Name == "base" {
				base = r.Value
			}
		}
		if lastBase >= 0 {
			assert.GreaterOrEqual(t, base, lastBase, "energy index must be monotonic")
		}
		lastBase = base
	}
	assert.Greater(t, lastBase, 0.0, "energy must accumulate")
}

func TestLinkyHasAllExpectedMeasurements(t *testing.T) {
	p := &Linky{}
	st := newState("linky-01", bus.New(), nil, time.Date(2026, 5, 5, 14, 0, 0, 0, time.UTC), 7)
	st.Internal = p.InitState()

	out := p.Tick(context.Background(), st)
	names := map[string]bool{}
	for _, r := range out {
		names[r.Name] = true
	}
	for _, want := range []string{"papp", "pact", "iinst", "urms", "base"} {
		assert.True(t, names[want], "missing measurement %s", want)
	}
}
