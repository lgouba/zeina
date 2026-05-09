// Package errors fournit un type d'erreur applicatif unique (AppError) que
// les services traduisent en codes HTTP côté API et en niveaux de log
// structurés ailleurs. Les sentinels exportés sont les classes d'erreurs
// reconnues — toute autre erreur est traitée comme Internal.
package errors

import (
	"errors"
	"fmt"
)

// Kind — classe d'erreur indépendante du transport (HTTP, MQTT, ...).
type Kind string

const (
	KindInternal     Kind = "internal"
	KindNotFound     Kind = "not_found"
	KindValidation   Kind = "validation"
	KindUnauthorized Kind = "unauthorized"
	KindForbidden    Kind = "forbidden"
	KindConflict     Kind = "conflict"
	KindRateLimited  Kind = "rate_limited"
	KindUnavailable  Kind = "unavailable"
	KindBadRequest   Kind = "bad_request"
)

// HTTPStatus mappe un Kind vers un code HTTP standard.
func (k Kind) HTTPStatus() int {
	switch k {
	case KindNotFound:
		return 404
	case KindValidation, KindBadRequest:
		return 400
	case KindUnauthorized:
		return 401
	case KindForbidden:
		return 403
	case KindConflict:
		return 409
	case KindRateLimited:
		return 429
	case KindUnavailable:
		return 503
	default:
		return 500
	}
}

// AppError — erreur enrichie avec un Kind et un message public sûr.
// Le champ wrapped est l'erreur sous-jacente, conservée pour les logs mais
// jamais exposée au client.
type AppError struct {
	Kind    Kind
	Message string         // message public, traduisible
	Details map[string]any // détails structurés (ex: validation par champ)
	wrapped error
}

func (e *AppError) Error() string {
	if e.wrapped != nil {
		return fmt.Sprintf("%s: %s: %v", e.Kind, e.Message, e.wrapped)
	}
	return fmt.Sprintf("%s: %s", e.Kind, e.Message)
}

func (e *AppError) Unwrap() error { return e.wrapped }

// New crée une AppError sans cause sous-jacente.
func New(kind Kind, msg string) *AppError {
	return &AppError{Kind: kind, Message: msg}
}

// Newf — variante avec formatage.
func Newf(kind Kind, format string, args ...any) *AppError {
	return &AppError{Kind: kind, Message: fmt.Sprintf(format, args...)}
}

// Wrap enveloppe une erreur existante avec un Kind et un message public.
func Wrap(kind Kind, msg string, cause error) *AppError {
	return &AppError{Kind: kind, Message: msg, wrapped: cause}
}

// WithDetails ajoute des détails structurés (mutateur fluide).
func (e *AppError) WithDetails(details map[string]any) *AppError {
	e.Details = details
	return e
}

// As helper : retourne l'AppError contenue dans err, ou nil.
func As(err error) *AppError {
	var ae *AppError
	if errors.As(err, &ae) {
		return ae
	}
	return nil
}

// KindOf retourne le Kind de err si c'est une AppError, sinon KindInternal.
func KindOf(err error) Kind {
	if ae := As(err); ae != nil {
		return ae.Kind
	}
	return KindInternal
}

// --- Constructeurs raccourcis ----------------------------------------------

func NotFound(what string) *AppError {
	return Newf(KindNotFound, "%s not found", what)
}

func Validation(msg string) *AppError {
	return New(KindValidation, msg)
}

func Unauthorized(msg string) *AppError {
	if msg == "" {
		msg = "authentication required"
	}
	return New(KindUnauthorized, msg)
}

func Forbidden(msg string) *AppError {
	if msg == "" {
		msg = "access denied"
	}
	return New(KindForbidden, msg)
}

func Conflict(msg string) *AppError {
	return New(KindConflict, msg)
}

func Internal(cause error) *AppError {
	return Wrap(KindInternal, "internal server error", cause)
}
