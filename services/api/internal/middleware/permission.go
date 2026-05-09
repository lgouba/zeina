// Permission middleware — gating des routes par feature × niveau, résolu
// au runtime sur le site cible.
//
// Le site est identifié soit directement (paramètre de route), soit dérivé
// d'une autre entité (device, rule, dashboard) via la DB. On expose des
// helpers `SiteFrom...` pour les cas usuels.

package middleware

import (
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"

	"github.com/zeina/hyperviseur/services/api/internal/rbac"
)

const (
	CtxKeySiteID = "site_id" // uuid.UUID — site résolu par RequirePermission
	CtxKeyAccess = "access"  // rbac.SiteAccess — utile dans le handler
)

// SiteResolver retourne l'ID du site cible d'une requête à partir du contexte
// echo (paramètre de route, body, etc.).
type SiteResolver func(c echo.Context) (uuid.UUID, error)

// RequirePermission renvoie un middleware qui :
//  1. résout le site cible via `getSite`
//  2. calcule l'accès du user courant via le Resolver RBAC
//  3. exige que le niveau effectif sur `feature` couvre `need`
//  4. pose c.Set(CtxKeySiteID, siteID) et c.Set(CtxKeyAccess, access)
func RequirePermission(rs *rbac.Resolver, feature rbac.Feature, need rbac.Level, getSite SiteResolver) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, ok := c.Get(CtxKeyClaims).(*jwt.Claims)
			if !ok || claims == nil {
				return apperr.Unauthorized("")
			}
			uid, err := uuid.Parse(claims.Subject)
			if err != nil {
				return apperr.Unauthorized("malformed subject")
			}

			siteID, err := getSite(c)
			if err != nil {
				return err
			}

			access, found, err := rs.ResolveBySite(c.Request().Context(), uid, siteID)
			if err != nil {
				return apperr.Wrap(apperr.KindInternal, "rbac resolve", err)
			}
			if !found {
				return apperr.Forbidden("not a member of this site")
			}
			if !access.Effective(feature).Allows(need) {
				return apperr.Forbidden("insufficient permission")
			}

			c.Set(CtxKeySiteID, siteID)
			c.Set(CtxKeyAccess, access)
			return next(c)
		}
	}
}

// RequireSuperadmin — bypass total, pour les actions globales (gestion des
// tenants, des users à l'échelle système).
func RequireSuperadmin() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, _ := c.Get(CtxKeyClaims).(*jwt.Claims)
			if claims == nil || !claims.IsSuperadmin {
				return apperr.Forbidden("superadmin only")
			}
			return next(c)
		}
	}
}

// RequireTenantOwner — autorise owner OU superadmin. Pour les actions
// "tenant-wide" (gestion des users du tenant, des rôles).
func RequireTenantOwner() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, _ := c.Get(CtxKeyClaims).(*jwt.Claims)
			if claims == nil {
				return apperr.Unauthorized("")
			}
			if claims.IsSuperadmin || claims.Role == "owner" {
				return next(c)
			}
			return apperr.Forbidden("tenant owner only")
		}
	}
}

// --- Helpers SiteResolver --------------------------------------------------

// SiteFromParam — lit le paramètre :name de la route comme UUID de site.
// Usage : RequirePermission(..., SiteFromParam("id")) sur /v1/sites/:id/...
func SiteFromParam(name string) SiteResolver {
	return func(c echo.Context) (uuid.UUID, error) {
		id, err := uuid.Parse(c.Param(name))
		if err != nil {
			return uuid.Nil, apperr.Validation("invalid site id")
		}
		return id, nil
	}
}

