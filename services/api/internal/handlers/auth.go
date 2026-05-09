// Package handlers regroupe tous les handlers HTTP de l'API ZEINA.
package handlers

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"

	"github.com/zeina/hyperviseur/services/api/internal/middleware"
	"github.com/zeina/hyperviseur/services/api/internal/rbac"
)

const refreshCookieName = "zeina_refresh"

type AuthHandler struct {
	pool   *pgxpool.Pool
	signer *jwt.Signer
}

func NewAuthHandler(pool *pgxpool.Pool, signer *jwt.Signer) *AuthHandler {
	return &AuthHandler{pool: pool, signer: signer}
}

func (h *AuthHandler) Register(g *echo.Group) {
	g.POST("/login", h.Login)
	g.POST("/refresh", h.Refresh)
	g.POST("/logout", h.Logout)
}

// RegisterMe enregistre /me sur un groupe authentifié (besoin du middleware
// RequireAuth en amont).
func (h *AuthHandler) RegisterMe(g *echo.Group) {
	g.GET("/me", h.Me)
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResp struct {
	AccessToken string    `json:"access_token"`
	ExpiresAt   time.Time `json:"expires_at"`
	User        userOut   `json:"user"`
}

type userOut struct {
	ID           uuid.UUID `json:"id"`
	Email        string    `json:"email"`
	TenantRole   string    `json:"tenant_role"`
	IsSuperadmin bool      `json:"is_superadmin"`
	TenantID     uuid.UUID `json:"tenant_id"`
	FullName     *string   `json:"full_name,omitempty"`
}

func (h *AuthHandler) Login(c echo.Context) error {
	var req loginReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if req.Email == "" || req.Password == "" {
		return apperr.Validation("email and password are required")
	}

	const q = `
		SELECT u.id, u.tenant_id, u.email, u.password_hash, u.tenant_role::text, u.is_superadmin, u.full_name
		FROM users u WHERE u.email = $1 LIMIT 1
	`
	var (
		id, tenantID uuid.UUID
		email, hash  string
		tenantRole   string
		isSuperadmin bool
		fullName     *string
	)
	err := h.pool.QueryRow(c.Request().Context(), q, req.Email).
		Scan(&id, &tenantID, &email, &hash, &tenantRole, &isSuperadmin, &fullName)
	if err != nil {
		// Constant-time : on retourne le même message que mauvais password
		// pour ne pas leaker l'existence d'un email.
		return apperr.Unauthorized("invalid credentials")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		return apperr.Unauthorized("invalid credentials")
	}

	access, err := h.signer.SignAccess(id, tenantID.String(), tenantRole, isSuperadmin)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "sign access", err)
	}
	refresh, err := h.signer.SignRefresh(id, tenantID.String(), tenantRole, isSuperadmin)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "sign refresh", err)
	}

	// Cookie httpOnly pour le refresh
	c.SetCookie(&http.Cookie{
		Name:     refreshCookieName,
		Value:    refresh,
		Path:     "/v1/auth",
		HttpOnly: true,
		Secure:   isHTTPS(c),
		SameSite: http.SameSiteStrictMode,
		Expires:  time.Now().Add(7 * 24 * time.Hour),
	})

	// Touch last_login_at (best effort)
	_, _ = h.pool.Exec(c.Request().Context(), `UPDATE users SET last_login_at = now() WHERE id = $1`, id)

	return c.JSON(http.StatusOK, loginResp{
		AccessToken: access,
		ExpiresAt:   time.Now().Add(15 * time.Minute),
		User: userOut{
			ID: id, Email: email, TenantRole: tenantRole, IsSuperadmin: isSuperadmin,
			TenantID: tenantID, FullName: fullName,
		},
	})
}

func (h *AuthHandler) Refresh(c echo.Context) error {
	cookie, err := c.Cookie(refreshCookieName)
	if err != nil || cookie.Value == "" {
		return apperr.Unauthorized("missing refresh cookie")
	}
	claims, err := h.signer.ParseRefresh(cookie.Value)
	if err != nil {
		return apperr.Unauthorized("invalid refresh token")
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return apperr.Unauthorized("malformed subject")
	}
	access, err := h.signer.SignAccess(uid, claims.TenantID, claims.Role, claims.IsSuperadmin)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "sign access", err)
	}
	return c.JSON(http.StatusOK, map[string]any{
		"access_token": access,
		"expires_at":   time.Now().Add(15 * time.Minute),
	})
}

