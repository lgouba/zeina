package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"golang.org/x/crypto/bcrypt"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"
	"github.com/zeina/hyperviseur/services/api/internal/activation"
	"github.com/zeina/hyperviseur/services/api/internal/audit"
	"github.com/zeina/hyperviseur/services/api/internal/mailer"
	mw "github.com/zeina/hyperviseur/services/api/internal/middleware"
)

// UsersHandler — gestion des utilisateurs du tenant courant.
//
// Toutes les routes sont restreintes via mw.RequireTenantOwner :
//   - le superadmin peut tout faire
//   - les owners peuvent gérer les users de leur propre tenant
//   - les autres reçoivent 403
//
// On ne permet PAS à un owner de créer un autre superadmin (seul un
// superadmin peut promouvoir).
type UsersHandler struct {
	pool       *pgxpool.Pool
	audit      *audit.Logger
	mail       *mailer.Mailer
	activation *activation.Service
	appBaseURL string // ex: https://zeina.qalitylabs.fr — utilisé pour les liens dans les mails
	brand      string // ex: ZEINA
	log        zerolog.Logger
}

func NewUsersHandler(
	pool *pgxpool.Pool, log *audit.Logger, m *mailer.Mailer, act *activation.Service,
	appBaseURL, brand string, logger zerolog.Logger,
) *UsersHandler {
	if brand == "" {
		brand = "ZEINA"
	}
	return &UsersHandler{
		pool: pool, audit: log, mail: m, activation: act,
		appBaseURL: strings.TrimRight(appBaseURL, "/"),
		brand:      brand, log: logger,
	}
}

func (h *UsersHandler) Register(g *echo.Group) {
	g.GET("/users", h.List)
	g.POST("/users", h.Create)
	g.PUT("/users/:id", h.Update)
	g.DELETE("/users/:id", h.Delete)
	g.POST("/users/:id/reset-password", h.ResetPassword)
	g.POST("/users/:id/resend-activation", h.ResendActivation)
}

type userListOut struct {
	ID           uuid.UUID  `json:"id"`
	Email        string     `json:"email"`
	FullName     *string    `json:"full_name,omitempty"`
	TenantRole   string     `json:"tenant_role"`
	IsSuperadmin bool       `json:"is_superadmin"`
	Status       string     `json:"status"` // pending | active | disabled
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

func (h *UsersHandler) List(c echo.Context) error {
	caller := callerClaims(c)
	if caller == nil {
		return apperr.Unauthorized("")
	}
	tid, _ := uuid.Parse(caller.TenantID)

	var (
		rows pgx.Rows
		err  error
	)
	if caller.IsSuperadmin && c.QueryParam("all") == "1" {
		rows, err = h.pool.Query(c.Request().Context(),
			`SELECT id, email, full_name, tenant_role::text, is_superadmin, status::text, last_login_at, created_at
			 FROM users ORDER BY created_at DESC`)
	} else {
		rows, err = h.pool.Query(c.Request().Context(),
			`SELECT id, email, full_name, tenant_role::text, is_superadmin, status::text, last_login_at, created_at
			 FROM users WHERE tenant_id = $1 ORDER BY created_at DESC`, tid)
	}
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list users", err)
	}
	defer rows.Close()

	out := []userListOut{}
	for rows.Next() {
		var u userListOut
		var lastLogin *time.Time
		if err := rows.Scan(&u.ID, &u.Email, &u.FullName, &u.TenantRole, &u.IsSuperadmin, &u.Status, &lastLogin, &u.CreatedAt); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan user", err)
		}
		u.LastLoginAt = lastLogin
		out = append(out, u)
	}
	return c.JSON(http.StatusOK, out)
}

