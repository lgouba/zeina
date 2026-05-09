// Package batcher accumule les Items reçus du consumer et les flushe par lots
// (taille max OU timeout) vers le writer.
package batcher

import (
	"context"
	"time"

	"github.com/rs/zerolog"

	"github.com/zeina/hyperviseur/services/ingestor/internal/consumer"
	"github.com/zeina/hyperviseur/services/ingestor/internal/metrics"
)

// Flusher — tout consommateur d'un batch (en pratique writer.Writer).
type Flusher interface {
	Flush(ctx context.Context, batch []consumer.Item) error
}

type Batcher struct {
	in       <-chan consumer.Item
	flusher  Flusher
	maxSize  int
	maxDelay time.Duration
	log      zerolog.Logger
}

func New(in <-chan consumer.Item, f Flusher, maxSize int, maxDelay time.Duration, log zerolog.Logger) *Batcher {
	if maxSize <= 0 {
		maxSize = 500
	}
	if maxDelay <= 0 {
		maxDelay = time.Second
	}
	return &Batcher{
		in: in, flusher: f,
		maxSize: maxSize, maxDelay: maxDelay,
		log: log.With().Str("component", "batcher").Logger(),
	}
}

// Run fait tourner la boucle batcher. Bloque jusqu'à ctx.Done. À la sortie,
// drain le channel d'entrée en flushant les items résiduels — important pour
// ne pas perdre de mesures lors d'un SIGTERM.
func (b *Batcher) Run(ctx context.Context) {
	buf := make([]consumer.Item, 0, b.maxSize)
	timer := time.NewTimer(b.maxDelay)
	defer timer.Stop()

	resetTimer := func() {
		if !timer.Stop() {
			// Drain le canal au cas où le timer aurait déjà déclenché.
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(b.maxDelay)
	}

	flush := func() {
		// Toujours réarmer le timer en sortie, même si buf est vide.
		// Sinon un tick à vide empêcherait les flushs suivants.
		defer resetTimer()
		if len(buf) == 0 {
			return
		}
		metrics.BatchSize.Observe(float64(len(buf)))
		// Pour la résilience, on utilise un context avec timeout court : si
		// le writer est bloqué, on log et on relâche le batch suivant.
		fctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := b.flusher.Flush(fctx, buf)
		cancel()
		if err != nil {
			b.log.Error().Err(err).Int("size", len(buf)).Msg("flush failed")
		}
		buf = buf[:0]
	}

	for {
		select {
		case <-ctx.Done():
			// Drain : lis tout ce qu'il reste sans bloquer.
			for {
				select {
				case it := <-b.in:
					buf = append(buf, it)
					if len(buf) >= b.maxSize {
						flush()
					}
				default:
					flush()
					b.log.Info().Msg("batcher drained, exiting")
					return
				}
			}

		case it := <-b.in:
			buf = append(buf, it)
			metrics.QueueDepth.Set(float64(len(b.in)))
			if len(buf) >= b.maxSize {
				flush()
			}

		case <-timer.C:
			flush()
		}
	}
}
