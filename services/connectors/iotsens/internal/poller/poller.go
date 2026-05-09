// Package poller orchestre une goroutine par device IoTSens : à chaque tick,
// récupère les nouvelles mesures via le client REST et les republie sur le
// broker MQTT au format ZEINA.
package poller

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/zeina/hyperviseur/packages/shared/domain"
	sharedmqtt "github.com/zeina/hyperviseur/packages/shared/mqtt"
	"github.com/zeina/hyperviseur/packages/shared/topics"

	"github.com/zeina/hyperviseur/services/connectors/iotsens/internal/client"
	"github.com/zeina/hyperviseur/services/connectors/iotsens/internal/mapper"
	"github.com/zeina/hyperviseur/services/connectors/iotsens/internal/metrics"
)

type Poller struct {
	client *client.Client
	mqtt   *sharedmqtt.Client
	mapper *mapper.Mapper
	log    zerolog.Logger

	mu     sync.Mutex
	tasks  map[string]context.CancelFunc // ext_id → cancel
}

func New(c *client.Client, m *sharedmqtt.Client, mp *mapper.Mapper, log zerolog.Logger) *Poller {
	return &Poller{
		client: c, mqtt: m, mapper: mp,
		log:   log.With().Str("component", "poller").Logger(),
		tasks: make(map[string]context.CancelFunc),
	}
}

// Run démarre le superviseur de pollers. Lance/arrête une goroutine par
// device présent dans la mapper, en se réajustant à chaque réconciliation.
func (p *Poller) Run(ctx context.Context, reconcileEvery time.Duration) {
	if reconcileEvery <= 0 {
		reconcileEvery = 15 * time.Second
	}
	t := time.NewTicker(reconcileEvery)
	defer t.Stop()
	p.reconcile(ctx)
	for {
		select {
		case <-ctx.Done():
			p.stopAll()
			return
		case <-t.C:
			p.reconcile(ctx)
		}
	}
}

func (p *Poller) reconcile(ctx context.Context) {
	want := p.mapper.All()
	metrics.DevicesMapped.Set(float64(len(want)))

	p.mu.Lock()
	defer p.mu.Unlock()

	// Stopper ceux qui n'existent plus
	for ext, cancel := range p.tasks {
		if _, ok := want[ext]; !ok {
			cancel()
			delete(p.tasks, ext)
			p.log.Info().Str("ext_id", ext).Msg("stopped poller (device removed)")
		}
	}
	// Démarrer les nouveaux
	for ext, entry := range want {
		if _, ok := p.tasks[ext]; ok {
			continue
		}
		ctx2, cancel := context.WithCancel(ctx)
		p.tasks[ext] = cancel
		go p.pollDevice(ctx2, ext, entry)
		p.log.Info().Str("ext_id", ext).
			Str("zeina_slug", entry.DeviceSlug).
			Int("interval_s", entry.IntervalS).
			Msg("started poller")
	}
}

func (p *Poller) stopAll() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, c := range p.tasks {
		c()
	}
	p.tasks = nil
}

// pollDevice — boucle de polling pour UN device IoTSens.
func (p *Poller) pollDevice(ctx context.Context, extID string, e mapper.Entry) {
	interval := time.Duration(e.IntervalS) * time.Second
	if interval <= 0 {
		interval = 60 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()

	// On commence à "il y a 5 minutes" pour récupérer un peu d'historique au boot.
	since := time.Now().Add(-5 * time.Minute)

	doPoll := func() {
		start := time.Now()
		ms, err := p.client.Measurements(ctx, extID, since)
		metrics.PollDurationSeconds.Observe(time.Since(start).Seconds())
		if err != nil {
			metrics.PollsTotal.WithLabelValues("error").Inc()
			p.log.Warn().Err(err).Str("ext_id", extID).Msg("poll failed")
			return
		}
		metrics.PollsTotal.WithLabelValues("ok").Inc()

		// Pour chaque mesure : publier sur MQTT
		var maxTS time.Time
		for _, m := range ms {
			ts, err := m.ParsedTime()
			if err != nil {
				continue
			}
			if ts.After(maxTS) {
				maxTS = ts
			}
			if err := p.publish(ctx, e, m, ts); err != nil {
				p.log.Warn().Err(err).Str("ext_id", extID).Str("type", m.Type).Msg("publish failed")
			}
		}
		if !maxTS.IsZero() {
			since = maxTS // évite de re-récupérer les mêmes mesures
		}
	}

	doPoll()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			doPoll()
		}
	}
}

// publish transforme une mesure IoTSens en payload ZEINA et publie sur MQTT.
//
// Mapping unit IoTSens → unit ZEINA : si l'unit IoTSens diffère du standard
// ZEINA, on normalise ici (ex: "C" → "celsius"). Pour la démo, on garde tel
// quel sauf cas évidents.
func (p *Poller) publish(ctx context.Context, e mapper.Entry, m client.Measurement, ts time.Time) error {
	topic, err := topics.BuildMeasurementTopic(e.TenantSlug, e.SiteSlug, e.ZoneSlug, e.DeviceSlug, normalizeMeasurement(m.Type))
	if err != nil {
		return err
	}
	q := domain.QualityGood
	if m.Quality == "uncertain" || m.Quality == "bad" {
		q = domain.Quality(m.Quality)
	}
	payload := domain.Payload{
		TS:      ts,
		Value:   m.Value,
		Unit:    normalizeUnit(m.Unit),
		Quality: q,
	}
	body, err := payload.Encode()
	if err != nil {
		return err
	}
	if err := p.mqtt.Publish(ctx, topic, 0, false, body); err != nil {
		return err
	}
	metrics.MeasurementsForwarded.WithLabelValues(m.Type).Inc()
	return nil
}

// --- normalisations ---

func normalizeMeasurement(t string) string {
	// Place pour mappings spécifiques. Pour l'instant : passthrough.
	return t
}

func normalizeUnit(u string) string {
	switch u {
	case "C":
		return "celsius"
	case "F":
		return "fahrenheit"
	case "%":
		return "percent"
	case "Wh":
		return "watt-hour"
	case "W":
		return "watt"
	case "VA":
		return "VA"
	case "A":
		return "ampere"
	case "V":
		return "volt"
	case "ppm":
		return "ppm"
	case "lux":
		return "lux"
	case "bool":
		return "bool"
	default:
		return u
	}
}