type createUserReq struct {
	Email    string  `json:"email"`
	FullName *string `json:"full_name,omitempty"`
	// TenantRole : owner | member (défaut member). Owner ⇒ accès implicite à tous les sites.
	TenantRole   string `json:"tenant_role,omitempty"`
	IsSuperadmin bool   `json:"is_superadmin,omitempty"` // ignoré si caller n'est pas superadmin

	// Password (optionnel, legacy) : si fourni, le user est créé directement
	// "active" sans mail d'activation. Utilisé par les scripts d'admin.
	// Le flux normal côté UI laisse Password vide → mail envoyé.
	Password string `json:"password,omitempty"`
}

type createUserResp struct {
	User              userListOut `json:"user"`
	ActivationSent    bool        `json:"activation_sent,omitempty"`
	TemporaryPassword *string     `json:"temporary_password,omitempty"` // legacy : seulement si Password fourni
}

func (h *UsersHandler) Create(c echo.Context) error {
	caller := callerClaims(c)
	if caller == nil {
		return apperr.Unauthorized("")
	}
	var req createUserReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if !validEmail(req.Email) {
		return apperr.Validation("invalid email")
	}
	if req.TenantRole == "" {
		req.TenantRole = "member"
	}
	if req.TenantRole != "owner" && req.TenantRole != "member" {
		return apperr.Validation("tenant_role must be owner or member")
	}
	if req.IsSuperadmin && !caller.IsSuperadmin {
		return apperr.Forbidden("only superadmin can create another superadmin")
	}

	tid, _ := uuid.Parse(caller.TenantID)
	ctx := c.Request().Context()

	// Mode legacy : password fourni → user actif tout de suite, pas de mail.
	if req.Password != "" {
		return h.createWithPassword(c, tid, req)
	}

	// Mode normal : status=pending, password_hash=NULL, mail d'activation.
	const q = `
		INSERT INTO users (tenant_id, email, full_name, tenant_role, is_superadmin, status)
		VALUES ($1, $2, $3, $4::tenant_role, $5, 'pending')
		RETURNING id, email, full_name, tenant_role::text, is_superadmin, status::text, last_login_at, created_at
	`
	var u userListOut
	var lastLogin *time.Time
	err := h.pool.QueryRow(ctx, q,
		tid, req.Email, req.FullName, req.TenantRole, req.IsSuperadmin,
	).Scan(&u.ID, &u.Email, &u.FullName, &u.TenantRole, &u.IsSuperadmin, &u.Status, &lastLogin, &u.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return apperr.Validation("email already used")
		}
		return apperr.Wrap(apperr.KindInternal, "insert user", err)
	}
	u.LastLoginAt = lastLogin

	// Émet le code + envoie le mail (best-effort : si le mail échoue, on
	// retourne quand même 201 et le user pourra utiliser "Renvoyer le code").
	sent := h.sendActivationEmail(ctx, u.ID, u.Email, u.FullName, activation.PurposeFirstLogin)

	callerUID, _ := uuid.Parse(caller.Subject)
	h.audit.Log(ctx, audit.Event{
		TenantID: tid, ActorID: &callerUID,
		Action: "user.create", TargetType: "user", TargetID: &u.ID, TargetName: u.Email,
		Metadata: map[string]any{
			"tenant_role": u.TenantRole, "is_superadmin": u.IsSuperadmin,
			"activation_email_sent": sent,
		},
	})
	return c.JSON(http.StatusCreated, createUserResp{User: u, ActivationSent: sent})
}

