// Package db fournit l'ouverture d'un pgxpool.Pool partagé par tous les
// services Go ZEINA, avec retry au démarrage (utile en docker compose où la
// DB met quelques secondes à devenir healthy).
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

type Options struct {
	DSN              string
	MaxConns         int32
	MinConns         int32
	MaxConnLifetime  time.Duration
	MaxConnIdleTime  time.Duration
	HealthCheckEvery time.Duration

	// ConnectRetries — nb d'essais Connect au démarrage. Défaut : 10.
	ConnectRetries int
	// ConnectBackoff — délai entre essais. Défaut : 2s.
	ConnectBackoff time.Duration
}

// NewPool ouvre un pool pgx avec retry. Bloque jusqu'à succès, échec après
// ConnectRetries tentatives, ou ctx.Done.
func NewPool(ctx context.Context, opts Options, log zerolog.Logger) (*pgxpool.Pool, error) {
	if opts.DSN == "" {
		return nil, fmt.Errorf("db: DSN is required")
	}
	if opts.ConnectRetries <= 0 {
		opts.ConnectRetries = 10
	}
	if opts.ConnectBackoff <= 0 {
		opts.ConnectBackoff = 2 * time.Second
	}

	cfg, err := pgxpool.ParseConfig(opts.DSN)
	if err != nil {
		return nil, fmt.Errorf("db: parse DSN: %w", err)
	}
	if opts.MaxConns > 0 {
		cfg.MaxConns = opts.MaxConns
	}
	if opts.MinConns > 0 {
		cfg.MinConns = opts.MinConns
	}
	if opts.MaxConnLifetime > 0 {
		cfg.MaxConnLifetime = opts.MaxConnLifetime
	}
	if opts.MaxConnIdleTime > 0 {
		cfg.MaxConnIdleTime = opts.MaxConnIdleTime
	}
	if opts.HealthCheckEvery > 0 {
		cfg.HealthCheckPeriod = opts.HealthCheckEvery
	}

	var pool *pgxpool.Pool
	var lastErr error
	for attempt := 1; attempt <= opts.ConnectRetries; attempt++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		pool, err = pgxpool.NewWithConfig(ctx, cfg)
		if err == nil {
			pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			err = pool.Ping(pingCtx)
			cancel()
			if err == nil {
				log.Info().Int("attempt", attempt).Msg("db connected")
				return pool, nil
			}
			pool.Close()
		}

		lastErr = err
		log.Warn().Err(err).Int("attempt", attempt).Int("max", opts.ConnectRetries).
			Msg("db connect failed, retrying")

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(opts.ConnectBackoff):
		}
	}
	return nil, fmt.Errorf("db: connect after %d attempts: %w", opts.ConnectRetries, lastErr)
}
