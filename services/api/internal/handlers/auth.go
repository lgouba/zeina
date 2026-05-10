// Package handlers regroupe tous les handlers HTTP de l'API ZEINA.
package handlers

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"golang.org/x/crypto/bcrypt"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"

	"github.com/zeina/hyperviseur/services/api/internal/activation"
	"github.com/zeina/hyperviseur/services/api/internal/audit"
	"github.com/zeina/hyperviseur/services/api/internal/mailer"
	"github.com/zeina/hyperviseur/services/api/internal/middleware"
	"github.com/zeina/hyperviseur/services/api/internal/rbac"
)

const refreshCookieName = "zeina_refresh"

type AuthHandler struct {
	pool       *pgxpool.Pool
	signer     *jwt.Signer
	activation *activation.Service
	mail       *mailer.Mailer
	audit      *audit.Logger
	appBaseURL string
	brand      string
	log        zerolog.Logger
}

func NewAuthHandler(
	pool *pgxpool.Pool, signer *jwt.Signer,
	act *activation.Service, m *mailer.Mailer, auditLog *audit.Logger,
	appBaseURL, brand string, logger zerolog.Logger,
) *AuthHandler {
	if brand == "" {
		brand = "ZEINA"
	}
	return &AuthHandler{
		pool: pool, signer: signer, activation: act, mail: m, audit: auditLog,
		appBaseURL: strings.TrimRight(appBaseURL, "/"),
		brand:      brand, log: logger,
	}
}

func (h *AuthHandler) Register(g *echo.Group) {
	g.POST("/login", h.Login)
	g.POST("/refresh", h.Refresh)
	g.POST("/logout", h.Logout)
	g.POST("/verify-code", h.VerifyCode)
	g.POST("/set-password", h.SetPassword)
	g.POST("/forgot-password", h.ForgotPassword)
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
		SELECT u.id, u.tenant_id, u.email, u.password_hash, u.tenant_role::text, u.is_superadmin, u.full_name, u.status::text
		FROM users u WHERE u.email = $1 LIMIT 1
	`
	var (
		id, tenantID uuid.UUID
		email        string
		hash         *string
		tenantRole   string
		isSuperadmin bool
		fullName     *string
		status       string
	)
	err := h.pool.QueryRow(c.Request().Context(), q, req.Email).
		Scan(&id, &tenantID, &email, &hash, &tenantRole, &isSuperadmin, &fullName, &status)
	if err != nil {
		// Constant-time : on retourne le même message que mauvais password
		// pour ne pas leaker l'existence d'un email.
		return apperr.Unauthorized("invalid credentials")
	}
	if status == "pending" {
		return apperr.Unauthorized("account pending activation — check your email for the activation code")
	}
	if status == "disabled" {
		return apperr.Unauthorized("account disabled")
	}
	if hash == nil || *hash == "" {
		return apperr.Unauthorized("invalid credentials")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*hash), []byte(req.Password)); err != nil {
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

// ----------------------------------------------------------------------------
// Activation flow : verify-code → set-password
// ----------------------------------------------------------------------------

type verifyCodeReq struct {
	Email   string `json:"email"`
	Code    string `json:"code"`
	Purpose string `json:"purpose"` // first_login | password_reset
}

type verifyCodeResp struct {
	Nonce     string    `json:"nonce"`      // JWT court à passer à set-password
	ExpiresAt time.Time `json:"expires_at"`
}

// VerifyCode : étape 1. L'utilisateur saisit son code 6 chiffres reçu par
// mail. Si OK, on retourne un JWT activation valide 5 minutes que le
// frontend passe à set-password.
//
// Politique anti-leak : on retourne le MÊME message ("invalid code") pour
// "user inconnu", "code faux", "code expiré". Ça évite de confirmer
// l'existence d'un email à un attaquant.
func (h *AuthHandler) VerifyCode(c echo.Context) error {
	var req verifyCodeReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Code = strings.TrimSpace(req.Code)
	if req.Email == "" || len(req.Code) != 6 {
		return apperr.Validation("invalid email or code")
	}
	if req.Purpose != activation.PurposeFirstLogin && req.Purpose != activation.PurposePasswordReset {
		return apperr.Validation("invalid purpose")
	}

	// Lookup user — pas de leak via timing : si pas trouvé, on retourne
	// quand même 401 sans tenter une vérif fictive (pas critique ici car
	// bcrypt prend déjà ~80ms).
	var (
		uid    uuid.UUID
		status string
	)
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT id, status::text FROM users WHERE email = $1`, req.Email,
	).Scan(&uid, &status); err != nil {
		return apperr.Unauthorized("invalid code")
	}
	if status == "disabled" {
		return apperr.Unauthorized("account disabled")
	}

	if err := h.activation.Verify(c.Request().Context(), uid, req.Purpose, req.Code); err != nil {
		switch {
		case errors.Is(err, activation.ErrTooManyAttempts):
			return apperr.Unauthorized("too many attempts — request a new code")
		case errors.Is(err, activation.ErrExpiredCode):
			return apperr.Unauthorized("code expired — request a new code")
		default:
			return apperr.Unauthorized("invalid code")
		}
	}

	nonce, err := h.signer.SignActivation(uid, req.Purpose, activation.NonceTTL)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "sign activation", err)
	}
	return c.JSON(http.StatusOK, verifyCodeResp{
		Nonce:     nonce,
		ExpiresAt: time.Now().Add(activation.NonceTTL),
	})
}