// createWithPassword — branche legacy : password fourni, user créé actif.
func (h *UsersHandler) createWithPassword(c echo.Context, tid uuid.UUID, req createUserReq) error {
	pwd := req.Password
	hash, err := bcrypt.GenerateFromPassword([]byte(pwd), bcrypt.DefaultCost)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "bcrypt", err)
	}
	const q = `
		INSERT INTO users (tenant_id, email, password_hash, full_name, tenant_role, is_superadmin, status)
		VALUES ($1, $2, $3, $4, $5::tenant_role, $6, 'active')
		RETURNING id, email, full_name, tenant_role::text, is_superadmin, status::text, last_login_at, created_at
	`
	var u userListOut
	var lastLogin *time.Time
	err = h.pool.QueryRow(c.Request().Context(), q,
		tid, req.Email, string(hash), req.FullName, req.TenantRole, req.IsSuperadmin,
	).Scan(&u.ID, &u.Email, &u.FullName, &u.TenantRole, &u.IsSuperadmin, &u.Status, &lastLogin, &u.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return apperr.Validation("email already used")
		}
		return apperr.Wrap(apperr.KindInternal, "insert user", err)
	}
	u.LastLoginAt = lastLogin

	caller := callerClaims(c)
	callerUID, _ := uuid.Parse(caller.Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &callerUID,
		Action: "user.create", TargetType: "user", TargetID: &u.ID, TargetName: u.Email,
		Metadata: map[string]any{"tenant_role": u.TenantRole, "is_superadmin": u.IsSuperadmin, "legacy_password": true},
	})
	return c.JSON(http.StatusCreated, createUserResp{User: u})
}

// sendActivationEmail issue un nouveau code et envoie le mail. Best-effort :
// retourne true si tout a fonctionné, false sinon (le user pourra utiliser
// "Renvoyer le code"). Pas d'erreur retournée pour ne pas faire planter le
// flow principal.
func (h *UsersHandler) sendActivationEmail(ctx context.Context, userID uuid.UUID, email string, fullName *string, purpose string) bool {
	code, _, err := h.activation.Issue(ctx, userID, purpose)
	if err != nil {
		h.log.Error().Err(err).Str("email", email).Str("purpose", purpose).Msg("issue activation code")
		return false
	}

	link := h.buildActivationLink(email, purpose)
	var subject, htmlBody, textBody string
	switch purpose {
	case activation.PurposePasswordReset:
		subject, htmlBody, textBody = mailer.BuildReset(mailer.ResetData{
			FullName: derefString(fullName), Email: email, Code: code, URL: link,
			BrandName: h.brand, ExpireMinutes: int(activation.DefaultTTL / time.Minute),
		})
	default: // first_login
		subject, htmlBody, textBody = mailer.BuildWelcome(mailer.WelcomeData{
			FullName: derefString(fullName), Email: email, Code: code, URL: link,
			BrandName: h.brand, ExpireMinutes: int(activation.DefaultTTL / time.Minute),
		})
	}
	if err := h.mail.Send([]string{email}, subject, htmlBody, textBody); err != nil {
		h.log.Error().Err(err).Str("email", email).Str("purpose", purpose).Msg("send activation mail")
		return false
	}
	return true
}

// buildActivationLink — URL où l'utilisateur clique depuis son mail.
func (h *UsersHandler) buildActivationLink(email, purpose string) string {
	if h.appBaseURL == "" {
		return ""
	}
	path := "/first-login"
	if purpose == activation.PurposePasswordReset {
		path = "/forgot-password"
	}
	return h.appBaseURL + path + "?email=" + url.QueryEscape(email)
}

// ---------------------------------------------------------------------------
// Resend activation — admin appuie sur "Renvoyer le code" depuis la liste.
// Marche pour les users en 'pending' uniquement (pour 'active' ya
// reset-password qui envoie un mail de réinit).
// ---------------------------------------------------------------------------

type resendActivationResp struct {
	Sent bool `json:"sent"`
}

