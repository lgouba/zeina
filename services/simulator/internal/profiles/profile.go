// Package profiles contient les modèles de génération de mesures simulées
// (température, humidité, CO2, lux, présence, Linky) ainsi que l'actionneur
// virtuel qui consomme les commandes MQTT.
package profiles

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"github.com/zeina/hyperviseur/packages/shared/domain"
	"github.com/zeina/hyperviseur/services/simulator/internal/bus"
	"github.com/zeina/hyperviseur/services/simulator/internal/scheduler"
)

// Reading — une mesure individuelle générée par un Tick.
//
// Pour un device "environment" qui publie 4 measurements (T/H/CO2/lux), Tick
// retourne 4 Reading dans une seule slice.
type Reading struct {
	Name    string         // ex: "temperature", "co2", "papp"
	Value   float64
	Unit    string         // ex: "celsius", "ppm", "watt"
	Quality domain.Quality // par défaut "good"
}

// State — contexte d'exécution passé à chaque Tick.
//
// Le champ Internal est libre au profil pour stocker son propre état entre
// ticks (ex: niveau CO2 courant pour le modèle exponentiel, index énergie
// monotone pour le Linky). Il est conservé d'un tick à l'autre par le runner.
type State struct {
	DeviceID string
	ZoneID   string
	SiteID   string

	Now      time.Time
	Rand     *rand.Rand
	Schedule *scheduler.Schedule
	Bus      *bus.Bus

	// Couplages — IDs des devices voisins lus via Bus (peut être vide).
	LightRelayID string
	PresenceID   string

	// Internal — opaque, géré par le profil concret.
	Internal any
}

// Profile — interface implémentée par chaque type de device virtuel.
//
//   - Tick   : appelée périodiquement par le runner ; retourne 0..N readings
//   - HandleCommand : appelée quand un message arrive sur cmd/* (actuator)
//   - InitState     : retourne l'état interne initial du profil (peut être nil)
//   - HasState      : indique si le profil publie un état (state topic) — actuator only
//   - InitialPayload: payload "state" initial à publier au démarrage (actuator only)
type Profile interface {
	Name() string
	Tick(ctx context.Context, st *State) []Reading
	HandleCommand(ctx context.Context, st *State, cmd domain.CommandPayload) (newStateJSON []byte, err error)
	InitState() any
	InitialStatePayload(st *State) []byte // nil = pas d'état à publier
}

// New construit le Profile correspondant au type déclaré dans le YAML.
//
// initialActuatorState est utilisé uniquement pour les actuators (champ
// initial_state du YAML).
func New(deviceType, initialActuatorState string, measurements []string) (Profile, error) {
	switch deviceType {
	case "environment":
		return NewEnvironment(measurements)
	case "presence":
		return &Presence{}, nil
	case "linky":
		return &Linky{}, nil
	case "actuator":
		return NewActuator(initialActuatorState), nil
	default:
		return nil, fmt.Errorf("profiles: unknown type %q", deviceType)
	}
}
