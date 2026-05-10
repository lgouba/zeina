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
	PollsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zeina_iotsens_polls_total",
		Help: "Number of poll cycles executed.",
	}, []string{"result"}) // ok|error

	MeasurementsForwarded = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zeina_iotsens_measurements_forwarded_total",
		Help: "Measurements transformed and published to MQTT.",
	}, []string{"measurement"})

	PollDurationSeconds = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "zeina_iotsens_poll_duration_seconds",
		Help:    "Time spent polling IoTSens API per device.",
		Buckets: prometheus.ExponentialBuckets(0.005, 2, 12),
	})

	DevicesMapped = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "zeina_iotsens_devices_mapped",
		Help: "Number of IoTSens devices currently mapped to ZEINA devices.",
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
