// Package alarms — persistance des alarmes déclenchées par le moteur.
//
// Une alarme représente une condition métier en cours (ex: "CO₂ trop élevé en
// Salle 204"). Cycle de vie :
//
//	triggered → acknowledged → resolved → archived
//
// Quand la règle re-fire alors qu'une alarme existe déjà (open) pour le même
// (rule_id, device_id) → on incrémente trigger_count et on ajoute un event,
// sans créer de doublon.
package alarms

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Trigger — fait remonter une alarme. Si une alarme open existe déjà pour
// (ruleID, deviceID), incrémente le compteur ; sinon en crée une nouvelle.
//
// Retourne (alarmID, isNew, error).
type TriggerInput struct {
	TenantID    uuid.UUID
	SiteID      uuid.UUID
	RuleID      uuid.UUID
	DeviceID    *uuid.UUID
	ZoneID      *uuid.UUID
	Label       string
	Name        string
	Description string
	Severity    string
	Model       string
	StatusText  string
	Attribute   string
	Value       *float64
	Unit        string
}

func (s *Store) Trigger(ctx context.Context, in TriggerInput) (uuid.UUID, bool, error) {
	if in.Severity == "" {
		in.Severity = "major"
	}
	if in.Label == "" {
		in.Label = "Dépassement de seuil"
	}
	if in.Model == "" {
		in.Model = "Standard"
	}

	// Cherche une alarme déjà ouverte pour (rule, device).
	var existingID uuid.UUID
	var existingCount int
	err := s.pool.QueryRow(ctx, `
		SELECT id, trigger_count FROM alarms
		WHERE rule_id = $1
		  AND ((device_id IS NULL AND $2::uuid IS NULL) OR device_id = $2)
		  AND state IN ('triggered', 'acknowledged')
		LIMIT 1`, in.RuleID, in.DeviceID).Scan(&existingID, &existingCount)

	if err == nil {
		// Alarme existante : incrémente + event.
		newCount := existingCount + 1
		_, err := s.pool.Exec(ctx, `
			UPDATE alarms
			SET trigger_count = $2,
			    last_triggered_at = now(),
			    last_value = $3,
			    severity = $4,
			    updated_at = now()
			WHERE id = $1`, existingID, newCount, in.Value, in.Severity)
		if err != nil {
			return uuid.Nil, false, err
		}
		_, err = s.pool.Exec(ctx, `
			INSERT INTO alarm_events (alarm_id, state, severity, description, trigger_count, value)
			VALUES ($1, 'triggered', $2, $3, $4, $5)`,
			existingID, in.Severity, "Re-déclenchement", newCount, in.Value)
		return existingID, false, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, err
	}

	// Pas d'alarme ouverte → crée.
	id := uuid.New()
	now := time.Now().UTC()
	_, err = s.pool.Exec(ctx, `
		INSERT INTO alarms
		  (id, tenant_id, site_id, rule_id, device_id, zone_id,
		   label, name, description, severity, model, status_text,
		   state, attribute, trigger_count, last_value, unit,
		   opened_at, last_triggered_at)
		VALUES
		  ($1, $2, $3, $4, $5, $6,
		   $7, $8, $9, $10, $11, $12,
		   'triggered', $13, 1, $14, $15,
		   $16, $16)`,
		id, in.TenantID, in.SiteID, in.RuleID, in.DeviceID, in.ZoneID,
		in.Label, in.Name, in.Description, in.Severity, in.Model, in.StatusText,
		in.Attribute, in.Value, in.Unit,
		now)
	if err != nil {
		return uuid.Nil, false, err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO alarm_events (alarm_id, state, severity, description, trigger_count, value)
		VALUES ($1, 'triggered', $2, 'Déclenchement initial', 1, $3)`,
		id, in.Severity, in.Value)
	return id, true, err
}

// AutoResolveByRuleAndDevice — passe à 'resolved' toutes les alarmes encore
// ouvertes (state IN ('triggered', 'acknowledged')) qui matchent (ruleID,
// deviceSlug). Appelée par le moteur quand la mesure repasse sous le seuil
// pour les règles edge-triggered. Retourne le nombre d'alarmes résolues.
func (s *Store) AutoResolveByRuleAndDevice(ctx context.Context, ruleID uuid.UUID, tenantSlug, deviceSlug string, currentValue float64) (int, error) {
	// Lookup device_id via tenant_slug + device_slug.
	var deviceID *uuid.UUID
	if deviceSlug != "" {
		var did uuid.UUID
		err := s.pool.QueryRow(ctx, `
			SELECT d.id FROM devices d
			JOIN zones z ON z.id = d.zone_id
			JOIN sites s ON s.id = z.site_id
			JOIN tenants t ON t.id = s.tenant_id
			WHERE t.slug = $1 AND d.slug = $2`, tenantSlug, deviceSlug).Scan(&did)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return 0, err
		}
		if err == nil {
			deviceID = &did
		}
	}

	// Marque les alarmes ouvertes comme résolues.
	rows, err := s.pool.Query(ctx, `
		UPDATE alarms
		SET    state       = 'resolved',
		       resolved_at = now(),
		       last_value  = $3,
		       updated_at  = now()
		WHERE  rule_id = $1
		  AND  ((device_id IS NULL AND $2::uuid IS NULL) OR device_id = $2)
		  AND  state IN ('triggered', 'acknowledged')
		RETURNING id`, ruleID, deviceID, currentValue)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	resolvedIDs := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		resolvedIDs = append(resolvedIDs, id)
	}

	// Ajoute un event "resolved" pour chaque alarme résolue (trace dans
	// l'historique pour la page Alarmes).
	for _, id := range resolvedIDs {
		_, _ = s.pool.Exec(ctx, `
			INSERT INTO alarm_events (alarm_id, state, severity, description, trigger_count, value)
			SELECT $1, 'resolved', severity,
			       'Retour à la normale (résolution automatique)',
			       trigger_count, $2
			FROM   alarms WHERE id = $1`, id, currentValue)
	}
	return len(resolvedIDs), nil
}

// LookupContext — résout en une seule requête (tenant_id, site_id, device_id,
// zone_id, unit) à partir du tenant_slug + device_slug + measurement.
type LookupResult struct {
	TenantID  uuid.UUID
	SiteID    uuid.UUID
	DeviceID  *uuid.UUID
	ZoneID    *uuid.UUID
	Unit      string
	Found     bool
}

func (s *Store) LookupContext(ctx context.Context, tenantSlug, deviceSlug, measurement string) (LookupResult, error) {
	var res LookupResult
	if deviceSlug == "" {
		// Cas cron : on a juste le tenant.
		err := s.pool.QueryRow(ctx, `SELECT id FROM tenants WHERE slug = $1`, tenantSlug).Scan(&res.TenantID)
		if err != nil {
			return res, err
		}
		return res, nil
	}
	var did, zid, sid, tid uuid.UUID
	var unit *string
	err := s.pool.QueryRow(ctx, `
		SELECT t.id, s.id, z.id, d.id,
		       (SELECT unit FROM measurements_metadata mm
		        WHERE mm.device_id = d.id AND mm.measurement = $3 LIMIT 1)
		FROM devices d
		JOIN zones z   ON z.id = d.zone_id
		JOIN sites s   ON s.id = z.site_id
		JOIN tenants t ON t.id = s.tenant_id
		WHERE t.slug = $1 AND d.slug = $2`, tenantSlug, deviceSlug, measurement,
	).Scan(&tid, &sid, &zid, &did, &unit)
	if err != nil {
		return res, err
	}
	res.TenantID = tid
	res.SiteID = sid
	res.DeviceID = &did
	res.ZoneID = &zid
	if unit != nil {
		res.Unit = *unit
	}
	res.Found = true
	return res, nil
}
