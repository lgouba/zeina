// Package middleware fournit les middlewares Echo applicables à l'API ZEINA :
// recover, request-id, log structuré zerolog, CORS strict, rate limit en
// mémoire, et enforcement JWT.
package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/rs/zerolog"

	apperr "github.com/zeina/hyperviseur/packages/shared/errors"
	"github.com/zeina/hyperviseur/packages/shared/jwt"
	"github.com/zeina/hyperviseur/packages/shared/logger"
)

const (
	HeaderRequestID = "X-Request-ID"
	CtxKeyClaims    = "claims" // *jwt.Claims posé par RequireAuth
)

// Recover renvoie un 500 en cas de panic. Logge la stack.
func Recover(log zerolog.Logger) echo.MiddlewareFunc {
	return middleware.RecoverWithConfig(middleware.RecoverConfig{
		StackSize: 4 << 10, // 4 KB
		LogErrorFunc: func(c echo.Context, err error, stack []byte) error {
			log.Error().Err(err).Bytes("stack", stack).Str("path", c.Path()).Msg("panic recovered")
			return err
		},
	})
}

// RequestID lit X-Request-ID si présent, en génère un sinon, le pose dans
// les headers de réponse. Le middleware Logger récupère la valeur après.
func RequestID() echo.MiddlewareFunc {
	return middleware.RequestID()
}

// Logger émet un log JSON par requête HTTP avec request_id, méthode, path,
// status, latence. Aussi attache le logger enrichi au context.Context Go.
func Logger(base zerolog.Logger) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			rid := c.Response().Header().Get(echo.HeaderXRequestID)
			if rid == "" {
				rid = c.Request().Header.Get(echo.HeaderXRequestID)
			}
			l := base.With().Str("request_id", rid).Logger()
			ctx := logger.WithLogger(c.Request().Context(), l)
			c.SetRequest(c.Request().WithContext(ctx))

			err := next(c)

			ev := l.Info()
			if err != nil {
				ev = l.Warn().Err(err)
			}
			ev.
				Str("method", c.Request().Method).
				Str("path", c.Request().URL.Path).
				Int("status", c.Response().Status).
				Dur("latency", time.Since(start)).
				Str("ip", c.RealIP()).
				Msg("http request")
			return err
		}
	}
}

// CORS — allowlist explicite, credentials autorisés (pour cookies refresh).
func CORS(allowedOrigins []string) echo.MiddlewareFunc {
	return middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowHeaders:     []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAuthorization, echo.HeaderXRequestID},
		ExposeHeaders:    []string{echo.HeaderXRequestID},
		AllowCredentials: true,
		MaxAge:           600,
	})
}

// SecureHeaders — équivalent helmet : HSTS strict, no-sniff, anti-clickjack,
// CSP restrictive, Referrer minimal, désactivation des Permissions-Policy
// non utilisées (camera, geolocation, etc.).
func SecureHeaders() echo.MiddlewareFunc {
	secure := middleware.SecureWithConfig(middleware.SecureConfig{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		HSTSMaxAge:            31536000,
		HSTSExcludeSubdomains: false,
		// CSP minimale pour l'API : pas d'inline JS/CSS, pas de eval, pas de
		// ressources externes (les seules réponses HTML sont Swagger UI servi
		// depuis CDN unpkg, qui a sa propre CSP plus tolérante côté handler
		// /docs).
		ContentSecurityPolicy: "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
	})
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return secure(func(c echo.Context) error {
			h := c.Response().Header()
			// Plus restrictif que les défauts Echo
			if h.Get("Referrer-Policy") == "" {
				h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			}
			if h.Get("Permissions-Policy") == "" {
				h.Set("Permissions-Policy",
					"camera=(), microphone=(), geolocation=(), payment=(), usb=()")
			}
			// Cross-Origin protections (anti SXSS via fetch/iframe)
			if h.Get("Cross-Origin-Opener-Policy") == "" {
				h.Set("Cross-Origin-Opener-Policy", "same-origin")
			}
			if h.Get("Cross-Origin-Resource-Policy") == "" {
				h.Set("Cross-Origin-Resource-Policy", "same-site")
			}
			return next(c)
		})
	}
}

// --- Rate limiter en mémoire (token bucket par IP) -------------------------

type tokenBucket struct {
	tokens     float64
	lastRefill time.Time
}

type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*tokenBucket
	rps      float64
	capacity float64
}

func NewRateLimiter(rps int) *RateLimiter {
	if rps <= 0 {
		rps = 20
	}
	return &RateLimiter{
		buckets:  make(map[string]*tokenBucket),
		rps:      float64(rps),
		capacity: float64(rps) * 2, // burst = 2x rps
	}
}

func (rl *RateLimiter) Middleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ip := c.RealIP()
			if !rl.allow(ip) {
				return apperr.New(apperr.KindRateLimited, "rate limit exceeded")
			}
			return next(c)
		}
	}
}