func (h *AuthHandler) Logout(c echo.Context) error {
	c.SetCookie(&http.Cookie{
		Name: refreshCookieName, Value: "", Path: "/v1/auth",
		HttpOnly: true, Secure: isHTTPS(c), SameSite: http.SameSiteStrictMode,
		MaxAge: -1,
	})
	return c.NoContent(http.StatusNoContent)
}

// meResp — payload retourné par GET /v1/auth/me. Donne au frontend
// l'identité du user + ses permissions par site, pour gater la sidebar
// et désactiver les boutons d'édition.
type meResp struct {
	User  userOut         `json:"user"`
	Sites []siteAccessOut `json:"sites"`
}

type siteAccessOut struct {
	SiteID      uuid.UUID          `json:"site_id"`
	SiteSlug    string             `json:"site_slug"`
	SiteName    string             `json:"site_name"`
	RoleID      *uuid.UUID         `json:"role_id,omitempty"`
	RoleName    string             `json:"role_name"`
	Permissions rbac.PermissionSet `json:"permissions"`
}

// Me retourne l'identité courante + un snapshot des permissions par site.
//
// Pour un superadmin ou un owner : tous les sites du tenant avec write partout.
// Pour les autres : uniquement les sites où il est membre, avec les
// permissions du rôle attribué.
func (h *AuthHandler) Me(c echo.Context) error {
	claims, _ := c.Get(middleware.CtxKeyClaims).(*jwt.Claims)
	if claims == nil {
		return apperr.Unauthorized("")
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return apperr.Unauthorized("malformed subject")
	}

	// Lire le user complet
	const userQ = `SELECT id, email, tenant_id, tenant_role::text, is_superadmin, full_name FROM users WHERE id = $1`
	var u userOut
	if err := h.pool.QueryRow(c.Request().Context(), userQ, uid).
		Scan(&u.ID, &u.Email, &u.TenantID, &u.TenantRole, &u.IsSuperadmin, &u.FullName); err != nil {
		return apperr.Unauthorized("user not found")
	}

	out := meResp{User: u, Sites: []siteAccessOut{}}

	// Cas superadmin OU owner du tenant : full access à tous les sites.
	if u.IsSuperadmin || u.TenantRole == "owner" {
		const q = `SELECT id, slug, name FROM sites WHERE tenant_id = $1 ORDER BY name`
		rows, err := h.pool.Query(c.Request().Context(), q, u.TenantID)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "list sites", err)
		}
		defer rows.Close()
		for rows.Next() {
			var s siteAccessOut
			if err := rows.Scan(&s.SiteID, &s.SiteSlug, &s.SiteName); err != nil {
				return apperr.Wrap(apperr.KindInternal, "scan site", err)
			}
			s.RoleName = roleNameForOwner(u.IsSuperadmin)
			s.Permissions = rbac.FullAccess()
			out.Sites = append(out.Sites, s)
		}
		return c.JSON(http.StatusOK, out)
	}

	// Membre simple : on lit ses memberships.
	const q = `
		SELECT s.id, s.slug, s.name, r.id, r.name, r.permissions
		FROM site_members sm
		JOIN sites s ON s.id = sm.site_id
		JOIN roles r ON r.id = sm.role_id
		WHERE sm.user_id = $1 AND s.tenant_id = $2
		ORDER BY s.name
	`
	rows, err := h.pool.Query(c.Request().Context(), q, u.ID, u.TenantID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list memberships", err)
	}
	defer rows.Close()
	for rows.Next() {
		var s siteAccessOut
		var roleID uuid.UUID
		var permsRaw []byte
		if err := rows.Scan(&s.SiteID, &s.SiteSlug, &s.SiteName, &roleID, &s.RoleName, &permsRaw); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan membership", err)
		}
		s.RoleID = &roleID
		s.Permissions = rbac.ParsePermissions(permsRaw)
		out.Sites = append(out.Sites, s)
	}
	return c.JSON(http.StatusOK, out)
}

func roleNameForOwner(isSuperadmin bool) string {
	if isSuperadmin {
		return "Superadmin"
	}
	return "Propriétaire"
}

func isHTTPS(c echo.Context) bool {
	return c.Request().TLS != nil || c.Request().Header.Get("X-Forwarded-Proto") == "https"
}
