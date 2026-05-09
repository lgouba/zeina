// Package logger configure zerolog en sortie JSON structurée pour tous les
// services Go. Le request-id est propagé via context.
package logger

import (
	"context"
	"io"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

type Options struct {
	Level   string // "trace" | "debug" | "info" | "warn" | "error" — défaut "info"
	Format  string // "json" | "console" — défaut "json"
	Service string // ex: "api", "ingestor" — ajouté à chaque log
}

// New construit un zerolog.Logger configuré selon Options. Doit être appelé
// une fois au démarrage du service. Le résultat est immuable et thread-safe.
func New(opts Options) zerolog.Logger {
	level := parseLevel(opts.Level)
	zerolog.SetGlobalLevel(level)
	zerolog.TimeFieldFormat = time.RFC3339Nano

	var out io.Writer = os.Stdout
	if strings.EqualFold(opts.Format, "console") {
		out = zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339}
	}

	logger := zerolog.New(out).With().Timestamp()
	if opts.Service != "" {
		logger = logger.Str("service", opts.Service)
	}
	return logger.Logger()
}

func parseLevel(s string) zerolog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "trace":
		return zerolog.TraceLevel
	case "debug":
		return zerolog.DebugLevel
	case "warn", "warning":
		return zerolog.WarnLevel
	case "error":
		return zerolog.ErrorLevel
	case "fatal":
		return zerolog.FatalLevel
	default:
		return zerolog.InfoLevel
	}
}

// --- Context plumbing -------------------------------------------------------

type ctxKey int

const (
	ctxKeyLogger ctxKey = iota
	ctxKeyRequestID
)

// WithLogger attache un logger à un context (utile pour les middlewares).
func WithLogger(ctx context.Context, l zerolog.Logger) context.Context {
	return context.WithValue(ctx, ctxKeyLogger, l)
}

// FromContext récupère le logger depuis context, ou un disabled-logger par défaut.
func FromContext(ctx context.Context) zerolog.Logger {
	if l, ok := ctx.Value(ctxKeyLogger).(zerolog.Logger); ok {
		return l
	}
	return zerolog.Nop()
}

// WithRequestID attache un request_id au context et au logger sous-jacent.
// Si rid est vide, en génère un nouveau (UUID v4).
func WithRequestID(ctx context.Context, rid string) context.Context {
	if rid == "" {
		rid = uuid.NewString()
	}
	ctx = context.WithValue(ctx, ctxKeyRequestID, rid)
	if l, ok := ctx.Value(ctxKeyLogger).(zerolog.Logger); ok {
		ctx = WithLogger(ctx, l.With().Str("request_id", rid).Logger())
	}
	return ctx
}

// RequestID récupère le request_id si présent.
func RequestID(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyRequestID).(string); ok {
		return v
	}
	return ""
}
