// Package rbac centralise les types et la logique de contrôle d'accès
// fonctionnel de ZEINA.
//
// Modèle simple :
//   - chaque "feature" (dashboard, devices, rules, members) a un niveau
//     d'accès : "none" | "read" | "write"
//   - "write" implique "read" — pas de niveau intermédiaire
//   - is_superadmin OR tenant_role=owner → write partout, bypass des checks
//   - sinon, le niveau est lu sur le rôle attribué via site_members
package rbac

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Feature — capacité fonctionnelle protégée.
type Feature string

const (
	FeatureDashboard Feature = "dashboard"
	FeatureDevices   Feature = "devices"
	FeatureRules     Feature = "rules"
	FeatureMembers   Feature = "members"
)

// AllFeatures est utilisé par l'UI d'édition des rôles (matrice à cocher)
// et par FullAccess() pour générer un set "write partout".
var AllFeatures = []Feature{
	FeatureDashboard, FeatureDevices, FeatureRules, FeatureMembers,
}

// Level — niveau d'accès.
type Level string

const (
	LevelNone  Level = "none"
	LevelRead  Level = "read"
	LevelWrite Level = "write"
)

// Allows retourne true si `have` couvre `need` (write couvre read couvre none).
func (l Level) Allows(need Level) bool {
	rank := map[Level]int{LevelNone: 0, LevelRead: 1, LevelWrite: 2}
	return rank[l] >= rank[need]
}

// PermissionSet — map feature → niveau. Sérialisé en JSONB en DB.
type PermissionSet map[Feature]Level

// Get retourne le niveau pour la feature, none si absent.
func (p PermissionSet) Get(f Feature) Level {
	if p == nil {
		return LevelNone
	}
	if l, ok := p[f]; ok && l != "" {
		return l
	}
	return LevelNone
}

// ParsePermissions — décode le JSONB roles.permissions. Tolérant : entrées
// inconnues ignorées, niveaux invalides → none.
func ParsePermissions(raw []byte) PermissionSet {
	out := PermissionSet{}
	if len(raw) == 0 {
		return out
	}
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		return out
	}
	for k, v := range m {
		f := Feature(k)
		l := Level(v)
		if l != LevelNone && l != LevelRead && l != LevelWrite {
			continue
		}
		out[f] = l
	}
	return out
}

// FullAccess — write sur toutes les features connues. Utilisé pour les
// superadmins et les owners de tenant.
func FullAccess() PermissionSet {
	out := PermissionSet{}
	for _, f := range AllFeatures {
		out[f] = LevelWrite
	}
	return out
}

// Resolver — calcule le niveau d'un user pour une feature sur un site donné.
type Resolver struct {
	pool *pgxpool.Pool
}

func NewResolver(pool *pgxpool.Pool) *Resolver {
	return &Resolver{pool: pool}
}

// SiteAccess — résultat de la résolution.
type SiteAccess struct {
	IsSuperadmin bool
	IsOwner      bool // tenant_role = owner
	Permissions  PermissionSet
}

// Effective renvoie le niveau effectif après prise en compte des bypass.
func (a SiteAccess) Effective(f Feature) Level {
	if a.IsSuperadmin || a.IsOwner {
		return LevelWrite
	}
	return a.Permissions.Get(f)
}

// ResolveBySite calcule l'accès d'un user à un site donné. Retourne
// (access, found) — found=false si l'user n'est pas membre du site et
// n'est pas superadmin/owner.
func (r *Resolver) ResolveBySite(ctx context.Context, userID, siteID uuid.UUID) (SiteAccess, bool, error) {
	var (
		isSuper bool
		role    string
		userTID uuid.UUID
	)
	const userQ = `SELECT is_superadmin, tenant_role::text, tenant_id FROM users WHERE id = $1`
	if err := r.pool.QueryRow(ctx, userQ, userID).Scan(&isSuper, &role, &userTID); err != nil {
		return SiteAccess{}, false, err
	}
	if isSuper {
		return SiteAccess{IsSuperadmin: true, Permissions: FullAccess()}, true, nil
	}

	// Vérifier que le site appartient au tenant du user (anti-fuite cross-tenant)
	var siteTID uuid.UUID
	if err := r.pool.QueryRow(ctx, `SELECT tenant_id FROM sites WHERE id = $1`, siteID).Scan(&siteTID); err != nil {
		return SiteAccess{}, false, nil // site inconnu → pas d'accès
	}
	if siteTID != userTID {
		return SiteAccess{}, false, nil
	}

	if role == "owner" {
		return SiteAccess{IsOwner: true, Permissions: FullAccess()}, true, nil
	}

	// Membership explicite
	const memQ = `
		SELECT r.permissions
		FROM site_members sm
		JOIN roles r ON r.id = sm.role_id
		WHERE sm.site_id = $1 AND sm.user_id = $2
	`
	var permsRaw []byte
	if err := r.pool.QueryRow(ctx, memQ, siteID, userID).Scan(&permsRaw); err != nil {
		return SiteAccess{}, false, nil // pas membre
	}
	return SiteAccess{Permissions: ParsePermissions(permsRaw)}, true, nil
}
