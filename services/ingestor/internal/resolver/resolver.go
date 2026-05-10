// Package resolver convertit les slugs d'un topic MQTT (tenant/site/zone/device)
// en device_id UUID via un cache LRU au-dessus de la DB.
//
// Si un device n'existe pas en DB, on cache un "miss" pour éviter de re-checker
// à chaque message d'un device inconnu (sinon attaque DoS possible avec un
// publisher malveillant qui spamme des slugs aléatoires).
package resolver

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/zeina/hyperviseur/services/ingestor/internal/metrics"
)

// Key — composite slug = (tenant, site, zone, device).
type Key struct{ Tenant, Site, Zone, Device string }

// Entry — résultat d'un lookup.
type Entry struct {
	DeviceID uuid.UUID
	Found    bool
	cachedAt time.Time
}

type Resolver struct {
	pool *pgxpool.Pool
	log  zerolog.Logger

	maxEntries int
	posTTL     time.Duration // TTL d'un cache hit (positif)
	negTTL     time.Duration // TTL d'un cache miss (négatif) — plus court

	mu    sync.RWMutex
	cache map[Key]Entry
}

func New(pool *pgxpool.Pool, log zerolog.Logger) *Resolver {
	return &Resolver{
		pool:       pool,
		log:        log.With().Str("component", "resolver").Logger(),
		maxEntries: 10_000,
		posTTL:     10 * time.Minute,
		negTTL:     30 * time.Second,
		cache:      make(map[Key]Entry, 1024),
	}
}

// Resolve retourne (device_id, true) si trouvé, (zero, false) sinon.
// Renvoie une erreur seulement si la DB est inaccessible.
func (r *Resolver) Resolve(ctx context.Context, k Key) (uuid.UUID, bool, error) {
	r.mu.RLock()
	if e, ok := r.cache[k]; ok && !r.expired(e) {
		r.mu.RUnlock()
		metrics.ResolverCacheHits.Inc()
		return e.DeviceID, e.Found, nil
	}
	r.mu.RUnlock()

	metrics.ResolverCacheMisses.Inc()
	id, found, err := r.lookup(ctx, k)
	if err != nil {
		return uuid.Nil, false, err
	}
	r.put(k, Entry{DeviceID: id, Found: found, cachedAt: time.Now()})
	return id, found, nil
}

// Invalidate efface une clé du cache (utile après création d'un device via API).
func (r *Resolver) Invalidate(k Key) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.cache, k)
}

func (r *Resolver) lookup(ctx context.Context, k Key) (uuid.UUID, bool, error) {
	const q = `
		SELECT d.id
		FROM devices d
		JOIN zones    z ON z.id = d.zone_id
		JOIN sites    s ON s.id = z.site_id
		JOIN tenants  t ON t.id = s.tenant_id
		WHERE t.slug = $1 AND s.slug = $2 AND z.slug = $3 AND d.slug = $4
		LIMIT 1
	`
	var id uuid.UUID
	err := r.pool.QueryRow(ctx, q, k.Tenant, k.Site, k.Zone, k.Device).Scan(&id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return uuid.Nil, false, nil
	case err != nil:
		return uuid.Nil, false, err
	}
	return id, true, nil
}

func (r *Resolver) put(k Key, e Entry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Éviction simple : si on dépasse maxEntries, drop l'entrée la plus
	// ancienne (scan O(n) — acceptable car maxEntries est petit, et
	// l'éviction n'arrive qu'occasionnellement).
	if len(r.cache) >= r.maxEntries {
		var oldestKey Key
		oldest := time.Now()
		for k2, v := range r.cache {
			if v.cachedAt.Before(oldest) {
				oldest = v.cachedAt
				oldestKey = k2
			}
		}
		delete(r.cache, oldestKey)
	}
	r.cache[k] = e
}

func (r *Resolver) expired(e Entry) bool {
	ttl := r.posTTL
	if !e.Found {
		ttl = r.negTTL
	}
	return time.Since(e.cachedAt) > ttl
}

// Size — pour observabilité / tests.
func (r *Resolver) Size() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.cache)
}