// SiteFromDevice — résout le site via le device dans l'URL.
//
//	/v1/devices/:id  → SELECT z.site_id FROM devices d JOIN zones z ON ...
func SiteFromDevice(pool *pgxpool.Pool, paramName string) SiteResolver {
	return func(c echo.Context) (uuid.UUID, error) {
		devID, err := uuid.Parse(c.Param(paramName))
		if err != nil {
			return uuid.Nil, apperr.Validation("invalid device id")
		}
		var siteID uuid.UUID
		const q = `SELECT z.site_id FROM devices d JOIN zones z ON z.id = d.zone_id WHERE d.id = $1`
		if err := pool.QueryRow(c.Request().Context(), q, devID).Scan(&siteID); err != nil {
			return uuid.Nil, apperr.NotFound("device")
		}
		return siteID, nil
	}
}

// SiteFromRule — résout le site via la colonne rules.site_id.
func SiteFromRule(pool *pgxpool.Pool, paramName string) SiteResolver {
	return func(c echo.Context) (uuid.UUID, error) {
		ruleID, err := uuid.Parse(c.Param(paramName))
		if err != nil {
			return uuid.Nil, apperr.Validation("invalid rule id")
		}
		var siteID uuid.UUID
		if err := pool.QueryRow(c.Request().Context(),
			`SELECT site_id FROM rules WHERE id = $1`, ruleID).Scan(&siteID); err != nil {
			return uuid.Nil, apperr.NotFound("rule")
		}
		return siteID, nil
	}
}

// SiteFromDashboard — résout le site via le dashboard.
func SiteFromDashboard(pool *pgxpool.Pool, paramName string) SiteResolver {
	return func(c echo.Context) (uuid.UUID, error) {
		id, err := uuid.Parse(c.Param(paramName))
		if err != nil {
			return uuid.Nil, apperr.Validation("invalid dashboard id")
		}
		var siteID uuid.UUID
		if err := pool.QueryRow(c.Request().Context(),
			`SELECT site_id FROM dashboards WHERE id = $1`, id).Scan(&siteID); err != nil {
			return uuid.Nil, apperr.NotFound("dashboard")
		}
		return siteID, nil
	}
}

// SiteFromAlarm — résout le site via la colonne alarms.site_id.
func SiteFromAlarm(pool *pgxpool.Pool, paramName string) SiteResolver {
	return func(c echo.Context) (uuid.UUID, error) {
		id, err := uuid.Parse(c.Param(paramName))
		if err != nil {
			return uuid.Nil, apperr.Validation("invalid alarm id")
		}
		var siteID uuid.UUID
		if err := pool.QueryRow(c.Request().Context(),
			`SELECT site_id FROM alarms WHERE id = $1`, id).Scan(&siteID); err != nil {
			return uuid.Nil, apperr.NotFound("alarm")
		}
		return siteID, nil
	}
}

// SiteFromZone — résout le site via la colonne zones.site_id.
func SiteFromZone(pool *pgxpool.Pool, paramName string) SiteResolver {
	return func(c echo.Context) (uuid.UUID, error) {
		id, err := uuid.Parse(c.Param(paramName))
		if err != nil {
			return uuid.Nil, apperr.Validation("invalid zone id")
		}
		var siteID uuid.UUID
		if err := pool.QueryRow(c.Request().Context(),
			`SELECT site_id FROM zones WHERE id = $1`, id).Scan(&siteID); err != nil {
			return uuid.Nil, apperr.NotFound("zone")
		}
		return siteID, nil
	}
}

// SiteFromWidget — résout le site via le widget → dashboard → site_id.
func SiteFromWidget(pool *pgxpool.Pool, paramName string) SiteResolver {
	return func(c echo.Context) (uuid.UUID, error) {
		id, err := uuid.Parse(c.Param(paramName))
		if err != nil {
			return uuid.Nil, apperr.Validation("invalid widget id")
		}
		var siteID uuid.UUID
		const q = `
			SELECT d.site_id FROM dashboard_widgets w
			JOIN dashboards d ON d.id = w.dashboard_id WHERE w.id = $1
		`
		if err := pool.QueryRow(c.Request().Context(), q, id).Scan(&siteID); err != nil {
			return uuid.Nil, apperr.NotFound("widget")
		}
		return siteID, nil
	}
}