func (rl *RateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	b, ok := rl.buckets[key]
	now := time.Now()
	if !ok {
		rl.buckets[key] = &tokenBucket{tokens: rl.capacity - 1, lastRefill: now}
		return true
	}
	elapsed := now.Sub(b.lastRefill).Seconds()
	b.tokens += elapsed * rl.rps
	if b.tokens > rl.capacity {
		b.tokens = rl.capacity
	}
	b.lastRefill = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// --- Rate limiter strict pour les endpoints sensibles ---------------------
//
// AuthRateLimiter est un compteur sur fenêtre fixe (par IP) destiné aux
// endpoints d'authentification : login, verify-code, forgot-password,
// set-password. Il vise à ralentir le brute-force au-delà du rate limiter
// global (qui autorise des bursts pour l'usage normal de l'app).
//
// Politique par défaut : MaxAttempts requêtes par Window.
// Au-delà, 429 jusqu'à la fin de la fenêtre.
//
// Stockage en mémoire (per-process). Pour multi-replica, migrer vers Redis.

type authBucket struct {
	count   int
	windowAt time.Time
}

type AuthRateLimiter struct {
	mu          sync.Mutex
	buckets     map[string]*authBucket
	maxAttempts int
	window      time.Duration
}

// NewAuthRateLimiter crée un limiter strict. Suggestion : 10 tentatives /
// 15 min ralentit drastiquement le brute-force tout en restant tolérant
// pour un humain qui se trompe quelques fois.
func NewAuthRateLimiter(maxAttempts int, window time.Duration) *AuthRateLimiter {
	if maxAttempts <= 0 {
		maxAttempts = 10
	}
	if window <= 0 {
		window = 15 * time.Minute
	}
	return &AuthRateLimiter{
		buckets:     make(map[string]*authBucket),
		maxAttempts: maxAttempts,
		window:      window,
	}
}

// Middleware rejette les requêtes au-delà du quota pour l'IP courante.
func (rl *AuthRateLimiter) Middleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if !rl.allow(c.RealIP()) {
				return apperr.New(apperr.KindRateLimited,
					"trop de tentatives — réessayez dans quelques minutes")
			}
			return next(c)
		}
	}
}

func (rl *AuthRateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	b, ok := rl.buckets[key]
	if !ok || now.Sub(b.windowAt) >= rl.window {
		rl.buckets[key] = &authBucket{count: 1, windowAt: now}
		return true
	}
	if b.count >= rl.maxAttempts {
		return false
	}
	b.count++
	return true
}

// --- JWT enforcement -------------------------------------------------------

// RequireAuth vérifie l'access token (Authorization: Bearer xxx OU
// query "token=" pour le WebSocket). Pose les claims dans c.Set("claims").
func RequireAuth(signer *jwt.Signer) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			tok := extractToken(c)
			if tok == "" {
				return apperr.Unauthorized("missing access token")
			}
			claims, err := signer.ParseAccess(tok)
			if err != nil {
				return apperr.Unauthorized("invalid or expired token")
			}
			c.Set(CtxKeyClaims, claims)
			return next(c)
		}
	}
}

// RequireRole enforce un rôle minimum (legacy admin/manager/viewer — conservé
// pour compat mais plus utilisé depuis la migration RBAC ; les nouvelles
// routes passent par RequirePermission ou RequireTenantOwner).
func RequireRole(minRole string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			claims, ok := c.Get(CtxKeyClaims).(*jwt.Claims)
			if !ok {
				return apperr.Unauthorized("")
			}
			if !roleAtLeast(claims.Role, minRole) {
				return apperr.Forbidden("insufficient role")
			}
			return next(c)
		}
	}
}

func extractToken(c echo.Context) string {
	if h := c.Request().Header.Get(echo.HeaderAuthorization); h != "" {
		if strings.HasPrefix(h, "Bearer ") {
			return strings.TrimPrefix(h, "Bearer ")
		}
	}
	// Pour WebSocket : ?token=xxx
	if t := c.QueryParam("token"); t != "" {
		return t
	}
	return ""
}

func roleAtLeast(have, minRole string) bool {
	rank := map[string]int{"viewer": 1, "manager": 2, "admin": 3}
	return rank[have] >= rank[minRole]
}

// --- Error handler central -------------------------------------------------

// ErrorHandler — convertit AppError en réponse HTTP cohérente, log les 5xx.
func ErrorHandler(log zerolog.Logger) echo.HTTPErrorHandler {
	return func(err error, c echo.Context) {
		if c.Response().Committed {
			return
		}
		status := http.StatusInternalServerError
		message := "internal server error"
		var details map[string]any
		var code apperr.Kind = apperr.KindInternal

		if ae := apperr.As(err); ae != nil {
			status = ae.Kind.HTTPStatus()
			message = ae.Message
			details = ae.Details
			code = ae.Kind
		} else if he, ok := err.(*echo.HTTPError); ok {
			status = he.Code
			if msg, ok := he.Message.(string); ok {
				message = msg
			}
		}

		if status >= 500 {
			log.Error().Err(err).Str("path", c.Path()).Msg("server error")
		}

		body := map[string]any{
			"error":   string(code),
			"message": message,
		}
		if details != nil {
			body["details"] = details
		}
		_ = c.JSON(status, body)
	}
}
