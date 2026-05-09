// Package store charge les règles + leurs métadonnées tenant/site depuis la DB,
// et écoute les notifications pour rafraîchir le cache à chaud.
package store

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/zeina/hyperviseur/services/rules-engine/internal/definition"
)

// Loaded — vue interne d'une règle prête à être évaluée.
type Loaded struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	TenantSlug string
	Name       string
	Definition *definition.Rule
}

type Store struct {
	pool *pgxpool.Pool
	log  zerolog.Logger

	mu    sync.RWMutex
	rules map[uuid.UUID]Loaded
}

func New(pool *pgxpool.Pool, log zerolog.Logger) *Store {
	return &Store{
		pool:  pool,
		log:   log.With().Str("component", "rules-store").Logger(),
		rules: make(map[uuid.UUID]Loaded),
	}
}

// LoadAll récupère toutes les règles activées + résout le slug du tenant.
func (s *Store) LoadAll(ctx context.Context) error {
	const q = `
		SELECT r.id, r.tenant_id, t.slug, r.name, r.definition
		FROM rules r
		JOIN tenants t ON t.id = r.tenant_id
		WHERE r.enabled = TRUE
	`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return err
	}
	defer rows.Close()

	next := make(map[uuid.UUID]Loaded, 32)
	for rows.Next() {
		var l Loaded
		var raw []byte
		if err := rows.Scan(&l.ID, &l.TenantID, &l.TenantSlug, &l.Name, &raw); err != nil {
			s.log.Warn().Err(err).Msg("scan rule")
			continue
		}
		def, err := definition.Parse(raw)
		if err != nil {
			s.log.Warn().Err(err).Str("rule_id", l.ID.String()).Msg("invalid rule definition, skipping")
			continue
		}
		l.Definition = def
		next[l.ID] = l
	}

	s.mu.Lock()
	added := len(next) - len(s.rules)
	s.rules = next
	s.mu.Unlock()
	s.log.Info().Int("count", len(next)).Int("delta", added).Msg("rules reloaded")
	return nil
}

// All retourne une copie de la map des règles actives.
func (s *Store) All() map[uuid.UUID]Loaded {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cp := make(map[uuid.UUID]Loaded, len(s.rules))
	for k, v := range s.rules {
		cp[k] = v
	}
	return cp
}

// ListenChanges abonne le store aux notifications pg_notify('rules_change')
// émises par le trigger SQL — recharge tout à chaque évènement.
//
// Bloque jusqu'à ctx.Done. Le Listen utilise une connexion dédiée (Acquire +
// Release manuels, pas de pool en usage long).
func (s *Store) ListenChanges(ctx context.Context) {
	for {
		if err := s.listenLoop(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			s.log.Warn().Err(err).Msg("LISTEN dropped, reconnecting in 2s")
			time.Sleep(2 * time.Second)
		}
	}
}

func (s *Store) listenLoop(ctx context.Context) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "LISTEN rules_change"); err != nil {
		return err
	}
	s.log.Info().Msg("listening for rules_change notifications")

	for {
		_, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}
		if err := s.LoadAll(ctx); err != nil {
			s.log.Warn().Err(err).Msg("reload after notify failed")
		}
	}
}

// LogExecution insère une ligne dans rule_executions.
func (s *Store) LogExecution(ctx context.Context, ruleID uuid.UUID, action []byte, result string, errMsg string, latencyMs int) {
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO rule_executions (rule_id, action_taken, result, error_message, latency_ms)
		VALUES ($1, $2::jsonb, $3::rule_execution_result, NULLIF($4, ''), $5)`,
		ruleID, action, result, errMsg, latencyMs,
	); err != nil {
		s.log.Warn().Err(err).Msg("log execution failed")
	}
}

// silenceUnused garde l'import pgx (utile pour pgxpool en relectures futures).
var _ = pgx.ErrNoRows
