// Package jwt fournit la signature et la vérification des tokens HS256
// utilisés par l'API ZEINA. Les claims minimales sont {sub, tenant, role,
// exp, iat, type} où type ∈ {"access", "refresh"}.
package jwt

import (
	"errors"
	"fmt"
	"time"

	gojwt "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// TokenType différencie access (Bearer header) et refresh (httpOnly cookie).
type TokenType string

const (
	TokenAccess     TokenType = "access"
	TokenRefresh    TokenType = "refresh"
	TokenActivation TokenType = "activation" // nonce court entre verify-code et set-password
)

// Claims — payload des JWT ZEINA. Les champs std (Subject, IssuedAt, ExpiresAt)
// viennent de RegisteredClaims ; le reste est applicatif.
//
// Role contient le rôle tenant ("owner" | "member") — le RBAC fin (par site)
// est résolu côté serveur au moment de la requête, pas porté par le token.
type Claims struct {
	gojwt.RegisteredClaims
	TenantID     string    `json:"tenant_id"`
	Role         string    `json:"role"`
	IsSuperadmin bool      `json:"is_superadmin,omitempty"`
	Type         TokenType `json:"type"`
	// Purpose distingue first_login vs password_reset pour un token activation.
	// Vide pour les autres types.
	Purpose string `json:"purpose,omitempty"`
}

// Signer regroupe la clé secrète et les TTL applicables.
type Signer struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
	issuer     string
}

func NewSigner(secret string, accessTTL, refreshTTL time.Duration) (*Signer, error) {
	if len(secret) < 32 {
		return nil, errors.New("jwt: secret must be at least 32 bytes (HS256)")
	}
	if accessTTL <= 0 || refreshTTL <= 0 {
		return nil, errors.New("jwt: TTLs must be > 0")
	}
	return &Signer{
		secret:     []byte(secret),
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
		issuer:     "zeina",
	}, nil
}

// SignAccess génère un access token (court).
func (s *Signer) SignAccess(userID uuid.UUID, tenantID, role string, isSuperadmin bool) (string, error) {
	return s.sign(userID, tenantID, role, isSuperadmin, TokenAccess, s.accessTTL)
}

// SignRefresh génère un refresh token (long, à stocker côté client en cookie httpOnly).
func (s *Signer) SignRefresh(userID uuid.UUID, tenantID, role string, isSuperadmin bool) (string, error) {
	return s.sign(userID, tenantID, role, isSuperadmin, TokenRefresh, s.refreshTTL)
}

// SignActivation génère un nonce court qui prouve que l'utilisateur a saisi
// le bon code 6 chiffres. Sert à enchaîner verify-code → set-password sans
// stocker un nonce supplémentaire en DB. TTL = 5 min par défaut.
func (s *Signer) SignActivation(userID uuid.UUID, purpose string, ttl time.Duration) (string, error) {
	now := time.Now().UTC()
	claims := Claims{
		RegisteredClaims: gojwt.RegisteredClaims{
			Subject:   userID.String(),
			Issuer:    s.issuer,
			IssuedAt:  gojwt.NewNumericDate(now),
			ExpiresAt: gojwt.NewNumericDate(now.Add(ttl)),
			NotBefore: gojwt.NewNumericDate(now),
			ID:        uuid.NewString(),
		},
		Type:    TokenActivation,
		Purpose: purpose,
	}
	tok := gojwt.NewWithClaims(gojwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(s.secret)
	if err != nil {
		return "", fmt.Errorf("jwt sign activation: %w", err)
	}
	return signed, nil
}

// ParseActivation valide un nonce d'activation et retourne ses claims.
func (s *Signer) ParseActivation(tokenStr string) (*Claims, error) {
	c, err := s.parse(tokenStr)
	if err != nil {
		return nil, err
	}
	if c.Type != TokenActivation {
		return nil, fmt.Errorf("jwt: expected activation token, got %q", c.Type)
	}
	return c, nil
}

func (s *Signer) sign(userID uuid.UUID, tenantID, role string, isSuperadmin bool, typ TokenType, ttl time.Duration) (string, error) {
	now := time.Now().UTC()
	claims := Claims{
		RegisteredClaims: gojwt.RegisteredClaims{
			Subject:   userID.String(),
			Issuer:    s.issuer,
			IssuedAt:  gojwt.NewNumericDate(now),
			ExpiresAt: gojwt.NewNumericDate(now.Add(ttl)),
			NotBefore: gojwt.NewNumericDate(now),
			ID:        uuid.NewString(),
		},
		TenantID:     tenantID,
		Role:         role,
		IsSuperadmin: isSuperadmin,
		Type:         typ,
	}
	tok := gojwt.NewWithClaims(gojwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString(s.secret)
	if err != nil {
		return "", fmt.Errorf("jwt sign: %w", err)
	}
	return signed, nil
}

// ParseAccess valide un access token et retourne ses claims.
func (s *Signer) ParseAccess(tokenStr string) (*Claims, error) {
	c, err := s.parse(tokenStr)
	if err != nil {
		return nil, err
	}
	if c.Type != TokenAccess {
		return nil, fmt.Errorf("jwt: expected access token, got %q", c.Type)
	}
	return c, nil
}

// ParseRefresh valide un refresh token et retourne ses claims.
func (s *Signer) ParseRefresh(tokenStr string) (*Claims, error) {
	c, err := s.parse(tokenStr)
	if err != nil {
		return nil, err
	}
	if c.Type != TokenRefresh {
		return nil, fmt.Errorf("jwt: expected refresh token, got %q", c.Type)
	}
	return c, nil
}

func (s *Signer) parse(tokenStr string) (*Claims, error) {
	tok, err := gojwt.ParseWithClaims(tokenStr, &Claims{}, func(t *gojwt.Token) (any, error) {
		if _, ok := t.Method.(*gojwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("jwt: unexpected signing method %v", t.Header["alg"])
		}
		return s.secret, nil
	}, gojwt.WithIssuer(s.issuer), gojwt.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	c, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid {
		return nil, errors.New("jwt: invalid claims")
	}
	return c, nil
}
