// Binaire `rules` — moteur de règles ZEINA.
//
//   - charge les règles activées depuis la DB (LISTEN/NOTIFY pour hot-reload)
//   - subscribe à qlab/+/+/+/+/+ (toutes mesures)
//   - cache l'état dans Redis (cooldown, sustained, last value)
//   - cron pour les triggers schedule
//   - publie commandes MQTT et alertes
//   - audit dans rule_executions
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/zeina/hyperviseur/packages/shared/db"
	"github.com/zeina/hyperviseur/packages/shared/logger"
	sharedmqtt "github.com/zeina/hyperviseur/packages/shared/mqtt"

	"github.com/zeina/hyperviseur/services/rules-engine/internal/actions"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/alarms"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/engine"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/metrics"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/state"
	"github.com/zeina/hyperviseur/services/rules-engine/internal/store"
)

func main() {
	var (
		databaseURL = flag.String("database-url", envOr("DATABASE_URL", ""), "Postgres DSN")
		broker      = flag.String("broker", envOr("MQTT_BROKER", "tcp://mosquitto:1883"), "MQTT broker URL")
		mqttUser    = flag.String("mqtt-user", envOr("MQTT_USER", "rules"), "MQTT username")
		mqttPwd     = flag.String("mqtt-password", envOr("MQTT_PASSWORD", "changeme_rules"), "MQTT password")
		redisURL    = flag.String("redis-url", envOr("REDIS_URL", "redis://redis:6379/0"), "Redis URL")
		metricsAddr = flag.String("metrics-addr", ":"+envOr("RULES_METRICS_PORT", "9091"), "Prometheus metrics listen address")
		logLevel    = flag.String("log-level", envOr("LOG_LEVEL", "info"), "log level")
		logFormat   = flag.String("log-format", envOr("LOG_FORMAT", "json"), "log format")
	)
	flag.Parse()

	if *databaseURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required")
		os.Exit(2)
	}

	log := logger.New(logger.Options{Level: *logLevel, Format: *logFormat, Service: "rules-engine"})

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.NewPool(rootCtx, db.Options{DSN: *databaseURL, MaxConns: 4, MinConns: 1}, log)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	rOpts, err := redis.ParseURL(*redisURL)
	if err != nil {
		log.Fatal().Err(err).Msg("redis url parse")
	}
	rClient := redis.NewClient(rOpts)
	if err := rClient.Ping(rootCtx).Err(); err != nil {
		log.Fatal().Err(err).Msg("redis ping")
	}
	defer rClient.Close()

	metricsSrv := metrics.ServeHTTP(*metricsAddr, log)

	mqttOpts := sharedmqtt.DefaultOptions(*broker)
	mqttOpts.ClientID = "zeina-rules-engine"
	mqttOpts.Username = *mqttUser
	mqttOpts.Password = *mqttPwd
	mqttOpts.Logger = &log
	mqttC, err := sharedmqtt.New(mqttOpts)
	if err != nil {
		log.Fatal().Err(err).Msg("mqtt new")
	}
	cctx, ccancel := context.WithTimeout(rootCtx, 30*time.Second)
	if err := mqttC.Connect(cctx); err != nil {
		ccancel()
		log.Fatal().Err(err).Msg("mqtt connect")
	}
	ccancel()

	st := store.New(pool, log)
	if err := st.LoadAll(rootCtx); err != nil {
		log.Fatal().Err(err).Msg("rules initial load")
	}
	go st.ListenChanges(rootCtx)

	stState := state.New(rClient)
	eng := engine.New(pool, st, stState, mqttC, log)

	// Providers email + sms — configuration optionnelle par variables
	// d'env. Si rien n'est défini, les actions email/sms sont "stub" :
	// loguées + alerte UI publiée, mais aucun envoi externe.
	emailCfg := actions.EmailConfig{
		Host:     os.Getenv("SMTP_HOST"),
		Port:     atoi(os.Getenv("SMTP_PORT"), 587),
		Username: os.Getenv("SMTP_USERNAME"),
		Password: os.Getenv("SMTP_PASSWORD"),
		From:     os.Getenv("SMTP_FROM"),
		FromName: os.Getenv("SMTP_FROM_NAME"),
		TLSMode:  os.Getenv("SMTP_TLS"),
	}
	smsCfg := actions.SMSConfig{
		WebhookURL: os.Getenv("SMS_WEBHOOK_URL"),
		AuthHeader: os.Getenv("SMS_WEBHOOK_AUTH"),
	}
	if extra := os.Getenv("SMS_WEBHOOK_HEADER"); extra != "" {
		smsCfg.ExtraHeaders = strings.Split(extra, "|")
	}
	eng.SetActionProviders(actions.NewEmailProvider(emailCfg), actions.NewSMSProvider(smsCfg))
	eng.SetAlarmStore(alarms.NewStore(pool))
	if emailCfg.Host != "" {
		log.Info().Str("smtp_host", emailCfg.Host).Int("smtp_port", emailCfg.Port).Msg("email provider configured")
	} else {
		log.Info().Msg("email provider not configured — email actions will run in stub mode")
	}
	if smsCfg.WebhookURL != "" {
		log.Info().Str("sms_webhook", smsCfg.WebhookURL).Msg("sms provider configured")
	} else {
		log.Info().Msg("sms provider not configured — sms actions will run in stub mode")
	}

	if err := eng.Start(rootCtx); err != nil {
		log.Fatal().Err(err).Msg("engine start")
	}

	log.Info().Msg("rules engine running")

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Info().Str("signal", sig.String()).Msg("shutting down")

	cancel()
	mqttC.Disconnect(500)
	shCtx, shCancel := context.WithTimeout(context.Background(), 2*time.Second)
	_ = metricsSrv.Shutdown(shCtx)
	shCancel()
	log.Info().Msg("bye")
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func atoi(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}
