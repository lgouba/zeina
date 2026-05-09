package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"
	"github.com/zeina/hyperviseur/services/api/internal/audit"
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
	pool  *pgxpool.Pool
	audit *audit.Logger
}

func NewUsersHandler(pool *pgxpool.Pool, log *audit.Logger) *UsersHandler {
	return &UsersHandler{pool: pool, audit: log}
}

func (h *UsersHandler) Register(g *echo.Group) {
	g.GET("/users", h.List)
	g.POST("/users", h.Create)
	g.PUT("/users/:id", h.Update)
	g.DELETE("/users/:id", h.Delete)
	g.POST("/users/:id/reset-password", h.ResetPassword)
}

type userListOut struct {
	ID           uuid.UUID  `json:"id"`
	Email        string     `json:"email"`
	FullName     *string    `json:"full_name,omitempty"`
	TenantRole   string     `json:"tenant_role"`
	IsSuperadmin bool       `json:"is_superadmin"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

func (h *UsersHandler) List(c echo.Context) error {
	caller := callerClaims(c)
	if caller == nil {
		return apperr.Unauthorized("")
	}
	tid, _ := uuid.Parse(caller.TenantID)

	// Le superadmin voit tous les users (toutes tenants confondus) si
	// ?all=1, sinon uniquement son tenant comme un owner classique.
	var (
		rows pgx.Rows
		err  error
	)
	if caller.IsSuperadmin && c.QueryParam("all") == "1" {
		rows, err = h.pool.Query(c.Request().Context(),
			`SELECT id, email, full_name, tenant_role::text, is_superadmin, last_login_at, created_at
			 FROM users ORDER BY created_at DESC`)
	} else {
		rows, err = h.pool.Query(c.Request().Context(),
			`SELECT id, email, full_name, tenant_role::text, is_superadmin, last_login_at, created_at
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
		if err := rows.Scan(&u.ID, &u.Email, &u.FullName, &u.TenantRole, &u.IsSuperadmin, &lastLogin, &u.CreatedAt); err != nil {
			return apperr.Wrap(apperr.KindInternal, "scan user", err)
		}
		u.LastLoginAt = lastLogin
		out = append(out, u)
	}
	return c.JSON(http.StatusOK, out)
}

type createUserReq struct {
	Email        string  `json:"email"`
	Password     string  `json:"password"` // optionnel : si vide, on génère un mot de passe temporaire
	FullName     *string `json:"full_name,omitempty"`
	TenantRole   string  `json:"tenant_role,omitempty"`   // owner | member (défaut : member)
	IsSuperadmin bool    `json:"is_superadmin,omitempty"` // ignoré si caller n'est pas superadmin
}

type createUserResp struct {
	User              userListOut `json:"user"`
	TemporaryPassword *string     `json:"temporary_password,omitempty"`
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
	// Seul un superadmin peut promouvoir un autre superadmin.
	if req.IsSuperadmin && !caller.IsSuperadmin {
		return apperr.Forbidden("only superadmin can create another superadmin")
	}

	var tempPwd *string
	pwd := req.Password
	if pwd == "" {
		s := genTempPassword()
		pwd = s
		tempPwd = &s
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pwd), bcrypt.DefaultCost)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "bcrypt", err)
	}

	tid, _ := uuid.Parse(caller.TenantID)

	const q = `
		INSERT INTO users (tenant_id, email, password_hash, full_name, tenant_role, is_superadmin)
		VALUES ($1, $2, $3, $4, $5::tenant_role, $6)
		RETURNING id, email, full_name, tenant_role::text, is_superadmin, last_login_at, created_at
	`
	var u userListOut
	var lastLogin *time.Time
	err = h.pool.QueryRow(c.Request().Context(), q,
		tid, req.Email, string(hash), req.FullName, req.TenantRole, req.IsSuperadmin,
	).Scan(&u.ID, &u.Email, &u.FullName, &u.TenantRole, &u.IsSuperadmin, &lastLogin, &u.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return apperr.Validation("email already used")
		}
		return apperr.Wrap(apperr.KindInternal, "insert user", err)
	}
	u.LastLoginAt = lastLogin

	callerUID, _ := uuid.Parse(caller.Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: tid, ActorID: &callerUID,
		Action: "user.create", TargetType: "user", TargetID: &u.ID, TargetName: u.Email,
		Metadata: map[string]any{"tenant_role": u.TenantRole, "is_superadmin": u.IsSuperadmin},
	})
	return c.JSON(http.StatusCreated, createUserResp{User: u, TemporaryPassword: tempPwd})
}

