// Package consumer reçoit les messages MQTT, parse le topic, décode le payload,
// résout le device, valide les bornes, puis pousse une Measurement sur le
// channel d'entrée du batcher.
package consumer

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/zeina/hyperviseur/packages/shared/domain"
	"github.com/zeina/hyperviseur/packages/shared/mqtt"
	"github.com/zeina/hyperviseur/packages/shared/topics"

	"github.com/zeina/hyperviseur/services/ingestor/internal/metrics"
	"github.com/zeina/hyperviseur/services/ingestor/internal/resolver"
)

// Item — payload pousser sur le channel batcher.
type Item struct {
	TS          time.Time
	DeviceID    uuid.UUID
	Measurement string
	Value       float64
	Quality     domain.Quality
}

type Consumer struct {
	client *mqtt.Client
	res    *resolver.Resolver
	out    chan<- Item
	log    zerolog.Logger
}

func New(client *mqtt.Client, res *resolver.Resolver, out chan<- Item, log zerolog.Logger) *Consumer {
	return &Consumer{
		client: client,
		res:    res,
		out:    out,
		log:    log.With().Str("component", "consumer").Logger(),
	}
}

// Start abonne le client MQTT à qlab/+/+/+/+/+ et installe le handler.
// Bloque seulement le temps du SUBACK (la réception est faite dans des
// goroutines paho).
func (c *Consumer) Start(ctx context.Context) error {
	filter := topics.SubscriptionAllMeasurements()
	c.log.Info().Str("filter", filter).Msg("subscribing")
	return c.client.Subscribe(ctx, filter, 0, c.handle)
}

// handle est invoqué par paho à chaque message. Doit être non-bloquant —
// on push dans un channel bufferisé puis return immédiatement. Si le buffer
// est plein, on drop et on incrémente le counter (backpressure visible).
func (c *Consumer) handle(topic string, payload []byte) {
	metrics.MessagesReceived.Inc()

	parts, err := topics.Parse(topic)
	if err != nil {
		metrics.MessagesDropped.WithLabelValues("topic").Inc()
		return
	}

	// Le filtre qlab/+/+/+/+/+ matche aussi les topics state à 6 segments
	// et les commandes seraient à 7 (déjà non matchées). On filtre state.
	if parts.Kind != topics.KindMeasurement {
		return
	}

	p, err := domain.DecodePayload(payload)
	if err != nil {
		metrics.MessagesDropped.WithLabelValues("decode").Inc()
		c.log.Debug().Err(err).Str("topic", topic).Msg("payload decode failed")
		return
	}

	// Résolution slug → device_id. Si miss, on drop.
	id, found, err := c.res.Resolve(context.Background(), resolver.Key{
		Tenant: parts.Tenant, Site: parts.Site, Zone: parts.Zone, Device: parts.Device,
	})
	if err != nil {
		metrics.MessagesDropped.WithLabelValues("resolver_error").Inc()
		c.log.Warn().Err(err).Str("topic", topic).Msg("resolver db error")
		return
	}
	if !found {
		metrics.MessagesDropped.WithLabelValues("unknown_device").Inc()
		return
	}

	item := Item{
		TS:          p.TS,
		DeviceID:    id,
		Measurement: parts.Measurement,
		Value:       p.Value,
		Quality:     p.QualityOrDefault(),
	}

	select {
	case c.out <- item:
		metrics.MessagesAccepted.WithLabelValues(parts.Measurement).Inc()
		metrics.QueueDepth.Set(float64(len(c.out)))
	default:
		metrics.MessagesDropped.WithLabelValues("queue_full").Inc()
		c.log.Warn().Str("topic", topic).Msg("queue full, dropping")
	}
}
