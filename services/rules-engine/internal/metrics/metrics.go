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
	RulesActive = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "zeina_rules_active",
		Help: "Number of active (enabled) rules currently loaded.",
	})

	TriggerEvaluations = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zeina_rules_trigger_evaluations_total",
		Help: "Number of trigger evaluations.",
	}, []string{"trigger_type", "result"}) // result = matched|nomatch

	RuleExecutions = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zeina_rules_executions_total",
		Help: "Number of rules executed (after passing trigger + conditions + cooldown).",
	}, []string{"result"}) // success|partial|failure|skipped

	RuleSkippedCooldown = promauto.NewCounter(prometheus.CounterOpts{
		Name: "zeina_rules_skipped_cooldown_total",
		Help: "Number of rules whose trigger fired but were skipped due to cooldown.",
	})

	ExecutionLatency = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "zeina_rules_execution_latency_seconds",
		Help:    "Time spent executing all actions of a rule.",
		Buckets: prometheus.ExponentialBuckets(0.005, 2, 12),
	})
)

func ServeHTTP(addr string, log zerolog.Logger) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Info().Str("addr", addr).Msg("metrics server listening")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error().Err(err).Msg("metrics server failed")
		}
	}()
	return srv
}
