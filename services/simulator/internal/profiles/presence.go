package profiles

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/zeina/hyperviseur/packages/shared/domain"
)

// Presence — capteur PIR : publie 0/1 selon le schedule + une probabilité de
// pause quand la zone est "occupée".
//
// Côté bus : publie un bool (true=occupé) que les autres profils peuvent lire
// pour ajuster CO2/T°.
type Presence struct{}

func (p *Presence) Name() string { return "presence" }

type presenceState struct {
	Last bool
}

func (p *Presence) InitState() any                    { return &presenceState{} }
func (p *Presence) InitialStatePayload(*State) []byte { return nil }

func (p *Presence) HandleCommand(_ context.Context, _ *State, _ domain.CommandPayload) ([]byte, error) {
	return nil, fmt.Errorf("presence: not commandable")
}

func (p *Presence) Tick(_ context.Context, st *State) []Reading {
	s, _ := st.Internal.(*presenceState)
	if s == nil {
		s = p.InitState().(*presenceState)
		st.Internal = s
	}

	occupied := false
	switch {
	case st.Schedule != nil:
		// Pendant les heures occupées : 90% du temps présent (pauses, déplacements).
		// Hors heures : 5% du temps (quelqu'un de passage).
		if st.Schedule.IsActive(st.Now) {
			occupied = st.Rand.Float64() < 0.90
		} else {
			occupied = st.Rand.Float64() < 0.05
		}
	default:
		// Pas de schedule : présence aléatoire 30% du temps en journée, 5% nuit.
		hour := st.Now.Hour()
		if hour >= 7 && hour <= 19 {
			occupied = st.Rand.Float64() < 0.30
		} else {
			occupied = st.Rand.Float64() < 0.05
		}
	}
	s.Last = occupied

	// Publie sur le bus pour environment + linky
	if st.Bus != nil {
		st.Bus.Set(st.DeviceID, occupied)
	}

	value := 0.0
	if occupied {
		value = 1.0
	}
	return []Reading{
		{Name: "presence", Value: value, Unit: "bool", Quality: domain.QualityGood},
	}
}

// (jamais utilisé pour Presence, mais référencé pour compilation depuis main)
var _ = json.Marshal
