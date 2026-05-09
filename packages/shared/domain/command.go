package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// CommandPayload — format JSON publié sur les topics de commande :
//
//	qlab/{tenant}/{site}/{zone}/{device}/cmd/{action}
//
// Exemple : {"id":"<uuid>","ts":"...","payload":{"state":"off"}}
//
// Le champ `id` est l'identifiant de la commande côté DB (table commands).
// L'actionneur le réutilise dans son ACK afin que le rules-engine puisse
// corréler la commande émise et l'état observé.
type CommandPayload struct {
	ID      string          `json:"id"`
	TS      time.Time       `json:"ts"`
	Payload json.RawMessage `json:"payload"`
}

// StatePayload — format JSON publié par les actionneurs sur le topic state :
//
//	qlab/{tenant}/{site}/{zone}/{device}/state
//
// Sert d'ACK des commandes (cmd_id renvoyé) ET d'état périodique (cmd_id vide).
type StatePayload struct {
	TS    time.Time       `json:"ts"`
	CmdID string          `json:"cmd_id,omitempty"` // si présent : ACK de cette commande
	State json.RawMessage `json:"state"`
}

var ErrInvalidCommand = errors.New("invalid command payload")

func DecodeCommand(data []byte) (CommandPayload, error) {
	var c CommandPayload
	if err := json.Unmarshal(data, &c); err != nil {
		return CommandPayload{}, fmt.Errorf("%w: %v", ErrInvalidCommand, err)
	}
	if c.TS.IsZero() {
		c.TS = time.Now().UTC()
	}
	if len(c.Payload) == 0 {
		return CommandPayload{}, fmt.Errorf("%w: empty payload", ErrInvalidCommand)
	}
	return c, nil
}

func DecodeState(data []byte) (StatePayload, error) {
	var s StatePayload
	if err := json.Unmarshal(data, &s); err != nil {
		return StatePayload{}, fmt.Errorf("%w: %v", ErrInvalidCommand, err)
	}
	if len(s.State) == 0 {
		return StatePayload{}, fmt.Errorf("%w: empty state", ErrInvalidCommand)
	}
	return s, nil
}

func (c CommandPayload) Encode() ([]byte, error) {
	if c.TS.IsZero() {
		c.TS = time.Now().UTC()
	}
	return json.Marshal(c)
}

func (s StatePayload) Encode() ([]byte, error) {
	if s.TS.IsZero() {
		s.TS = time.Now().UTC()
	}
	return json.Marshal(s)
}
