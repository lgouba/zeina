// Package ws fournit un broadcaster MQTT → WebSocket par tenant.
//
// Architecture :
//   - 1 goroutine dédiée subscribe à qlab/{tenant}/# côté MQTT
//   - chaque connexion WS s'enregistre auprès du broadcaster
//   - les messages MQTT sont diffusés à tous les clients du tenant
//   - downsampling : chaque client a un buffer 1 message qui dégage le précédent
//     si pas encore consommé (évite l'accumulation infinie sur un client lent)
//
// Format des messages WS (JSON) :
//
//	{"type":"measurement","topic":"qlab/...","ts":"...","value":...,"measurement":"..."}
//	{"type":"state","topic":"qlab/...","cmd_id":"...","state":{...}}
package ws

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/zeina/hyperviseur/packages/shared/domain"
	sharedmqtt "github.com/zeina/hyperviseur/packages/shared/mqtt"
	"github.com/zeina/hyperviseur/packages/shared/topics"
)

// Envelope — message envoyé sur le WebSocket.
type Envelope struct {
	Type        string          `json:"type"` // "measurement" | "state"
	Topic       string          `json:"topic"`
	TS          time.Time       `json:"ts"`
	Tenant      string          `json:"tenant"`
	Site        string          `json:"site"`
	Zone        string          `json:"zone"`
	Device      string          `json:"device"`
	Measurement string          `json:"measurement,omitempty"`
	Value       *float64        `json:"value,omitempty"`
	Quality     string          `json:"quality,omitempty"`
	State       json.RawMessage `json:"state,omitempty"`
	CmdID       string          `json:"cmd_id,omitempty"`
}

// Subscriber — interface implémentée par une connexion WS.
type Subscriber struct {
	ID  uuid.UUID
	out chan Envelope // buffer 1 — drop le plus vieux si plein
}

func (s *Subscriber) Out() <-chan Envelope { return s.out }

// Broadcaster — un par tenant.
type Broadcaster struct {
	tenant string
	mqtt   *sharedmqtt.Client
	log    zerolog.Logger

	mu   sync.RWMutex
	subs map[uuid.UUID]*Subscriber
}

func NewBroadcaster(tenant string, mqtt *sharedmqtt.Client, log zerolog.Logger) *Broadcaster {
	return &Broadcaster{
		tenant: tenant,
		mqtt:   mqtt,
		log:    log.With().Str("component", "ws-broadcaster").Str("tenant", tenant).Logger(),
		subs:   make(map[uuid.UUID]*Subscriber),
	}
}

// Start subscribe au tenant complet et installe le handler.
func (b *Broadcaster) Start(ctx context.Context) error {
	filter, err := topics.SubscriptionTenantWildcard(b.tenant)
	if err != nil {
		return err
	}
	b.log.Info().Str("filter", filter).Msg("subscribing for ws broadcast")
	return b.mqtt.Subscribe(ctx, filter, 0, b.handle)
}

func (b *Broadcaster) handle(topic string, payload []byte) {
	parts, err := topics.Parse(topic)
	if err != nil {
		return
	}
	env := Envelope{
		Topic:  topic,
		Tenant: parts.Tenant,
		Site:   parts.Site,
		Zone:   parts.Zone,
		Device: parts.Device,
	}

	switch parts.Kind {
	case topics.KindMeasurement:
		p, err := domain.DecodePayload(payload)
		if err != nil {
			return
		}
		env.Type = "measurement"
		env.TS = p.TS
		env.Measurement = parts.Measurement
		v := p.Value
		env.Value = &v
		env.Quality = string(p.QualityOrDefault())

	case topics.KindState:
		s, err := domain.DecodeState(payload)
		if err != nil {
			return
		}
		env.Type = "state"
		env.TS = s.TS
		env.State = s.State
		env.CmdID = s.CmdID

	default:
		return // commandes ignorées (l'API les a déjà loggées)
	}

	b.fanout(env)
}

func (b *Broadcaster) fanout(env Envelope) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, s := range b.subs {
		// Drop-oldest : on essaie de pousser, sinon on draine le buffer
		// d'1 et on retente. Garantie : au pire on tient toujours le DERNIER
		// message. Évite qu'un client lent fasse exploser la mémoire.
		select {
		case s.out <- env:
		default:
			select {
			case <-s.out:
			default:
			}
			select {
			case s.out <- env:
			default:
			}
		}
	}
}

// Subscribe enregistre un nouveau client. Cancel via Unsubscribe.
func (b *Broadcaster) Subscribe() *Subscriber {
	s := &Subscriber{
		ID:  uuid.New(),
		out: make(chan Envelope, 1),
	}
	b.mu.Lock()
	b.subs[s.ID] = s
	count := len(b.subs)
	b.mu.Unlock()
	b.log.Debug().Int("subscribers", count).Msg("ws subscriber added")
	return s
}

func (b *Broadcaster) Unsubscribe(s *Subscriber) {
	b.mu.Lock()
	delete(b.subs, s.ID)
	count := len(b.subs)
	b.mu.Unlock()
	close(s.out)
	b.log.Debug().Int("subscribers", count).Msg("ws subscriber removed")
}

func (b *Broadcaster) Count() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.subs)
}
