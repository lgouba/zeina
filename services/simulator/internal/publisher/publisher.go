// Package publisher est un thin wrapper au-dessus de shared/mqtt qui sait
// construire les bons topics ZEINA (mesure / état) à partir d'un device, et
// désérialiser le QoS configuré.
package publisher

import (
	"context"
	"fmt"
	"time"

	"github.com/zeina/hyperviseur/packages/shared/domain"
	"github.com/zeina/hyperviseur/packages/shared/mqtt"
	"github.com/zeina/hyperviseur/packages/shared/topics"
)

type Publisher struct {
	client         *mqtt.Client
	tenant         string
	measurementQoS byte
	stateQoS       byte
}

func New(client *mqtt.Client, tenant string, measurementQoS, stateQoS int) *Publisher {
	return &Publisher{
		client:         client,
		tenant:         tenant,
		measurementQoS: byte(measurementQoS),
		stateQoS:       byte(stateQoS),
	}
}

// Measurement publie un payload de mesure sur le topic adéquat.
func (p *Publisher) Measurement(ctx context.Context, site, zone, device, measurement string, value float64, unit string, quality domain.Quality, ts time.Time) error {
	topic, err := topics.BuildMeasurementTopic(p.tenant, site, zone, device, measurement)
	if err != nil {
		return fmt.Errorf("publisher: build topic: %w", err)
	}
	if quality == "" {
		quality = domain.QualityGood
	}
	payload := domain.Payload{TS: ts, Value: value, Unit: unit, Quality: quality}
	body, err := payload.Encode()
	if err != nil {
		return fmt.Errorf("publisher: encode: %w", err)
	}
	return p.client.Publish(ctx, topic, p.measurementQoS, false, body)
}

// State publie un payload d'état (ACK actuator ou état périodique).
// payload est déjà encodé par le profil Actuator.
//
// retained = true → Mosquitto re-livrera le dernier message à tout nouveau
// subscriber. À utiliser pour l'état initial / périodique d'un actionneur,
// ainsi tout client connecté ultérieurement (ex: frontend) connaît
// immédiatement l'état courant. Pour les ACK de commandes spécifiques
// (avec cmd_id), retained = false : on ne veut pas qu'un nouveau client
// reçoive un vieux cmd_id qui ne le concerne pas.
func (p *Publisher) State(ctx context.Context, site, zone, device string, payload []byte, retained bool) error {
	topic, err := topics.BuildStateTopic(p.tenant, site, zone, device)
	if err != nil {
		return fmt.Errorf("publisher: build state topic: %w", err)
	}
	return p.client.Publish(ctx, topic, p.stateQoS, retained, payload)
}

// CommandFilter retourne le filtre de subscription des commandes pour un
// device particulier (utilisé par les actuators).
func CommandFilter(tenant, site, zone, device string) (string, error) {
	tpl, err := topics.BuildCommandTopic(tenant, site, zone, device, "set")
	if err != nil {
		return "", err
	}
	// On remplace le dernier segment par + pour matcher toutes les actions
	// (set, reset, ping, ...).
	return tpl[:len(tpl)-len("set")] + "+", nil
}
