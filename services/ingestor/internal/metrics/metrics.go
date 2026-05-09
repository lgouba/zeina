// Package metrics — collecteurs Prometheus exposés par l'ingestor sur :9090/metrics.
package metrics

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"
)

var (
	MessagesReceived = promauto.NewCounter(prometheus.CounterOpts{
		Name: "zeina_ingestor_messages_received_total",
		Help: "MQTT messages received from the broker (all topics).",
	})

	MessagesAccepted = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zeina_ingestor_messages_accepted_total",
		Help: "Messages accepted (decoded + device resolved + queued for writing).",
	}, []string{"measurement"})

	MessagesDropped = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zeina_ingestor_messages_dropped_total",
		Help: "Messages dropped at any stage of the pipeline.",
	}, []string{"reason"}) // reason ∈ decode|topic|unknown_device|queue_full|out_of_range

	BatchSize = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "zeina_ingestor_batch_size",
		Help:    "Size of batches written via COPY.",
		Buckets: prometheus.LinearBuckets(50, 50, 12), // 50,100,...,600
	})

	WriteDurationSeconds = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "zeina_ingestor_write_duration_seconds",
		Help:    "Time spent in CopyFrom (per batch).",
		Buckets: prometheus.ExponentialBuckets(0.001, 2, 12), // 1ms..2s
	})

	WriteErrors = promauto.NewCounter(prometheus.CounterOpts{
		Name: "zeina_ingestor_write_errors_total",
		Help: "CopyFrom errors.",
	})

	QueueDepth = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "zeina_ingestor_queue_depth",
		Help: "Current depth of the in-memory channel between consumer and writer.",
	})

	ResolverCacheHits = promauto.NewCounter(prometheus.CounterOpts{
		Name: "zeina_ingestor_resolver_cache_hits_total",
		Help: "Topic→device_id resolutions served from cache.",
	})

	ResolverCacheMisses = promauto.NewCounter(prometheus.CounterOpts{
		Name: "zeina_ingestor_resolver_cache_misses_total",
		Help: "Topic→device_id resolutions that hit the database.",
	})
)

// ServeHTTP démarre le handler /metrics + /health sur addr et bloque jusqu'à
// ctx.Done. Retourne nil si arrêt propre.
func ServeHTTP(addr string, log zerolog.Logger) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		log.Info().Str("addr", addr).Msg("metrics server listening")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error().Err(err).Msg("metrics server failed")
		}
	}()
	return srv
}