func (h *UsersHandler) ResendActivation(c echo.Context) error {
	caller := callerClaims(c)
	if caller == nil {
		return apperr.Unauthorized("")
	}
	uid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid user id")
	}

	var (
		email    string
		fullName *string
		status   string
		tid      uuid.UUID
	)
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT email, full_name, status::text, tenant_id FROM users WHERE id = $1`, uid,
	).Scan(&email, &fullName, &status, &tid); err != nil {
		return apperr.NotFound("user")
	}
	if !caller.IsSuperadmin {
		callerTID, _ := uuid.Parse(caller.TenantID)
		if tid != callerTID {
			return apperr.Forbidden("cross-tenant resend")
		}
	}
	if status != "pending" {
		return apperr.Validation("user is not pending — use reset-password instead")
	}
	sent := h.sendActivationEmail(c.Request().Context(), uid, email, fullName, activation.PurposeFirstLogin)

	callerUID, _ := uuid.Parse(caller.Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &callerUID,
		Action: "user.resend_activation", TargetType: "user", TargetID: &uid, TargetName: email,
		Metadata: map[string]any{"sent": sent},
	})
	return c.JSON(http.StatusOK, resendActivationResp{Sent: sent})
}

type updateUserReq struct {
	FullName     *string `json:"full_name,omitempty"`
	TenantRole   *string `json:"tenant_role,omitempty"`
	IsSuperadmin *bool   `json:"is_superadmin,omitempty"`
	Status       *string `json:"status,omitempty"` // pending | active | disabled
}

func (h *UsersHandler) Update(c echo.Context) error {
	caller := callerClaims(c)
	uid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid user id")
	}
	var req updateUserReq
	if err := c.Bind(&req); err != nil {
		return apperr.Validation("invalid body")
	}
	if req.IsSuperadmin != nil && !caller.IsSuperadmin {
		return apperr.Forbidden("only superadmin can change superadmin flag")
	}
	if req.TenantRole != nil && *req.TenantRole != "owner" && *req.TenantRole != "member" {
		return apperr.Validation("tenant_role must be owner or member")
	}
	if req.Status != nil {
		switch *req.Status {
		case "pending", "active", "disabled":
		default:
			return apperr.Validation("status must be pending, active or disabled")
		}
	}

	var targetTID uuid.UUID
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT tenant_id FROM users WHERE id = $1`, uid).Scan(&targetTID); err != nil {
		return apperr.NotFound("user")
	}
	if !caller.IsSuperadmin {
		callerTID, _ := uuid.Parse(caller.TenantID)
		if targetTID != callerTID {
			return apperr.Forbidden("cross-tenant update")
		}
	}

	const q = `
		UPDATE users SET
			full_name     = COALESCE($2, full_name),
			tenant_role   = COALESCE($3::tenant_role, tenant_role),
			is_superadmin = COALESCE($4, is_superadmin),
			status        = COALESCE($5::user_status, status),
			updated_at    = now()
		WHERE id = $1
		RETURNING id, email, full_name, tenant_role::text, is_superadmin, status::text, last_login_at, created_at
	`
	var u userListOut
	var lastLogin *time.Time
	if err := h.pool.QueryRow(c.Request().Context(), q,
		uid, req.FullName, req.TenantRole, req.IsSuperadmin, req.Status,
	).Scan(&u.ID, &u.Email, &u.FullName, &u.TenantRole, &u.IsSuperadmin, &u.Status, &lastLogin, &u.CreatedAt); err != nil {
		return apperr.Wrap(apperr.KindInternal, "update user", err)
	}
	u.LastLoginAt = lastLogin

	callerUID, _ := uuid.Parse(caller.Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: targetTID, ActorID: &callerUID,
		Action: "user.update", TargetType: "user", TargetID: &u.ID, TargetName: u.Email,
		Metadata: map[string]any{"tenant_role": u.TenantRole, "is_superadmin": u.IsSuperadmin, "status": u.Status},
	})
	return c.JSON(http.StatusOK, u)
}

