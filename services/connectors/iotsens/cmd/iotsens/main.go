// Binaire `iotsens` — connecteur IoTSens → MQTT ZEINA.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/zeina/hyperviseur/packages/shared/db"
	"github.com/zeina/hyperviseur/packages/shared/logger"
	sharedmqtt "github.com/zeina/hyperviseur/packages/shared/mqtt"

	"github.com/zeina/hyperviseur/services/connectors/iotsens/internal/client"
	"github.com/zeina/hyperviseur/services/connectors/iotsens/internal/mapper"
	"github.com/zeina/hyperviseur/services/connectors/iotsens/internal/metrics"
	"github.com/zeina/hyperviseur/services/connectors/iotsens/internal/poller"
)

func main() {
	var (
		databaseURL  = flag.String("database-url", envOr("DATABASE_URL", ""), "Postgres DSN")
		broker       = flag.String("broker", envOr("MQTT_BROKER", "tcp://mosquitto:1883"), "MQTT broker URL")
		mqttUser     = flag.String("mqtt-user", envOr("MQTT_USER", "simulator"), "MQTT username")
		mqttPwd      = flag.String("mqtt-password", envOr("MQTT_PASSWORD", "changeme_sim"), "MQTT password")
		iotsensURL   = flag.String("iotsens-url", envOr("IOTSENS_URL", "http://iotsens-fake:8081"), "IoTSens API base URL")
		iotsensKey   = flag.String("iotsens-api-key", envOr("IOTSENS_API_KEY", "demo-key-iotsens"), "IoTSens X-API-Key")
		mapperEvery  = flag.Duration("mapper-refresh", envDur("IOTSENS_MAPPER_REFRESH", 30*time.Second), "DB mapping refresh period")
		reconcileEv  = flag.Duration("reconcile-every", envDur("IOTSENS_RECONCILE", 15*time.Second), "poller supervisor reconciliation period")
		metricsAddr  = flag.String("metrics-addr", ":"+envOr("IOTSENS_METRICS_PORT", "9092"), "Prometheus metrics listen address")
		logLevel     = flag.String("log-level", envOr("LOG_LEVEL", "info"), "log level")
		logFormat    = flag.String("log-format", envOr("LOG_FORMAT", "json"), "log format")
	)
	flag.Parse()

	if *databaseURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required")
		os.Exit(2)
	}

	log := logger.New(logger.Options{Level: *logLevel, Format: *logFormat, Service: "iotsens-connector"})

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := db.NewPool(rootCtx, db.Options{DSN: *databaseURL, MaxConns: 4, MinConns: 1}, log)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	metricsSrv := metrics.ServeHTTP(*metricsAddr, log)

	// MQTT client (ce connecteur publie en tant que "simulator" — on lui donne
	// les droits d'écrire sous qlab/ via l'ACL Mosquitto).
	mqttOpts := sharedmqtt.DefaultOptions(*broker)
	mqttOpts.ClientID = "zeina-iotsens-connector"
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

	// IoTSens client + mapper + poller
	apiClient := client.New(*iotsensURL, *iotsensKey, 10*time.Second)
	mp := mapper.New(pool, log)
	go mp.Run(rootCtx, *mapperEvery)

	pl := poller.New(apiClient, mqttC, mp, log)
	go pl.Run(rootCtx, *reconcileEv)

	log.Info().
		Str("iotsens_url", *iotsensURL).
		Dur("mapper_refresh", *mapperEvery).
		Dur("reconcile", *reconcileEv).
		Msg("iotsens connector running")

	// --- Graceful shutdown
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

func envOr(k, d string) string { if v := os.Getenv(k); v != "" { return v }; return d }
func envDur(k string, d time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if x, err := time.ParseDuration(v); err == nil { return x }
	}
	return d
}
var _ = strconv.Atoi // future use
