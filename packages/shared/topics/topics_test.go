package topics

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildMeasurementTopic(t *testing.T) {
	tests := []struct {
		name                             string
		tenant, site, zone, device, meas string
		want                             string
		wantErr                          bool
	}{
		{
			name:   "happy path",
			tenant: "acme", site: "hq-ouaga", zone: "open-space-1",
			device: "env-01", meas: "temperature",
			want: "qlab/acme/hq-ouaga/open-space-1/env-01/temperature",
		},
		{
			name:   "underscore in segment",
			tenant: "acme", site: "site_1", zone: "z", device: "d", meas: "co2",
			want: "qlab/acme/site_1/z/d/co2",
		},
		{
			name:   "empty tenant rejected",
			tenant: "", site: "s", zone: "z", device: "d", meas: "t",
			wantErr: true,
		},
		{
			name:   "uppercase rejected",
			tenant: "Acme", site: "s", zone: "z", device: "d", meas: "t",
			wantErr: true,
		},
		{
			name:   "wildcard char rejected",
			tenant: "acme", site: "s+", zone: "z", device: "d", meas: "t",
			wantErr: true,
		},
		{
			name:   "slash in segment rejected",
			tenant: "acme", site: "a/b", zone: "z", device: "d", meas: "t",
			wantErr: true,
		},
		{
			name:   "starts with hyphen rejected",
			tenant: "-acme", site: "s", zone: "z", device: "d", meas: "t",
			wantErr: true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := BuildMeasurementTopic(tc.tenant, tc.site, tc.zone, tc.device, tc.meas)
			if tc.wantErr {
				require.Error(t, err)
				assert.True(t, errors.Is(err, ErrInvalidTopic))
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestBuildCommandTopic(t *testing.T) {
	got, err := BuildCommandTopic("acme", "hq", "z", "relay-01", "set")
	require.NoError(t, err)
	assert.Equal(t, "qlab/acme/hq/z/relay-01/cmd/set", got)

	_, err = BuildCommandTopic("acme", "hq", "z", "relay-01", "")
	require.Error(t, err)
}

func TestBuildStateTopic(t *testing.T) {
	got, err := BuildStateTopic("acme", "hq", "z", "relay-01")
	require.NoError(t, err)
	assert.Equal(t, "qlab/acme/hq/z/relay-01/state", got)
}

func TestParseMeasurement(t *testing.T) {
	p, err := Parse("qlab/acme/hq-ouaga/open-space-1/env-01/temperature")
	require.NoError(t, err)
	assert.Equal(t, KindMeasurement, p.Kind)
	assert.Equal(t, "acme", p.Tenant)
	assert.Equal(t, "hq-ouaga", p.Site)
	assert.Equal(t, "open-space-1", p.Zone)
	assert.Equal(t, "env-01", p.Device)
	assert.Equal(t, "temperature", p.Measurement)
	assert.Empty(t, p.Action)
}

func TestParseCommand(t *testing.T) {
	p, err := Parse("qlab/acme/hq/z/relay-01/cmd/set")
	require.NoError(t, err)
	assert.Equal(t, KindCommand, p.Kind)
	assert.Equal(t, "set", p.Action)
	assert.Empty(t, p.Measurement)
}

func TestParseState(t *testing.T) {
	p, err := Parse("qlab/acme/hq/z/relay-01/state")
	require.NoError(t, err)
	assert.Equal(t, KindState, p.Kind)
	assert.Empty(t, p.Measurement)
	assert.Empty(t, p.Action)
}

func TestParseInvalid(t *testing.T) {
	cases := map[string]string{
		"empty":             "",
		"wrong prefix":      "other/acme/s/z/d/t",
		"too few segments":  "qlab/acme/s/z/d",
		"empty segment":     "qlab/acme//z/d/t",
		"uppercase tenant":  "qlab/Acme/s/z/d/t",
		"command no action": "qlab/acme/s/z/d/cmd",
		"meas named cmd":    "qlab/acme/s/z/d/cmd",
		"too many segments": "qlab/acme/s/z/d/cmd/set/extra",
	}
	for name, topic := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := Parse(topic)
			require.Error(t, err)
			assert.True(t, errors.Is(err, ErrInvalidTopic), "expected ErrInvalidTopic, got %v", err)
		})
	}
}

func TestParseRoundtrip(t *testing.T) {
	t.Run("measurement", func(t *testing.T) {
		built, err := BuildMeasurementTopic("acme", "hq", "open-space", "env-01", "co2")
		require.NoError(t, err)
		p, err := Parse(built)
		require.NoError(t, err)
		assert.Equal(t, KindMeasurement, p.Kind)
		assert.Equal(t, "co2", p.Measurement)
	})
	t.Run("command", func(t *testing.T) {
		built, err := BuildCommandTopic("acme", "hq", "open-space", "relay-01", "set")
		require.NoError(t, err)
		p, err := Parse(built)
		require.NoError(t, err)
		assert.Equal(t, KindCommand, p.Kind)
		assert.Equal(t, "set", p.Action)
	})
	t.Run("state", func(t *testing.T) {
		built, err := BuildStateTopic("acme", "hq", "open-space", "relay-01")
		require.NoError(t, err)
		p, err := Parse(built)
		require.NoError(t, err)
		assert.Equal(t, KindState, p.Kind)
	})
}

func TestSubscriptions(t *testing.T) {
	assert.Equal(t, "qlab/+/+/+/+/+", SubscriptionAllMeasurements())
	assert.Equal(t, "qlab/+/+/+/+/cmd/+", SubscriptionAllCommands())
	assert.Equal(t, "qlab/+/+/+/+/state", SubscriptionAllStates())

	got, err := SubscriptionTenantWildcard("acme")
	require.NoError(t, err)
	assert.Equal(t, "qlab/acme/#", got)

	_, err = SubscriptionTenantWildcard("Acme+")
	require.Error(t, err)
}
