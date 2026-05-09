package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const minimalYAML = `
broker: tcp://m:1883
tenant: acme
sites:
  - id: hq
    zones:
      - id: open-space
        devices:
          - id: env-01
            type: environment
            measurements: [temperature, co2]
            interval: 30s
          - id: relay-01
            type: actuator
            initial_state: on
`

func writeTmp(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "sim.yml")
	require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
	return path
}

func TestLoadHappy(t *testing.T) {
	cfg, err := Load(writeTmp(t, minimalYAML))
	require.NoError(t, err)
	assert.Equal(t, "acme", cfg.Tenant)
	assert.Equal(t, 1, cfg.StateQoS, "state_qos default = 1")
	require.Len(t, cfg.Sites, 1)
	require.Len(t, cfg.Sites[0].Zones, 1)
	require.Len(t, cfg.Sites[0].Zones[0].Devices, 2)
}

func TestLoadMissingTenant(t *testing.T) {
	yaml := `
broker: tcp://m:1883
sites:
  - id: hq
    zones:
      - id: z
        devices: [{id: d, type: environment, measurements: [temperature]}]
`
	_, err := Load(writeTmp(t, yaml))
	require.Error(t, err)
}

func TestLoadInvalidSlug(t *testing.T) {
	yaml := `
broker: tcp://m:1883
tenant: ACME
sites: [{id: hq, zones: [{id: z, devices: [{id: d, type: environment, measurements: [temperature]}]}]}]
`
	_, err := Load(writeTmp(t, yaml))
	require.Error(t, err, "uppercase tenant must be rejected")
}

func TestLoadDuplicateDevice(t *testing.T) {
	yaml := `
broker: tcp://m:1883
tenant: acme
sites:
  - id: hq
    zones:
      - id: z
        devices:
          - {id: d, type: environment, measurements: [temperature]}
          - {id: d, type: presence}
`
	_, err := Load(writeTmp(t, yaml))
	require.Error(t, err)
}

func TestLoadUnknownMeasurement(t *testing.T) {
	yaml := `
broker: tcp://m:1883
tenant: acme
sites:
  - id: hq
    zones:
      - id: z
        devices: [{id: d, type: environment, measurements: [foobar]}]
`
	_, err := Load(writeTmp(t, yaml))
	require.Error(t, err)
}

func TestLoadActuatorDefaultState(t *testing.T) {
	yaml := `
broker: tcp://m:1883
tenant: acme
sites:
  - id: hq
    zones:
      - id: z
        devices: [{id: relay, type: actuator}]
`
	cfg, err := Load(writeTmp(t, yaml))
	require.NoError(t, err)
	assert.Equal(t, "off", cfg.Sites[0].Zones[0].Devices[0].InitialState)
}
