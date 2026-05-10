package profiles

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/zeina/hyperviseur/packages/shared/domain"
)

// Actuator — relais virtuel commandable. Comportement :
//   - état initial publié sur "state" au démarrage du runner
//   - Tick ne produit aucune mesure (l'actuator ne mesure rien)
//   - sur réception d'une commande {"state":"on"} ou {"state":"off"} :
//     1. met à jour son état interne
//     2. publie l'état partagé sur le Bus (consommé par environment, linky)
//     3. retourne le payload "state" sérialisé que le runner publie sur
//     le topic state, avec cmd_id repris pour ACK côté API/rules.
type Actuator struct {
	initial string
}

func NewActuator(initial string) *Actuator {
	if initial == "" {
		initial = "off"
	}
	return &Actuator{initial: strings.ToLower(initial)}
}

func (a *Actuator) Name() string { return "actuator" }

type actuatorState struct {
	State string // "on" | "off"
}

func (a *Actuator) InitState() any {
	return &actuatorState{State: a.initial}
}

// Tick ne produit aucune mesure mais s'assure que le bus reflète l'état
// courant — utile pour les profils voisins qui démarrent après l'actuator.
func (a *Actuator) Tick(_ context.Context, st *State) []Reading {
	s := a.ensureState(st)
	if st.Bus != nil {
		st.Bus.Set(st.DeviceID, s.State)
	}
	return nil
}

// HandleCommand attend un payload {"state":"on"|"off"}. Renvoie le bytes
// du nouveau state à publier (incluant cmd_id pour corrélation ACK).
func (a *Actuator) HandleCommand(_ context.Context, st *State, cmd domain.CommandPayload) ([]byte, error) {
	s := a.ensureState(st)

	var p struct {
		State string `json:"state"`
	}
	if err := json.Unmarshal(cmd.Payload, &p); err != nil {
		return nil, fmt.Errorf("actuator: invalid command payload: %w", err)
	}
	desired := strings.ToLower(strings.TrimSpace(p.State))
	if desired != "on" && desired != "off" {
		return nil, fmt.Errorf("actuator: state must be 'on' or 'off', got %q", desired)
	}
	s.State = desired
	if st.Bus != nil {
		st.Bus.Set(st.DeviceID, s.State)
	}

	statePayload := domain.StatePayload{
		TS:    time.Now().UTC(),
		CmdID: cmd.ID,
		State: mustJSON(map[string]string{"state": s.State}),
	}
	return statePayload.Encode()
}

// InitialStatePayload — appelée par le runner au démarrage pour publier
// l'état initial sans ACK (cmd_id vide).
func (a *Actuator) InitialStatePayload(st *State) []byte {
	s := a.ensureState(st)
	if st.Bus != nil {
		st.Bus.Set(st.DeviceID, s.State)
	}
	payload := domain.StatePayload{
		TS:    time.Now().UTC(),
		State: mustJSON(map[string]string{"state": s.State}),
	}
	out, _ := payload.Encode()
	return out
}

func (a *Actuator) ensureState(st *State) *actuatorState {
	if s, ok := st.Internal.(*actuatorState); ok && s != nil {
		return s
	}
	s := a.InitState().(*actuatorState)
	st.Internal = s
	return s
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
