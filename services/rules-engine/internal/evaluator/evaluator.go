// Package evaluator évalue les conditions d'une règle en allant chercher
// la dernière valeur observée pour chaque (device, measurement) dans Redis.
package evaluator

import (
	"context"

	"github.com/zeina/hyperviseur/services/rules-engine/internal/definition"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/state"
)

// EvaluateConditions retourne true si toutes/au moins une (selon op) des
// conditions sont vérifiées. Si aucune condition, retourne true (pas de
// filtre).
func EvaluateConditions(ctx context.Context, st *state.State, conds []definition.Condition, op string) (bool, error) {
	if len(conds) == 0 {
		return true, nil
	}
	if op == "" {
		op = "AND"
	}

	results := make([]bool, len(conds))
	for i, c := range conds {
		v, ok, err := st.LastValue(ctx, c.DeviceSlug, c.Measurement)
		if err != nil {
			return false, err
		}
		if !ok {
			// Pas encore vu cette mesure → condition fausse par défaut.
			results[i] = false
			continue
		}
		results[i] = definition.Compare(v, c.Value, c.Op)
	}

	if op == "OR" {
		for _, b := range results {
			if b {
				return true, nil
			}
		}
		return false, nil
	}
	// AND
	for _, b := range results {
		if !b {
			return false, nil
		}
	}
	return true, nil
}