type updateUserReq struct {
	FullName     *string `json:"full_name,omitempty"`
	TenantRole   *string `json:"tenant_role,omitempty"`
	IsSuperadmin *bool   `json:"is_superadmin,omitempty"`
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

	// Charger le user cible pour vérifier l'isolation tenant
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
			updated_at    = now()
		WHERE id = $1
		RETURNING id, email, full_name, tenant_role::text, is_superadmin, last_login_at, created_at
	`
	var u userListOut
	var lastLogin *time.Time
	if err := h.pool.QueryRow(c.Request().Context(), q,
		uid, req.FullName, req.TenantRole, req.IsSuperadmin,
	).Scan(&u.ID, &u.Email, &u.FullName, &u.TenantRole, &u.IsSuperadmin, &lastLogin, &u.CreatedAt); err != nil {
		return apperr.Wrap(apperr.KindInternal, "update user", err)
	}
	u.LastLoginAt = lastLogin

	callerUID, _ := uuid.Parse(caller.Subject)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: targetTID, ActorID: &callerUID,
		Action: "user.update", TargetType: "user", TargetID: &u.ID, TargetName: u.Email,
		Metadata: map[string]any{"tenant_role": u.TenantRole, "is_superadmin": u.IsSuperadmin},
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

	// Récupère l'email pour l'audit avant suppression.
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
	Password string `json:"password,omitempty"` // optionnel : si vide, on génère
}

type resetPasswordResp struct {
	TemporaryPassword *string `json:"temporary_password,omitempty"`
}

func (h *UsersHandler) ResetPassword(c echo.Context) error {
	caller := callerClaims(c)
	uid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return apperr.Validation("invalid user id")
	}
	var req resetPasswordReq
	_ = c.Bind(&req)

	var targetTID uuid.UUID
	if err := h.pool.QueryRow(c.Request().Context(),
		`SELECT tenant_id FROM users WHERE id = $1`, uid).Scan(&targetTID); err != nil {
		return apperr.NotFound("user")
	}
	if !caller.IsSuperadmin {
		callerTID, _ := uuid.Parse(caller.TenantID)
		if targetTID != callerTID {
			return apperr.Forbidden("cross-tenant reset")
		}
	}

	pwd := req.Password
	var tempPwd *string
	if pwd == "" {
		s := genTempPassword()
		pwd = s
		tempPwd = &s
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pwd), bcrypt.DefaultCost)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "bcrypt", err)
	}
	if _, err := h.pool.Exec(c.Request().Context(),
		`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, uid, string(hash)); err != nil {
		return apperr.Wrap(apperr.KindInternal, "update password", err)
	}

	callerUID, _ := uuid.Parse(caller.Subject)
	var email string
	_ = h.pool.QueryRow(c.Request().Context(), `SELECT email FROM users WHERE id = $1`, uid).Scan(&email)
	h.audit.Log(c.Request().Context(), audit.Event{
		TenantID: targetTID, ActorID: &callerUID,
		Action: "user.reset_password", TargetType: "user", TargetID: &uid, TargetName: email,
		Metadata: map[string]any{"generated": tempPwd != nil},
	})
	return c.JSON(http.StatusOK, resetPasswordResp{TemporaryPassword: tempPwd})
}

// ---------------------------------------------------------------------------
// Helpers internes au package handlers
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

func genTempPassword() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
