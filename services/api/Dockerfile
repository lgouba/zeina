# =============================================================================
# Build multi-stage du binaire `api`
# =============================================================================
FROM golang:1.22 AS builder

WORKDIR /workspace

COPY packages/shared packages/shared
COPY services/api services/api
# Spec OpenAPI canonique du repo — copiée dans le package handlers pour go:embed.
COPY openapi/openapi.yaml services/api/internal/handlers/openapi.yaml

ENV CGO_ENABLED=0 GOOS=linux GOWORK=off

WORKDIR /workspace/services/api
RUN go mod download
RUN go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# ----------------------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/api /usr/local/bin/api

ENV LOG_LEVEL=info \
    LOG_FORMAT=json \
    API_BIND=0.0.0.0 \
    API_PORT=3000

USER nonroot:nonroot
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/api"]
