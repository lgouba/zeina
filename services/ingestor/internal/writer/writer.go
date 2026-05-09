// Package writer écrit les batchs reçus du batcher dans la hypertable
// `measurements` via pgx CopyFrom (bulk insert performant).
//
// Met aussi à jour `devices.last_seen_at` de façon batchée pour éviter les
// updates ligne-à-ligne.
package writer

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/zeina/hyperviseur/services/ingestor/internal/consumer"
	"github.com/zeina/hyperviseur/services/ingestor/internal/metrics"
)

type Writer struct {
	pool *pgxpool.Pool
	log  zerolog.Logger
}

func New(pool *pgxpool.Pool, log zerolog.Logger) *Writer {
	return &Writer{pool: pool, log: log.With().Str("component", "writer").Logger()}
}

// Flush implémente batcher.Flusher.
func (w *Writer) Flush(ctx context.Context, batch []consumer.Item) error {
	if len(batch) == 0 {
		return nil
	}
	start := time.Now()
	defer func() {
		metrics.WriteDurationSeconds.Observe(time.Since(start).Seconds())
	}()

	rows := pgx.CopyFromSlice(len(batch), func(i int) ([]any, error) {
		it := batch[i]
		return []any{it.TS, it.DeviceID, it.Measurement, it.Value, string(it.Quality)}, nil
	})

	_, err := w.pool.CopyFrom(
		ctx,
		pgx.Identifier{"measurements"},
		[]string{"ts", "device_id", "measurement", "value", "quality"},
		rows,
	)
	if err != nil {
		metrics.WriteErrors.Inc()
		return err
	}

	// Touch last_seen_at en batch via UNNEST. Best-effort — si ça échoue on log
	// mais on retourne nil (les mesures sont déjà persistées, c'est secondaire).
	if err := w.touchLastSeen(ctx, batch); err != nil {
		w.log.Warn().Err(err).Msg("touch last_seen failed (best-effort)")
	}

	w.log.Debug().Int("size", len(batch)).Dur("duration", time.Since(start)).Msg("batch written")
	return nil
}

// touchLastSeen met à jour devices.last_seen_at = now() pour tous les UUIDs
// distincts du batch, en une seule requête (UPDATE FROM unnest).
func (w *Writer) touchLastSeen(ctx context.Context, batch []consumer.Item) error {
	seen := make(map[uuid.UUID]struct{}, 64)
	ids := make([]uuid.UUID, 0, 64)
	for _, it := range batch {
		if _, ok := seen[it.DeviceID]; !ok {
			seen[it.DeviceID] = struct{}{}
			ids = append(ids, it.DeviceID)
		}
	}
	const q = `
		UPDATE devices
		SET last_seen_at = now(),
		    status = CASE WHEN status = 'provisioned' THEN 'online'::device_status ELSE status END
		WHERE id = ANY($1::uuid[])
	`
	_, err := w.pool.Exec(ctx, q, ids)
	return err
}
