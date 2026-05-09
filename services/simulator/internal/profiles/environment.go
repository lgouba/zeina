package profiles

import (
	"context"
	"fmt"
	"math"

	"github.com/zeina/hyperviseur/packages/shared/domain"
)

// Environment — capteur multi-mesures (T° / humidité / CO2 / lux) avec un état
// interne partagé. Les modèles s'influencent mutuellement (humidité
// anti-corrélée à T°, lux dépend du relais lumière voisin, CO2 dépend du
// présence voisin).
//
// L'état est conservé entre ticks via State.Internal.
type Environment struct {
	measurements []string // ordre stable de publication
	enabled      map[string]bool
}

func NewEnvironment(measurements []string) (*Environment, error) {
	if len(measurements) == 0 {
		return nil, fmt.Errorf("environment: at least one measurement required")
	}
	enabled := make(map[string]bool, len(measurements))
	for _, m := range measurements {
		switch m {
		case "temperature", "humidity", "co2", "lux":
			enabled[m] = true
		default:
			return nil, fmt.Errorf("environment: unsupported measurement %q", m)
		}
	}
	return &Environment{measurements: measurements, enabled: enabled}, nil
}

func (e *Environment) Name() string { return "environment" }

// envState — état interne mémorisé d'un tick à l'autre.
type envState struct {
	Temperature float64 // °C
	Humidity    float64 // %
	CO2         float64 // ppm
}

func (e *Environment) InitState() any {
	return &envState{Temperature: 24.0, Humidity: 50.0, CO2: 420.0}
}

func (e *Environment) InitialStatePayload(*State) []byte { return nil }

func (e *Environment) HandleCommand(_ context.Context, _ *State, _ domain.CommandPayload) ([]byte, error) {
	return nil, fmt.Errorf("environment: not commandable")
}

// Tick met à jour l'état interne et retourne les readings dans l'ordre
// déclaré dans le YAML.
func (e *Environment) Tick(_ context.Context, st *State) []Reading {
	s, _ := st.Internal.(*envState)
	if s == nil {
		s = e.InitState().(*envState)
		st.Internal = s
	}

	hour := float64(st.Now.Hour()) + float64(st.Now.Minute())/60.0
	occupied := e.isOccupied(st)
	lightOn := e.isLightOn(st)

	// --- Température : courbe diurne 22→27, drift +0.3 si occupé, bruit σ=0.15
	targetT := 22.0 + 5.0*math.Sin(math.Pi*(hour-6)/12.0) // 22..27 entre 6h et 18h
	if hour < 6 || hour > 18 {
		targetT = 22.0
	}
	if occupied {
		targetT += 1.5
	}
	// Approche exponentielle (k=0.15 par tick → ~10 ticks pour 80% du chemin)
	s.Temperature += 0.15*(targetT-s.Temperature) + st.Rand.NormFloat64()*0.15

	// --- Humidité : 50% base, anti-corrélée à T au-delà de 25°C, bruit ±2%
	targetH := 50.0 - math.Max(0, s.Temperature-25.0)*1.5
	if occupied {
		targetH += 5.0 // expiration humaine
	}
	s.Humidity += 0.20*(targetH-s.Humidity) + st.Rand.NormFloat64()*1.0
	s.Humidity = clamp(s.Humidity, 20.0, 90.0)

	// --- CO2 : modèle exponentiel autour de 400ppm vide / 1200ppm occupé
	targetCO2 := 400.0
	if occupied {
		targetCO2 = 1200.0
	}
	k := 0.05
	if !occupied {
		k = 0.10 // décroît plus vite (ventilation passive)
	}
	s.CO2 += k*(targetCO2-s.CO2) + st.Rand.NormFloat64()*8.0
	s.CO2 = clamp(s.CO2, 350.0, 2500.0)

	// --- Lux : 0 nuit, 200..800 jour, +400 si lumière artificielle ON
	lux := 0.0
	if hour >= 6 && hour <= 18 {
		// pic à 12h
		lux = 200.0 + 600.0*math.Sin(math.Pi*(hour-6)/12.0)
	}
	if lightOn {
		lux += 400.0
	}
	lux += st.Rand.NormFloat64() * 15.0
	lux = math.Max(0, lux)

	out := make([]Reading, 0, len(e.measurements))
	for _, m := range e.measurements {
		switch m {
		case "temperature":
			out = append(out, Reading{Name: "temperature", Value: round1(s.Temperature), Unit: "celsius", Quality: domain.QualityGood})
		case "humidity":
			out = append(out, Reading{Name: "humidity", Value: round1(s.Humidity), Unit: "percent", Quality: domain.QualityGood})
		case "co2":
			out = append(out, Reading{Name: "co2", Value: round0(s.CO2), Unit: "ppm", Quality: domain.QualityGood})
		case "lux":
			out = append(out, Reading{Name: "lux", Value: round0(lux), Unit: "lux", Quality: domain.QualityGood})
		}
	}
	return out
}

// isOccupied lit le bus pour savoir si la zone est occupée. Si aucun coupling
// n'est configuré, on suppose vide (un capteur env seul ne sait pas).
func (e *Environment) isOccupied(st *State) bool {
	if st.Bus == nil || st.PresenceID == "" {
		return false
	}
	return st.Bus.GetBool(st.PresenceID, false)
}

// isLightOn lit l'état du relais lumière voisin (s'il existe).
func (e *Environment) isLightOn(st *State) bool {
	if st.Bus == nil || st.LightRelayID == "" {
		return false
	}
	return st.Bus.GetString(st.LightRelayID, "off") == "on"
}

// --- helpers --------------------------------------------------------------

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func round0(v float64) float64 { return math.Round(v) }
func round1(v float64) float64 { return math.Round(v*10) / 10 }
