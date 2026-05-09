// Package audit fournit un helper pour journaliser les actions sensibles
// (création/suppression de site, attribution de rôle, etc.) dans la table
// `audit_events`.
//
// L'écriture est best-effort : si le log échoue, on log en stderr mais on
// ne casse pas la transaction métier — l'audit n'est pas un point d'arrêt.
package audit

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// Event représente une opération à journaliser.
type Event struct {
	TenantID   uuid.UUID
	ActorID    *uuid.UUID
	ActorEmail string
	Action     string // ex: site.create, member.update, role.delete
	TargetType string // ex: site, user, role, member
	TargetID   *uuid.UUID
	TargetName string         // snapshot lisible (nom du site, email du user…)
	Metadata   map[string]any // payload contextuel (peut contenir before/after)
}

// Logger écrit dans audit_events. Une instance partagée vit dans l'API.
type Logger struct {
	pool *pgxpool.Pool
}

func NewLogger(pool *pgxpool.Pool) *Logger {
	return &Logger{pool: pool}
}

// Log écrit l'événement. Best-effort — n'échoue jamais (renvoie nil), mais
// log les erreurs DB en warning. Si ActorEmail est vide et ActorID renseigné,
// le Logger résout l'email en DB pour le snapshotter.
func (l *Logger) Log(ctx context.Context, ev Event) {
	if ev.TenantID == uuid.Nil || ev.Action == "" {
		log.Warn().Interface("ev", ev).Msg("audit: invalid event ignored")
		return
	}
	if ev.ActorEmail == "" && ev.ActorID != nil {
		var email string
		if err := l.pool.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, *ev.ActorID).Scan(&email); err == nil {
			ev.ActorEmail = email
		}
	}
	meta, _ := json.Marshal(orEmpty(ev.Metadata))
	const q = `
		INSERT INTO audit_events (tenant_id, actor_id, actor_email, action, target_type, target_id, target_name, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	if _, err := l.pool.Exec(ctx, q,
		ev.TenantID, ev.ActorID, nullableText(ev.ActorEmail),
		ev.Action, nullableText(ev.TargetType), ev.TargetID, nullableText(ev.TargetName), meta,
	); err != nil {
		log.Warn().Err(err).Str("action", ev.Action).Msg("audit: insert failed")
	}
}

func orEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func nullableText(s string) any {
	if s == "" {
		return nil
	}
	return s
}
