// Package config charge et valide la configuration YAML du simulator.
package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/zeina/hyperviseur/packages/shared/topics"
)

// Config — racine YAML.
type Config struct {
	Broker         string `yaml:"broker"`
	Username       string `yaml:"username"`
	Password       string `yaml:"password"`
	ClientIDPrefix string `yaml:"client_id_prefix"`
	Tenant         string `yaml:"tenant"`
	Seed           int64  `yaml:"seed"`

	// QoS publish (0|1|2). Défaut 0 pour mesures, 1 pour cmd/state.
	MeasurementQoS int `yaml:"measurement_qos"`
	StateQoS       int `yaml:"state_qos"`

	Sites []Site `yaml:"sites"`
}

type Site struct {
	ID    string `yaml:"id"`
	Zones []Zone `yaml:"zones"`
}

type Zone struct {
	ID      string   `yaml:"id"`
	Devices []Device `yaml:"devices"`
}

// Device — un capteur ou actionneur virtuel.
type Device struct {
	ID           string        `yaml:"id"`
	Type         string        `yaml:"type"` // environment | presence | linky | actuator
	Interval     time.Duration `yaml:"interval"`
	Schedule     string        `yaml:"schedule,omitempty"`      // ex: "occupied 08:00-18:00 mon-fri"
	Measurements []string      `yaml:"measurements,omitempty"`  // pour environment
	InitialState string        `yaml:"initial_state,omitempty"` // actuator
	Couplings    Couplings     `yaml:"couplings,omitempty"`
}

// Couplings — référence à d'autres devices de la même zone, lus via le bus.
//
//	light_relay : id du relais lumière (utilisé par lux & linky pour augmenter la conso)
//	presence    : id du capteur de présence (utilisé par CO2/T° pour modèle d'occupation)
type Couplings struct {
	LightRelay string `yaml:"light_relay,omitempty"`
	Presence   string `yaml:"presence,omitempty"`
}

// Load lit le fichier YAML, applique les défauts, valide les invariants.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("simulator config: read %s: %w", path, err)
	}
	var c Config
	if err := yaml.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("simulator config: parse %s: %w", path, err)
	}
	c.applyDefaults()
	if err := c.Validate(); err != nil {
		return nil, err
	}
	return &c, nil
}

func (c *Config) applyDefaults() {
	if c.Broker == "" {
		c.Broker = "tcp://mosquitto:1883"
	}
	if c.ClientIDPrefix == "" {
		c.ClientIDPrefix = "zeina-sim"
	}
	// MeasurementQoS : 0 explicite reste 0 (YAML int absent → 0 → tolérable,
	// les mesures sont OK en QoS 0). On ne force pas de défaut ici.
	if c.StateQoS == 0 {
		c.StateQoS = 1 // ACK doivent passer
	}
	for si := range c.Sites {
		for zi := range c.Sites[si].Zones {
			for di := range c.Sites[si].Zones[zi].Devices {
				d := &c.Sites[si].Zones[zi].Devices[di]
				if d.Interval == 0 && d.Type != "actuator" {
					d.Interval = 30 * time.Second
				}
				if d.Type == "actuator" && d.InitialState == "" {
					d.InitialState = "off"
				}
			}
		}
	}
}

// Validate vérifie les invariants nécessaires pour faire tourner le simu.
func (c *Config) Validate() error {
	if c.Tenant == "" {
		return fmt.Errorf("simulator config: tenant is required")
	}
	if err := validateSlug("tenant", c.Tenant); err != nil {
		return err
	}
	if c.MeasurementQoS < 0 || c.MeasurementQoS > 2 {
		return fmt.Errorf("simulator config: measurement_qos must be 0, 1 or 2")
	}
	if c.StateQoS < 0 || c.StateQoS > 2 {
		return fmt.Errorf("simulator config: state_qos must be 0, 1 or 2")
	}
	if len(c.Sites) == 0 {
		return fmt.Errorf("simulator config: at least one site required")
	}
	seenSites := map[string]bool{}
	for _, s := range c.Sites {
		if err := validateSlug("site.id", s.ID); err != nil {
			return err
		}
		if seenSites[s.ID] {
			return fmt.Errorf("simulator config: duplicate site %q", s.ID)
		}
		seenSites[s.ID] = true
		if len(s.Zones) == 0 {
			return fmt.Errorf("simulator config: site %q has no zones", s.ID)
		}
		seenZones := map[string]bool{}
		// Unicité au niveau site : le bus simulator est site-wide et indexe
		// les devices par leur slug seul.
		seenDevsInSite := map[string]string{} // slug → "zone/device"
		for _, z := range s.Zones {
			if err := validateSlug("zone.id", z.ID); err != nil {
				return err
			}
			if seenZones[z.ID] {
				return fmt.Errorf("simulator config: duplicate zone %q in site %q", z.ID, s.ID)
			}
			seenZones[z.ID] = true
			for _, d := range z.Devices {
				if err := d.validate(s.ID, z.ID); err != nil {
					return err
				}
				if existing, dup := seenDevsInSite[d.ID]; dup {
					return fmt.Errorf("simulator config: duplicate device slug %q in site %q (already in %s)",
						d.ID, s.ID, existing)
				}
				seenDevsInSite[d.ID] = z.ID + "/" + d.ID
			}
		}
	}
	return nil
}

func (d Device) validate(siteID, zoneID string) error {
	if err := validateSlug("device.id", d.ID); err != nil {
		return err
	}
	switch d.Type {
	case "environment":
		if len(d.Measurements) == 0 {
			return fmt.Errorf("simulator config: device %s/%s/%s: environment needs measurements",
				siteID, zoneID, d.ID)
		}
		for _, m := range d.Measurements {
			switch m {
			case "temperature", "humidity", "co2", "lux":
			default:
				return fmt.Errorf("simulator config: device %s: unknown measurement %q", d.ID, m)
			}
		}
	case "presence":
		// schedule facultatif — sans schedule, présence aléatoire 24/7
	case "linky", "actuator":
		// rien de spécial
	default:
		return fmt.Errorf("simulator config: device %s: unknown type %q", d.ID, d.Type)
	}
	return nil
}

// validateSlug réutilise la même règle que topics — segments [a-z0-9][a-z0-9_-]*
// pour garantir qu'on pourra construire les topics MQTT plus tard.
func validateSlug(field, s string) error {
	if _, err := topics.BuildMeasurementTopic("t", "s", "z", s, "m"); err != nil {
		return fmt.Errorf("%s: %w", field, err)
	}
	return nil
}
