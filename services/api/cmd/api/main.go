// Binaire `api` — REST + WebSocket pour ZEINA.
package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/zeina/hyperviseur/packages/shared/db"
	"github.com/zeina/hyperviseur/packages/shared/jwt"
	"github.com/zeina/hyperviseur/packages/shared/logger"
	sharedmqtt "github.com/zeina/hyperviseur/packages/shared/mqtt"

	"github.com/zeina/hyperviseur/services/api/internal/activation"
	"github.com/zeina/hyperviseur/services/api/internal/audit"
	"github.com/zeina/hyperviseur/services/api/internal/handlers"
	"github.com/zeina/hyperviseur/services/api/internal/mailer"
	mw "github.com/zeina/hyperviseur/services/api/internal/middleware"
	"github.com/zeina/hyperviseur/services/api/internal/rbac"
	"github.com/zeina/hyperviseur/services/api/internal/ws"
)

func main() {
	var (
		bind        = flag.String("bind", envOr("API_BIND", "0.0.0.0"), "HTTP bind address")
		port        = flag.Int("port", envInt("API_PORT", 3000), "HTTP port")
		databaseURL = flag.String("database-url", envOr("DATABASE_URL", ""), "Postgres DSN")
		broker      = flag.String("broker", envOr("MQTT_BROKER", "tcp://mosquitto:1883"), "MQTT broker URL")
		mqttUser    = flag.String("mqtt-user", envOr("MQTT_USER", "api"), "MQTT username")
		mqttPwd     = flag.String("mqtt-password", envOr("MQTT_PASSWORD", "changeme_api"), "MQTT password")
		jwtSecret   = flag.String("jwt-secret", envOr("JWT_SECRET", ""), "HS256 secret (>=32 bytes)")
		accessTTL   = flag.Duration("access-ttl", envDur("JWT_ACCESS_TTL", 15*time.Minute), "access token TTL")
		refreshTTL  = flag.Duration("refresh-ttl", envDur("JWT_REFRESH_TTL", 168*time.Hour), "refresh token TTL")
		corsOrigins = flag.String("cors-origins", envOr("CORS_ALLOWED_ORIGINS", "http://localhost:5173"), "comma-separated allowed origins")
		rateLimit   = flag.Int("rate-limit-rps", envInt("RATE_LIMIT_RPS", 20), "requests/sec/IP")
		tenantSlug  = flag.String("tenant-slug", envOr("DEMO_TENANT_SLUG", "acme"), "tenant slug for MQTT topics (MVP single-tenant)")
		logLevel    = flag.String("log-level", envOr("LOG_LEVEL", "info"), "log level")
		logFormat   = flag.String("log-format", envOr("LOG_FORMAT", "json"), "log format")
		// SMTP : pour l'envoi des mails d'activation et reset password.
		// Si SMTP_HOST vide, le mailer est en mode stub (logge sans envoyer).
		smtpHost     = flag.String("smtp-host", envOr("SMTP_HOST", ""), "SMTP host")
		smtpPort     = flag.Int("smtp-port", envInt("SMTP_PORT", 587), "SMTP port")
		smtpUser     = flag.String("smtp-username", envOr("SMTP_USERNAME", ""), "SMTP username")
		smtpPwd      = flag.String("smtp-password", envOr("SMTP_PASSWORD", ""), "SMTP password")
		smtpFrom     = flag.String("smtp-from", envOr("SMTP_FROM", ""), "From address")
		smtpFromName = flag.String("smtp-from-name", envOr("SMTP_FROM_NAME", "ZEINA Hyperviseur"), "From display name")
		smtpTLS      = flag.String("smtp-tls", envOr("SMTP_TLS", "starttls"), "starttls | tls | none")
		// URL publique de l'app (pour les liens dans les mails).
		appBaseURL = flag.String("app-base-url", envOr("APP_BASE_URL", "http://localhost:5173"), "public URL of the SPA (for email links)")
		brandName  = flag.String("brand", envOr("BRAND_NAME", "ZEINA"), "brand name shown in emails")
	)
	flag.Parse()

	if *databaseURL == "" || *jwtSecret == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL and JWT_SECRET are required")
		os.Exit(2)
	}

	log := logger.New(logger.Options{Level: *logLevel, Format: *logFormat, Service: "api"})

	signer, err := jwt.NewSigner(*jwtSecret, *accessTTL, *refreshTTL)
	if err != nil {
		log.Fatal().Err(err).Msg("jwt signer init")
	}

	rootCtx, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()

	pool, err := db.NewPool(rootCtx, db.Options{DSN: *databaseURL, MaxConns: 10, MinConns: 2}, log)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	mqttOpts := sharedmqtt.DefaultOptions(*broker)
	mqttOpts.ClientID = "zeina-api"
	mqttOpts.Username = *mqttUser
	mqttOpts.Password = *mqttPwd
	mqttOpts.Logger = &log
	mqttClient, err := sharedmqtt.New(mqttOpts)
	if err != nil {
		log.Fatal().Err(err).Msg("mqtt new")
	}
	cctx, ccancel := context.WithTimeout(rootCtx, 30*time.Second)
	if err := mqttClient.Connect(cctx); err != nil {
		ccancel()
		log.Fatal().Err(err).Msg("mqtt connect")
	}
	ccancel()

	bcaster := ws.NewBroadcaster(*tenantSlug, mqttClient, log)
	if err := bcaster.Start(rootCtx); err != nil {
		log.Fatal().Err(err).Msg("ws broadcaster subscribe")
	}

	// --- Echo setup --------------------------------------------------------
	e := echo.New()
	e.HideBanner = true
	e.HTTPErrorHandler = mw.ErrorHandler(log)

	allowedOrigins := splitCSV(*corsOrigins)

	e.Use(mw.Recover(log))
	e.Use(mw.RequestID())
	e.Use(mw.Logger(log))
	e.Use(mw.SecureHeaders())
	e.Use(mw.CORS(allowedOrigins))

	rl := mw.NewRateLimiter(*rateLimit)
	e.Use(rl.Middleware())

	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
	})

	// --- API docs (public) -------------------------------------------------
	// /docs           : Swagger UI (page interactive)
	// /openapi.yaml   : spec brute, utile pour Postman/Insomnia/codegen
	docsH := handlers.NewDocsHandler()
	docsH.Register(e)

	v1 := e.Group("/v1")

	// --- Mailer + activation service (utilisés par auth + users) -----------
	mailCfg := mailer.Config{
		Host: *smtpHost, Port: *smtpPort,
		Username: *smtpUser, Password: *smtpPwd,
		From: *smtpFrom, FromName: *smtpFromName, TLSMode: *smtpTLS,
	}
	if mailCfg.From == "" {
		mailCfg.From = mailCfg.Username
	}
	mailSvc := mailer.New(mailCfg, log)
	if mailCfg.Configured() {
		log.Info().Str("host", mailCfg.Host).Int("port", mailCfg.Port).Msg("mailer configured")
	} else {
		log.Info().Msg("mailer in stub mode — activation emails will NOT be delivered")
	}
	activationSvc := activation.NewService(pool)

	// Audit logger partagé par tous les handlers qui font des actions sensibles.
	auditLog := audit.NewLogger(pool)

	// --- Auth (public) -----------------------------------------------------
	authH := handlers.NewAuthHandler(pool, signer, activationSvc, mailSvc, auditLog, *appBaseURL, *brandName, log)
	authH.Register(v1.Group("/auth"))

	// --- WebSocket (auth via query param ?token=) --------------------------
	wsH := handlers.NewWSHandler(signer, bcaster, allowedOrigins)
	wsH.Register(v1)

	// --- Routes authentifiées ----------------------------------------------
	auth := v1.Group("", mw.RequireAuth(signer))

	// /v1/auth/me
	authH.RegisterMe(auth.Group("/auth"))

	// Resolver RBAC partagé pour toutes les routes site-scoped.
	rs := rbac.NewResolver(pool)

	// --- Routes tenant-wide (owner ou superadmin) --------------------------
	tenantAdmin := auth.Group("", mw.RequireTenantOwner())
	usersH := handlers.NewUsersHandler(pool, auditLog, mailSvc, activationSvc, *appBaseURL, *brandName, log)
	usersH.Register(tenantAdmin)
	rolesH := handlers.NewRolesHandler(pool, auditLog)
	rolesH.Register(tenantAdmin)
	auditH := handlers.NewAuditHandler(pool)
	auditH.Register(tenantAdmin)

	// Catalogue device-models : lecture pour tout user authentifié,
	// écriture réservée aux owners.
	deviceModelsH := handlers.NewDeviceModelsHandler(pool)
	deviceModelsH.RegisterReadOnly(auth)
	deviceModelsH.RegisterWrite(tenantAdmin)

	// --- Sites : la List filtre par membership (logique dans handler) ------
	sitesH := handlers.NewSitesHandler(pool, auditLog)
	sitesH.Register(auth)
	sitesH.RegisterWrite(tenantAdmin) // POST/PUT/DELETE sites — owners only

	// --- Devices -----------------------------------------------------------
	devicesH := handlers.NewDevicesHandler(pool, mqttClient, *tenantSlug)

	devRead := func(getSite mw.SiteResolver) echo.MiddlewareFunc {
		return mw.RequirePermission(rs, rbac.FeatureDevices, rbac.LevelRead, getSite)
	}
	devWrite := func(getSite mw.SiteResolver) echo.MiddlewareFunc {
		return mw.RequirePermission(rs, rbac.FeatureDevices, rbac.LevelWrite, getSite)
	}
	auth.GET("/devices/:id", devicesH.Get, devRead(mw.SiteFromDevice(pool, "id")))
	auth.GET("/devices/:id/latest", devicesH.Latest, devRead(mw.SiteFromDevice(pool, "id")))
	auth.GET("/devices/:id/measurements", devicesH.Measurements, devRead(mw.SiteFromDevice(pool, "id")))
	auth.GET("/devices/:id/measurements-metadata", devicesH.MeasurementsMetadata, devRead(mw.SiteFromDevice(pool, "id")))
	auth.GET("/sites/:id/devices", devicesH.ListBySite, devRead(mw.SiteFromParam("id")))
	// --- Zones (gestion arborescence : zone géo → bât. → étage → pièce) ---
	zonesH := handlers.NewZonesHandler(pool, auditLog)
	auth.GET("/sites/:id/zones",   zonesH.List,   devRead(mw.SiteFromParam("id")))
	auth.POST("/sites/:id/zones",  zonesH.Create, devWrite(mw.SiteFromParam("id")))
	auth.PUT("/zones/:id",         zonesH.Update, devWrite(mw.SiteFromZone(pool, "id")))
	auth.DELETE("/zones/:id",      zonesH.Delete, devWrite(mw.SiteFromZone(pool, "id")))

	auth.POST("/sites/:id/devices", devicesH.Create, devWrite(mw.SiteFromParam("id")))
	auth.PUT("/devices/:id", devicesH.Update, devWrite(mw.SiteFromDevice(pool, "id")))
	auth.DELETE("/devices/:id", devicesH.Delete, devWrite(mw.SiteFromDevice(pool, "id")))
	auth.POST("/devices/:id/measurements", devicesH.PublishMeasurement, devWrite(mw.SiteFromDevice(pool, "id")))

	// --- Dashboards --------------------------------------------------------
	dashboardsH := handlers.NewDashboardsHandler(pool)
	dashRead := func(getSite mw.SiteResolver) echo.MiddlewareFunc {
		return mw.RequirePermission(rs, rbac.FeatureDashboard, rbac.LevelRead, getSite)
	}
	dashWrite := func(getSite mw.SiteResolver) echo.MiddlewareFunc {
		return mw.RequirePermission(rs, rbac.FeatureDashboard, rbac.LevelWrite, getSite)
	}
	auth.GET("/sites/:id/dashboards", dashboardsH.ListBySite, dashRead(mw.SiteFromParam("id")))
	auth.GET("/dashboards/:id", dashboardsH.Get, dashRead(mw.SiteFromDashboard(pool, "id")))
	auth.POST("/sites/:id/dashboards", dashboardsH.Create, dashWrite(mw.SiteFromParam("id")))
	auth.PUT("/dashboards/:id", dashboardsH.Update, dashWrite(mw.SiteFromDashboard(pool, "id")))
	auth.DELETE("/dashboards/:id", dashboardsH.Delete, dashWrite(mw.SiteFromDashboard(pool, "id")))
	auth.POST("/dashboards/:id/widgets", dashboardsH.CreateWidget, dashWrite(mw.SiteFromDashboard(pool, "id")))
	auth.PUT("/widgets/:id", dashboardsH.UpdateWidget, dashWrite(mw.SiteFromWidget(pool, "id")))
	auth.DELETE("/widgets/:id", dashboardsH.DeleteWidget, dashWrite(mw.SiteFromWidget(pool, "id")))
	auth.PUT("/dashboards/:id/layouts", dashboardsH.UpdateLayouts, dashWrite(mw.SiteFromDashboard(pool, "id")))

	// --- Rules -------------------------------------------------------------
	rulesH := handlers.NewRulesHandler(pool)
	ruleRead := func(getSite mw.SiteResolver) echo.MiddlewareFunc {
		return mw.RequirePermission(rs, rbac.FeatureRules, rbac.LevelRead, getSite)
	}
	ruleWrite := func(getSite mw.SiteResolver) echo.MiddlewareFunc {
		return mw.RequirePermission(rs, rbac.FeatureRules, rbac.LevelWrite, getSite)
	}
	auth.GET("/sites/:id/rules", rulesH.ListBySite, ruleRead(mw.SiteFromParam("id")))
	auth.GET("/rules/:id", rulesH.Get, ruleRead(mw.SiteFromRule(pool, "id")))
	auth.GET("/rules/:id/executions", rulesH.ListExecutions, ruleRead(mw.SiteFromRule(pool, "id")))
	auth.POST("/sites/:id/rules", rulesH.Create, ruleWrite(mw.SiteFromParam("id")))
	auth.PUT("/rules/:id", rulesH.Update, ruleWrite(mw.SiteFromRule(pool, "id")))
	auth.DELETE("/rules/:id", rulesH.Delete, ruleWrite(mw.SiteFromRule(pool, "id")))
	auth.POST("/rules/:id/enable", rulesH.Enable, ruleWrite(mw.SiteFromRule(pool, "id")))
	auth.POST("/rules/:id/disable", rulesH.Disable, ruleWrite(mw.SiteFromRule(pool, "id")))

	// --- Alarmes (workflow d'incident) -- permission rules:read pour la lecture,
	// rules:write pour ack / resolve / archive / commentaires.
	alarmsH := handlers.NewAlarmsHandler(pool)
	auth.GET("/sites/:id/alarms",          alarmsH.ListBySite,    ruleRead(mw.SiteFromParam("id")))
	auth.GET("/sites/:id/alarms/counts",   alarmsH.Counts,        ruleRead(mw.SiteFromParam("id")))
	auth.GET("/alarms/:id",                alarmsH.Get,           ruleRead(mw.SiteFromAlarm(pool, "id")))
	auth.GET("/alarms/:id/events",         alarmsH.ListEvents,    ruleRead(mw.SiteFromAlarm(pool, "id")))
	auth.GET("/alarms/:id/comments",       alarmsH.ListComments,  ruleRead(mw.SiteFromAlarm(pool, "id")))
	auth.POST("/alarms/:id/acknowledge",   alarmsH.Acknowledge,   ruleWrite(mw.SiteFromAlarm(pool, "id")))
	auth.POST("/alarms/:id/resolve",       alarmsH.Resolve,       ruleWrite(mw.SiteFromAlarm(pool, "id")))
	auth.POST("/alarms/:id/archive",       alarmsH.Archive,       ruleWrite(mw.SiteFromAlarm(pool, "id")))
	auth.POST("/alarms/:id/comments",      alarmsH.AddComment,    ruleWrite(mw.SiteFromAlarm(pool, "id")))

	// --- Commands : pilote un actionneur → permission devices:write --------
	cmdsH := handlers.NewCommandsHandler(pool, mqttClient, *tenantSlug)
	auth.POST("/devices/:id/command", cmdsH.Send, devWrite(mw.SiteFromDevice(pool, "id")))

	// --- Site members : permission members ---------------------------------
	smH := handlers.NewSiteMembersHandler(pool, auditLog)
	memRead := mw.RequirePermission(rs, rbac.FeatureMembers, rbac.LevelRead, mw.SiteFromParam("id"))
	memWrite := mw.RequirePermission(rs, rbac.FeatureMembers, rbac.LevelWrite, mw.SiteFromParam("id"))
	auth.GET("/sites/:id/members", smH.List, memRead)
	auth.POST("/sites/:id/members", smH.Add, memWrite)
	auth.PUT("/sites/:id/members/:user_id", smH.Update, memWrite)
	auth.DELETE("/sites/:id/members/:user_id", smH.Remove, memWrite)

	// --- Run ---------------------------------------------------------------
	addr := fmt.Sprintf("%s:%d", *bind, *port)
	go func() {
		log.Info().Str("addr", addr).Strs("cors", allowedOrigins).Msg("api listening")
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("api server failed")
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Info().Str("signal", sig.String()).Msg("shutting down")

	shCtx, shCancel := context.WithTimeout(context.Background(), 8*time.Second)
	if err := e.Shutdown(shCtx); err != nil {
		log.Warn().Err(err).Msg("echo shutdown")
	}
	shCancel()
	cancelRoot()
	mqttClient.Disconnect(500)
	log.Info().Msg("bye")
}

// --- helpers -----------------------------------------------------------------

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
func envDur(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
