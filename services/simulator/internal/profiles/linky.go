package profiles

import (
	"context"
	"fmt"
	"math"

	"github.com/zeina/hyperviseur/packages/shared/domain"
)

// Linky — compteur électrique virtuel. Publie à chaque tick :
//   - papp  (puissance apparente, VA)
//   - pact  (puissance active, W)
//   - iinst (intensité, A)
//   - urms  (tension RMS, V — autour de 230)
//   - base  (index énergie consommée, Wh — monotone croissant)
//
// La consommation simulée est composée de :
//   - charge de base 200W (frigo, veilles, ...)
//   - +400W si le relais lumière voisin est "on"
//   - +1500W si la T° dépasse 26°C (clim simulée)
//   - +200W si présence
//
// L'index `base` est intégré au cours du temps : on accumule W·h entre deux ticks.
type Linky struct{}

func (l *Linky) Name() string { return "linky" }

type linkyState struct {
	BaseWh   float64 // index énergie en Wh (cumulatif, monotone)
	LastTick int64   // unix nano du dernier tick (pour delta-t)
}

func (l *Linky) InitState() any                    { return &linkyState{} }
func (l *Linky) InitialStatePayload(*State) []byte { return nil }

func (l *Linky) HandleCommand(_ context.Context, _ *State, _ domain.CommandPayload) ([]byte, error) {
	return nil, fmt.Errorf("linky: not commandable")
}

func (l *Linky) Tick(_ context.Context, st *State) []Reading {
	s, _ := st.Internal.(*linkyState)
	if s == nil {
		s = l.InitState().(*linkyState)
		st.Internal = s
	}

	pact := 200.0
	if st.Bus != nil {
		if st.LightRelayID != "" && st.Bus.GetString(st.LightRelayID, "off") == "on" {
			pact += 400.0
		}
		if st.PresenceID != "" && st.Bus.GetBool(st.PresenceID, false) {
			pact += 200.0
		}
	}
	// Climatisation simulée : si la salle est chaude, on ajoute 1500W.
	// On ne lit pas de capteur T° ici (pas de coupling explicite), on
	// utilise l'heure : pic de chaleur 13-17h → clim probablement ON.
	if h := st.Now.Hour(); h >= 13 && h <= 17 {
		pact += 1500.0
	}
	pact += st.Rand.NormFloat64() * 30.0
	pact = math.Max(0, pact)

	papp := pact * 1.05 // facteur de puissance ~0.95
	urms := 230.0 + st.Rand.NormFloat64()*1.5
	urms = clamp(urms, 220.0, 245.0)
	iinst := papp / urms

	// Intégration énergie : Δ(Wh) = pact * Δt(h)
	now := st.Now.UnixNano()
	if s.LastTick != 0 {
		dtSec := float64(now-s.LastTick) / 1e9
		s.BaseWh += pact * dtSec / 3600.0
	}
	s.LastTick = now

	return []Reading{
		{Name: "papp", Value: round0(papp), Unit: "VA", Quality: domain.QualityGood},
		{Name: "pact", Value: round0(pact), Unit: "watt", Quality: domain.QualityGood},
		{Name: "iinst", Value: round1(iinst), Unit: "ampere", Quality: domain.QualityGood},
		{Name: "urms", Value: round1(urms), Unit: "volt", Quality: domain.QualityGood},
		{Name: "base", Value: round0(s.BaseWh), Unit: "watt-hour", Quality: domain.QualityGood},
	}
}
