// Package state encapsule l'état partagé du moteur de règles dans Redis :
//   - cooldown par règle (clé TTL)
//   - timestamp de début de condition soutenue (sustained) avec TTL = duration
//   - dernière valeur observée par device+measurement (pour value_change)
package state

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type State struct {
	r *redis.Client
}

func New(r *redis.Client) *State { return &State{r: r} }

// --- Cooldown -----------------------------------------------------------
//
// Le cooldown est keyé par (rule_id, device_slug). Pour les règles à scope
// device unique, le device_slug est celui du trigger. Pour les règles à
// scope zone, c'est le device qui vient de publier — ce qui permet à chaque
// device de la zone d'avoir son propre cooldown au lieu d'un cooldown global.

func (s *State) IsInCooldown(ctx context.Context, ruleID uuid.UUID, deviceSlug string) (bool, error) {
	n, err := s.r.Exists(ctx, cooldownKey(ruleID, deviceSlug)).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (s *State) SetCooldown(ctx context.Context, ruleID uuid.UUID, deviceSlug string, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	return s.r.Set(ctx, cooldownKey(ruleID, deviceSlug), "1", d).Err()
}

func cooldownKey(id uuid.UUID, deviceSlug string) string {
	if deviceSlug == "" {
		return "rule:" + id.String() + ":cooldown"
	}
	return "rule:" + id.String() + ":" + deviceSlug + ":cooldown"
}

// --- Sustained tracking -------------------------------------------------
//
// Pour un trigger threshold avec sustained_seconds > 0, on enregistre dès
// que la condition devient vraie l'instant `since`. Au prochain message qui
// confirme la condition vraie, on compare now-since ; si ≥ duration, le
// trigger est considéré atteint.
//
// Si la condition redevient fausse, on supprime la clé → le compteur repart
// à zéro à la prochaine validation.

func (s *State) MarkSustainedSince(ctx context.Context, ruleID uuid.UUID, deviceSlug string, ttl time.Duration) (int64, error) {
	k := sustainedKey(ruleID, deviceSlug)
	now := time.Now().Unix()
	// SET NX : pose `now` seulement si la clé n'existe pas encore.
	ok, err := s.r.SetNX(ctx, k, now, ttl+30*time.Second).Result()
	if err != nil {
		return 0, err
	}
	if ok {
		return now, nil
	}
	// Déjà posée : récupère le timestamp original
	v, err := s.r.Get(ctx, k).Result()
	if err != nil {
		return 0, err
	}
	since, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, err
	}
	return since, nil
}

func (s *State) ClearSustained(ctx context.Context, ruleID uuid.UUID, deviceSlug string) error {
	return s.r.Del(ctx, sustainedKey(ruleID, deviceSlug)).Err()
}

func sustainedKey(id uuid.UUID, deviceSlug string) string {
	if deviceSlug == "" {
		return "rule:" + id.String() + ":sustained_since"
	}
	return "rule:" + id.String() + ":" + deviceSlug + ":sustained_since"
}

// --- Last value (pour value_change) -------------------------------------

func (s *State) LastValue(ctx context.Context, deviceSlug, measurement string) (float64, bool, error) {
	v, err := s.r.Get(ctx, lastValueKey(deviceSlug, measurement)).Result()
	if err == redis.Nil {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0, false, nil
	}
	return f, true, nil
}

func (s *State) SetLastValue(ctx context.Context, deviceSlug, measurement string, value float64) error {
	// TTL court (10 min) pour ne pas garder des valeurs stales.
	return s.r.Set(ctx, lastValueKey(deviceSlug, measurement), value, 10*time.Minute).Err()
}

func lastValueKey(deviceSlug, measurement string) string {
	return fmt.Sprintf("last:%s:%s", deviceSlug, measurement)
}