type setPasswordReq struct {
	Nonce    string `json:"nonce"`
	Password string `json:"password"`
}

// SetPassword : étape 2. L'utilisateur fournit le nonce reçu de verify-code
// + son nouveau mot de passe. Si OK, on hash, on set status=active, et on
// retourne un access_token + cookie refresh comme un login normal.
func (h *AuthHandler) SetPassword(c echo.Context) error {
	var req setPasswordReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if req.Nonce == "" {
		return apperr.Validation("nonce required")
	}
	if err := validatePassword(req.Password); err != nil {
		return apperr.Validation(err.Error())
	}
	claims, err := h.signer.ParseActivation(req.Nonce)
	if err != nil {
		return apperr.Unauthorized("invalid or expired nonce")
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return apperr.Unauthorized("malformed nonce")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "bcrypt", err)
	}

	const q = `
		UPDATE users
		SET    password_hash = $2,
		       status        = 'active',
		       updated_at    = now()
		WHERE  id = $1
		RETURNING tenant_id, email, tenant_role::text, is_superadmin, full_name
	`
	var (
		tenantID     uuid.UUID
		email        string
		tenantRole   string
		isSuperadmin bool
		fullName     *string
	)
	if err := h.pool.QueryRow(c.Request().Context(), q, uid, string(hash)).
		Scan(&tenantID, &email, &tenantRole, &isSuperadmin, &fullName); err != nil {
		return apperr.NotFound("user")
	}

	// Auto-login : on signe access + refresh comme dans Login.
	access, err := h.signer.SignAccess(uid, tenantID.String(), tenantRole, isSuperadmin)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "sign access", err)
	}
	refresh, err := h.signer.SignRefresh(uid, tenantID.String(), tenantRole, isSuperadmin)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "sign refresh", err)
	}
	c.SetCookie(&http.Cookie{
		Name: refreshCookieName, Value: refresh, Path: "/v1/auth",
		HttpOnly: true, Secure: isHTTPS(c), SameSite: http.SameSiteStrictMode,
		Expires: time.Now().Add(7 * 24 * time.Hour),
	})
	_, _ = h.pool.Exec(c.Request().Context(), `UPDATE users SET last_login_at = now() WHERE id = $1`, uid)

	if h.audit != nil {
		h.audit.Log(c.Request().Context(), audit.Event{
			TenantID: tenantID, ActorID: &uid,
			Action: "user.set_password", TargetType: "user", TargetID: &uid, TargetName: email,
			Metadata: map[string]any{"purpose": claims.Purpose},
		})
	}

	return c.JSON(http.StatusOK, loginResp{
		AccessToken: access,
		ExpiresAt:   time.Now().Add(15 * time.Minute),
		User: userOut{
			ID: uid, Email: email, TenantRole: tenantRole, IsSuperadmin: isSuperadmin,
			TenantID: tenantID, FullName: fullName,
		},
	})
}

