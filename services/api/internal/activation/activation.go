// Package activation gère la création et la vérification des codes 6 chiffres
// utilisés pour l'activation des comptes (première connexion) et la
// réinitialisation de mot de passe.
//
// Le code clair est généré aléatoirement (crypto/rand), affiché une seule fois
// dans le mail envoyé au user, puis bcrypt-hashé en DB. La vérification se
// fait en temps constant via bcrypt.CompareHashAndPassword.
//
// Sécurité :
//   - 6 chiffres → 1 chance sur 10⁶ par tentative
//   - 5 tentatives max par code (compteur DB)
//   - expire en 15 min par défaut
//   - single-use (used_at une fois consommé)
//   - tous les codes existants pour (user, purpose) sont invalidés à la
//     création d'un nouveau code (revoke previous)
package activation

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const (
	// PurposeFirstLogin — activation initiale d'un compte créé par admin.
	PurposeFirstLogin = "first_login"
	// PurposePasswordReset — utilisateur a oublié son mot de passe.
	PurposePasswordReset = "password_reset"

	// MaxAttempts limite le brute-force (au-delà, le code est marqué consommé).
	MaxAttempts = 5

	// DefaultTTL — durée de vie d'un code.
	DefaultTTL = 15 * time.Minute

	// NonceTTL — durée du JWT court entre verify-code et set-password.
	NonceTTL = 5 * time.Minute
)

// Errors retournés par Verify. Le handler les convertit en réponses HTTP
// avec le bon status, mais pour la sécurité on retourne souvent le même
// message générique au client.
var (
	ErrInvalidCode = errors.New("activation: invalid code")
	ErrExpiredCode = errors.New("activation: code expired")
	ErrTooManyAttempts = errors.New("activation: too many attempts")
)

// Service centralise la logique des codes (création + vérification).
type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// GenerateCode — un entier aléatoire 6 chiffres formaté avec leading zeros.
//   "042817", "999999", "000003" sont tous valides.
func GenerateCode() (string, error) {
	max := big.NewInt(1_000_000)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// Issue invalide les codes existants pour (user, purpose) et insère un
// nouveau code. Retourne le code en clair (à envoyer dans le mail) et le
// row ID interne (pas exposé au user, juste pour debug/audit).
func (s *Service) Issue(ctx context.Context, userID uuid.UUID, purpose string) (string, uuid.UUID, error) {
	code, err := GenerateCode()
	if err != nil {
		return "", uuid.Nil, fmt.Errorf("generate code: %w", err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		return "", uuid.Nil, fmt.Errorf("bcrypt: %w", err)
	}

	// Invalide les codes précédents non encore utilisés.
	if _, err := s.pool.Exec(ctx,
		`UPDATE user_activation_codes
		 SET    used_at = now()
		 WHERE  user_id = $1 AND purpose = $2::activation_purpose
		   AND  used_at IS NULL`,
		userID, purpose,
	); err != nil {
		return "", uuid.Nil, fmt.Errorf("revoke previous codes: %w", err)
	}

	var id uuid.UUID
	err = s.pool.QueryRow(ctx,
		`INSERT INTO user_activation_codes (user_id, code_hash, purpose, expires_at)
		 VALUES ($1, $2, $3::activation_purpose, $4)
		 RETURNING id`,
		userID, string(hash), purpose, time.Now().Add(DefaultTTL),
	).Scan(&id)
	if err != nil {
		return "", uuid.Nil, fmt.Errorf("insert code: %w", err)
	}
	return code, id, nil
}

// Verify cherche le code actif le plus récent pour (userID, purpose), vérifie
// qu'il n'est pas expiré ni épuisé, et compare le hash bcrypt.
//
// En cas de mauvais code, incrémente attempts. Quand attempts atteint MaxAttempts,
// le code est marqué used_at (= invalidé) — l'utilisateur devra demander un
// nouveau code.
//
// En cas de succès, marque le code comme consommé (used_at = now()) et
// retourne nil.
func (s *Service) Verify(ctx context.Context, userID uuid.UUID, purpose, code string) error {
	var (
		id        uuid.UUID
		codeHash  string
		attempts  int
		expiresAt time.Time
		usedAt    *time.Time
	)
	err := s.pool.QueryRow(ctx,
		`SELECT id, code_hash, attempts, expires_at, used_at
		 FROM   user_activation_codes
		 WHERE  user_id = $1 AND purpose = $2::activation_purpose
		   AND  used_at IS NULL
		 ORDER BY created_at DESC LIMIT 1`,
		userID, purpose,
	).Scan(&id, &codeHash, &attempts, &expiresAt, &usedAt)
	if err != nil {
		return ErrInvalidCode
	}
	if time.Now().After(expiresAt) {
		return ErrExpiredCode
	}
	if attempts >= MaxAttempts {
		// Sécurité ceinture-bretelles : le code aurait dû être invalidé déjà.
		_, _ = s.pool.Exec(ctx,
			`UPDATE user_activation_codes SET used_at = now() WHERE id = $1`, id)
		return ErrTooManyAttempts
	}
	if err := bcrypt.CompareHashAndPassword([]byte(codeHash), []byte(code)); err != nil {
		// Bad code → on incrémente attempts et on invalide si on atteint le seuil.
		newAttempts := attempts + 1
		if newAttempts >= MaxAttempts {
			_, _ = s.pool.Exec(ctx,
				`UPDATE user_activation_codes
				 SET    attempts = $2, used_at = now()
				 WHERE  id = $1`, id, newAttempts)
			return ErrTooManyAttempts
		}
		_, _ = s.pool.Exec(ctx,
			`UPDATE user_activation_codes SET attempts = $2 WHERE id = $1`, id, newAttempts)
		return ErrInvalidCode
	}
	// Code OK → marque consommé.
	if _, err := s.pool.Exec(ctx,
		`UPDATE user_activation_codes SET used_at = now() WHERE id = $1`, id); err != nil {
		return fmt.Errorf("mark used: %w", err)
	}
	return nil
}
