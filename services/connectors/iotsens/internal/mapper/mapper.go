// Package mapper interroge la DB ZEINA pour récupérer la liste des devices
// configurés avec metadata.external.vendor = 'iotsens', et construit la table
// de routage IoTSens device_id → topic ZEINA.
package mapper

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// Entry — mapping d'un device IoTSens vers son identité ZEINA.
type Entry struct {
	ZeinaDeviceID uuid.UUID
	TenantSlug    string
	SiteSlug      string
	ZoneSlug      string
	DeviceSlug    string
	IntervalS     int
}

type Mapper struct {
	pool *pgxpool.Pool
	log  zerolog.Logger

	mu      sync.RWMutex
	byExtID map[string]Entry
}

func New(pool *pgxpool.Pool, log zerolog.Logger) *Mapper {
	return &Mapper{
		pool:    pool,
		log:     log.With().Str("component", "mapper").Logger(),
		byExtID: make(map[string]Entry),
	}
}

// Refresh interroge la DB et reconstruit la table de routage. À appeler
// périodiquement (ex: toutes les 30s) ou sur signal LISTEN/NOTIFY.
func (m *Mapper) Refresh(ctx context.Context) error {
	const q = `
		SELECT
		  d.id,
		  t.slug, s.slug, z.slug, d.slug,
		  d.metadata->'external'->>'external_id'    AS ext_id,
		  COALESCE((d.metadata->'external'->>'interval_s')::int, 60) AS interval_s
		FROM devices d
		JOIN zones z ON z.id = d.zone_id
		JOIN sites s ON s.id = z.site_id
		JOIN tenants t ON t.id = s.tenant_id
		WHERE d.metadata->'external'->>'vendor' = 'iotsens'
		  AND d.metadata->'external'->>'external_id' IS NOT NULL
	`
	rows, err := m.pool.Query(ctx, q)
	if err != nil {
		return err
	}
	defer rows.Close()

	next := make(map[string]Entry, 16)
	for rows.Next() {
		var e Entry
		var extID string
		if err := rows.Scan(&e.ZeinaDeviceID, &e.TenantSlug, &e.SiteSlug, &e.ZoneSlug, &e.DeviceSlug, &extID, &e.IntervalS); err != nil {
			return err
		}
		next[extID] = e
	}

	m.mu.Lock()
	added, removed := diff(m.byExtID, next)
	m.byExtID = next
	m.mu.Unlock()

	if added+removed > 0 {
		m.log.Info().Int("added", added).Int("removed", removed).Int("total", len(next)).Msg("mapping refreshed")
	}
	return nil
}

// All retourne une copie de la table courante.
func (m *Mapper) All() map[string]Entry {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cp := make(map[string]Entry, len(m.byExtID))
	for k, v := range m.byExtID {
		cp[k] = v
	}
	return cp
}

func (m *Mapper) Get(extID string) (Entry, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.byExtID[extID]
	return v, ok
}

// Run lance une boucle de refresh périodique.
func (m *Mapper) Run(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = 30 * time.Second
	}
	t := time.NewTicker(every)
	defer t.Stop()
	if err := m.Refresh(ctx); err != nil {
		m.log.Warn().Err(err).Msg("initial refresh failed")
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := m.Refresh(ctx); err != nil {
				m.log.Warn().Err(err).Msg("refresh failed")
			}
		}
	}
}

func diff(prev, next map[string]Entry) (added, removed int) {
	for k := range next {
		if _, ok := prev[k]; !ok {
			added++
		}
	}
	for k := range prev {
		if _, ok := next[k]; !ok {
			removed++
		}
	}
	return
}