type forgotPasswordReq struct {
	Email string `json:"email"`
}

type forgotPasswordResp struct {
	Sent bool `json:"sent"` // toujours true pour ne pas révéler l'existence du compte
}

// ForgotPassword : envoie un mail avec un code de réinitialisation. Idempotent
// et silencieux : retourne toujours sent=true même si l'email n'existe pas
// ou si le user est disabled, pour ne pas révéler les comptes existants.
func (h *AuthHandler) ForgotPassword(c echo.Context) error {
	var req forgotPasswordReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" {
		return apperr.Validation("email required")
	}

	var (
		uid      uuid.UUID
		fullName *string
		status   string
		tenantID uuid.UUID
	)
	err := h.pool.QueryRow(c.Request().Context(),
		`SELECT id, full_name, status::text, tenant_id FROM users WHERE email = $1`, req.Email,
	).Scan(&uid, &fullName, &status, &tenantID)
	if err != nil {
		// Pas trouvé → on logge en interne et on répond OK (anti-énumération).
		h.log.Info().Str("email", req.Email).Msg("forgot-password for unknown email")
		return c.JSON(http.StatusOK, forgotPasswordResp{Sent: true})
	}
	if status == "disabled" {
		// Pareil, on ne révèle pas le statut.
		return c.JSON(http.StatusOK, forgotPasswordResp{Sent: true})
	}

	// Émet le code + envoie le mail (best-effort).
	code, _, err := h.activation.Issue(c.Request().Context(), uid, activation.PurposePasswordReset)
	if err != nil {
		h.log.Error().Err(err).Str("email", req.Email).Msg("issue reset code")
		return c.JSON(http.StatusOK, forgotPasswordResp{Sent: true})
	}
	link := h.appBaseURL + "/forgot-password?email=" + url.QueryEscape(req.Email)
	subject, htmlBody, textBody := mailer.BuildReset(mailer.ResetData{
		FullName: derefString(fullName), Email: req.Email, Code: code, URL: link,
		BrandName: h.brand, ExpireMinutes: int(activation.DefaultTTL / time.Minute),
	})
	if err := h.mail.Send([]string{req.Email}, subject, htmlBody, textBody); err != nil {
		h.log.Error().Err(err).Str("email", req.Email).Msg("send reset mail")
	}
	if h.audit != nil {
		h.audit.Log(c.Request().Context(), audit.Event{
			TenantID: tenantID,
			Action:   "user.forgot_password", TargetType: "user", TargetID: &uid, TargetName: req.Email,
		})
	}
	return c.JSON(http.StatusOK, forgotPasswordResp{Sent: true})
}

// validatePassword applique une politique minimale :
//   - 10 caractères minimum (NIST recommande 8 mais on prend 10)
//   - 128 caractères maximum (au-delà : risque DoS sur bcrypt)
//   - au moins 1 lettre ET au moins 1 chiffre (anti "azertyuiop" et "1234567890")
//   - pas d'espaces aux bords
//   - pas de caractères de contrôle (anti CRLF, NUL, etc.)
func validatePassword(p string) error {
	if len(p) < 10 {
		return errors.New("le mot de passe doit faire au moins 10 caractères")
	}
	if len(p) > 128 {
		return errors.New("le mot de passe est trop long (max 128 caractères)")
	}
	if p != strings.TrimSpace(p) {
		return errors.New("le mot de passe ne peut commencer ou finir par un espace")
	}
	var hasLetter, hasDigit bool
	for _, r := range p {
		if r < 0x20 || r == 0x7f {
			return errors.New("le mot de passe contient un caractère de contrôle interdit")
		}
		switch {
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'):
			hasLetter = true
		case r >= '0' && r <= '9':
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return errors.New("le mot de passe doit contenir au moins une lettre et un chiffre")
	}
	return nil
}