func (h *UsersHandler) Delete(c echo.Context) error {
	caller := callerClaims(c)
	uid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid user id")
	}
	callerUID, _ := uuid.Parse(caller.Subject)
	if uid == callerUID {
		return apperr.Validation("cannot delete yourself")
	}

	var targetTID uuid.UUID
	var isSuper bool
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT tenant_id, is_superadmin FROM users WHERE id = $1`, uid).Scan(&targetTID, &isSuper); err != nil {
		return apperr.NotFound("user")
	}
	if !caller.IsSuperadmin {
		callerTID, _ := uuid.Parse(caller.TenantID)
		if targetTID != callerTID {
			return apperr.Forbidden("cross-tenant delete")
		}
		if isSuper {
			return apperr.Forbidden("only superadmin can delete a superadmin")
		}
	}

	var email string
	_ = h.pool.QueryRow(c.Request().Context(), `SELECT email FROM users WHERE id = $1`, uid).Scan(&email)

	if _, err := h.pool.Exec(c.Request().Context(), `DELETE FROM users WHERE id = $1`, uid); err != nil {
		return apperr.Wrap(apperr.KindInternal, "delete user", err)
	}

	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: targetTID, ActorID: &callerUID,
		Action: "user.delete", TargetType: "user", TargetID: &uid, TargetName: email,
	})
	return c.NoContent(http.StatusNoContent)
}

type resetPasswordReq struct {
	// Si Password fourni → applique direct (legacy / scripts admin).
	// Sinon → envoie un mail avec un code de réinitialisation.
	Password string `json:"password,omitempty"`
}

type resetPasswordResp struct {
	TemporaryPassword *string `json:"temporary_password,omitempty"`
	EmailSent         bool    `json:"email_sent,omitempty"`
}

func (h *UsersHandler) ResetPassword(c echo.Context) error {
	caller := callerClaims(c)
	uid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid user id")
	}
	var req resetPasswordReq
	_ = c.Bind(&req)

	var (
		targetTID uuid.UUID
		email     string
		fullName  *string
	)
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT tenant_id, email, full_name FROM users WHERE id = $1`, uid,
	).Scan(&targetTID, &email, &fullName); err != nil {
		return apperr.NotFound("user")
	}
	if !caller.IsSuperadmin {
		callerTID, _ := uuid.Parse(caller.TenantID)
		if targetTID != callerTID {
			return apperr.Forbidden("cross-tenant reset")
		}
	}

	callerUID, _ := uuid.Parse(caller.Subject)

	// Mode legacy : password fourni → applique direct.
	if req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "bcrypt", err)
		}
		if _, err := h.pool.Exec(c.Request().Context(),
			`UPDATE users SET password_hash = $2, status = 'active', updated_at = now() WHERE id = $1`,
			uid, string(hash)); err != nil {
			return apperr.Wrap(apperr.KindInternal, "update password", err)
		}
		h.audit.Log(c.Request().Context(), audit.Event{
			TenantID: targetTID, ActorID: &callerUID,
			Action: "user.reset_password", TargetType: "user", TargetID: &uid, TargetName: email,
			Metadata: map[string]any{"mode": "direct"},
		})
		return c.JSON(http.StatusOK, resetPasswordResp{})
	}

	// Mode normal : envoie un mail avec un code de réinitialisation.
	sent := h.sendActivationEmail(c.Request().Context(), uid, email, fullName, activation.PurposePasswordReset)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: targetTID, ActorID: &callerUID,
		Action: "user.reset_password", TargetType: "user", TargetID: &uid, TargetName: email,
		Metadata: map[string]any{"mode": "email", "sent": sent},
	})
	return c.JSON(http.StatusOK, resetPasswordResp{EmailSent: sent})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func callerClaims(c echo.Context) *jwt.Claims {
	claims, _ := c.Get(mw.CtxKeyClaims).(*jwt.Claims)
	return claims
}

func validEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	if at <= 0 || at == len(s)-1 {
		return false
	}
	dot := strings.LastIndexByte(s[at:], '.')
	return dot > 0
}

// genTempPassword n'est plus utilisé par le flow normal, mais on le garde
// pour la compat (peut servir à un script de seed).
func genTempPassword() string { //nolint:unused
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
