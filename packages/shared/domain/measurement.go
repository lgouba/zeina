package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
)

// Payload — format JSON publié par les devices sur les topics measurement.
//
//	qlab/{tenant}/{site}/{zone}/{device}/{measurement}
//
// Exemple : {"ts":"2026-05-05T14:23:01.000Z","value":23.4,"unit":"celsius","quality":"good"}
type Payload struct {
	TS      time.Time `json:"ts"`
	Value   float64   `json:"value"`
	Unit    string    `json:"unit,omitempty"`
	Quality Quality   `json:"quality"`
}

// ErrInvalidPayload est retournée par DecodePayload / Validate.
var ErrInvalidPayload = errors.New("invalid measurement payload")

// DecodePayload désérialise un payload MQTT et applique les règles de validité
// minimales (timestamp non-zero, value finie, quality dans l'énum). La validation
// des bornes par measurement se fait ailleurs (ingestor consulte
// measurements_metadata).
func DecodePayload(data []byte) (Payload, error) {
	var p Payload
	if err := json.Unmarshal(data, &p); err != nil {
		return Payload{}, fmt.Errorf("%w: %v", ErrInvalidPayload, err)
	}
	if err := p.Validate(); err != nil {
		return Payload{}, err
	}
	return p, nil
}

// Validate vérifie l'invariant minimal d'un payload.
func (p Payload) Validate() error {
	if p.TS.IsZero() {
		return fmt.Errorf("%w: ts is required", ErrInvalidPayload)
	}
	if math.IsNaN(p.Value) || math.IsInf(p.Value, 0) {
		return fmt.Errorf("%w: value is NaN/Inf", ErrInvalidPayload)
	}
	if p.Quality == "" {
		// Tolérant : on accepte un payload sans quality et on assume "good".
		// Mais on ne mute pas le receiver — l'appelant traite le défaut.
		return nil
	}
	if !p.Quality.Valid() {
		return fmt.Errorf("%w: invalid quality %q", ErrInvalidPayload, p.Quality)
	}
	return nil
}

// QualityOrDefault retourne la qualité si renseignée, sinon QualityGood.
func (p Payload) QualityOrDefault() Quality {
	if p.Quality == "" {
		return QualityGood
	}
	return p.Quality
}

// Encode sérialise le payload au format JSON canonique.
func (p Payload) Encode() ([]byte, error) {
	if p.Quality == "" {
		p.Quality = QualityGood
	}
	return json.Marshal(p)
}

// Measurement — représentation interne enrichie après décodage MQTT.
// Utilisée par l'ingestor pour pousser dans la table measurements.
type Measurement struct {
	TS          time.Time
	DeviceID    uuid.UUID
	Measurement string
	Value       float64
	Quality     Quality
}
