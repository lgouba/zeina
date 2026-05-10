// Binaire `ingestor` — pont MQTT → TimescaleDB.
//
//   - subscribe à qlab/+/+/+/+/+ (toutes mesures, ignore state/cmd)
//   - décode + valide payload
//   - résout (tenant/site/zone/device) → device_id via cache LRU + DB
//   - batche par 500 messages OU 1s (configurable)
//   - bulk insert via pgx CopyFrom
//   - touch devices.last_seen_at en batch
//   - métriques Prometheus sur :9090/metrics
//   - graceful shutdown : drain le channel avant exit
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
	"github.com/zeina/hyperviseur/packages/shared/mqtt"

	"github.com/zeina/hyperviseur/services/ingestor/internal/batcher"
	"github.com/zeina/hyperviseur/services/ingestor/internal/consumer"
	"github.com/zeina/hyperviseur/services/ingestor/internal/metrics"
	"github.com/zeina/hyperviseur/services/ingestor/internal/resolver"
	"github.com/zeina/hyperviseur/services/ingestor/internal/writer"
)

func main() {
	var (
		databaseURL   = flag.String("database-url", envOr("DATABASE_URL", ""), "Postgres DSN")
		broker        = flag.String("broker", envOr("MQTT_BROKER", "tcp://mosquitto:1883"), "MQTT broker URL")
		mqttUser      = flag.String("mqtt-user", envOr("MQTT_USER", "ingestor"), "MQTT username")
		mqttPwd       = flag.String("mqtt-password", envOr("MQTT_PASSWORD", "changeme_ingestor"), "MQTT password")
		batchSize     = flag.Int("batch-size", envInt("INGESTOR_BATCH_SIZE", 500), "max messages per batch")
		batchTimeout  = flag.Duration("batch-timeout", envDur("INGESTOR_BATCH_TIMEOUT", time.Second), "max delay before flush")
		channelBuffer = flag.Int("channel-buffer", envInt("INGESTOR_CHANNEL_BUFFER", 10000), "buffer between consumer and batcher")
		metricsAddr   = flag.String("metrics-addr", ":"+envOr("INGESTOR_METRICS_PORT", "9090"), "Prometheus metrics listen address")
		logLevel      = flag.String("log-level", envOr("LOG_LEVEL", "info"), "log level")
		logFormat     = flag.String("log-format", envOr("LOG_FORMAT", "json"), "log format")
	)
	flag.Parse()

	if *databaseURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL is required")
		os.Exit(2)
	}

	log := logger.New(logger.Options{Level: *logLevel, Format: *logFormat, Service: "ingestor"})

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// --- DB pool ----------------------------------------------------------
	pool, err := db.NewPool(rootCtx, db.Options{DSN: *databaseURL, MaxConns: 8, MinConns: 2}, log)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	// --- HTTP metrics -----------------------------------------------------
	metricsSrv := metrics.ServeHTTP(*metricsAddr, log)

	// --- MQTT client ------------------------------------------------------
	mqttOpts := mqtt.DefaultOptions(*broker)
	mqttOpts.ClientID = "zeina-ingestor"
	mqttOpts.Username = *mqttUser
	mqttOpts.Password = *mqttPwd
	mqttOpts.Logger = &log

	client, err := mqtt.New(mqttOpts)
	if err != nil {
		log.Fatal().Err(err).Msg("mqtt new")
	}
	connectCtx, ccancel := context.WithTimeout(rootCtx, 30*time.Second)
	if err := client.Connect(connectCtx); err != nil {
		ccancel()
		log.Fatal().Err(err).Msg("mqtt connect")
	}
	ccancel()

	// --- Pipeline : consumer → channel → batcher → writer ----------------
	res := resolver.New(pool, log)
	w := writer.New(pool, log)

	pipe := make(chan consumer.Item, *channelBuffer)
	cons := consumer.New(client, res, pipe, log)
	bat := batcher.New(pipe, w, *batchSize, *batchTimeout, log)

	// Le batcher tourne dans sa propre goroutine.
	doneBatcher := make(chan struct{})
	go func() {
		bat.Run(rootCtx)
		close(doneBatcher)
	}()

	// Subscribe MQTT — handler push asynchronement sur pipe.
	if err := cons.Start(rootCtx); err != nil {
		log.Fatal().Err(err).Msg("consumer start")
	}

	log.Info().
		Int("batch_size", *batchSize).
		Dur("batch_timeout", *batchTimeout).
		Int("channel_buffer", *channelBuffer).
		Msg("ingestor running")

	// --- Graceful shutdown ------------------------------------------------
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Info().Str("signal", sig.String()).Msg("shutting down")

	// 1. Cancel root → le batcher passe en mode drain
	cancel()
	// 2. Disconnect MQTT (laisse 500ms aux inflight)
	client.Disconnect(500)
	// 3. Attendre la fin du drain batcher (timeout 8s)
	select {
	case <-doneBatcher:
	case <-time.After(8 * time.Second):
		log.Warn().Msg("batcher drain timeout")
	}
	// 4. Stopper le serveur metrics
	shCtx, shCancel := context.WithTimeout(context.Background(), 2*time.Second)
	_ = metricsSrv.Shutdown(shCtx)
	shCancel()

	log.Info().Msg("bye")
}

// --- helpers env -------------------------------------------------------------

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
