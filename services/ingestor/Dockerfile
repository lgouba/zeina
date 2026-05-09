# =============================================================================
# Build multi-stage du binaire `ingestor`
# =============================================================================
FROM golang:1.22 AS builder

WORKDIR /workspace

COPY packages/shared packages/shared
COPY services/ingestor services/ingestor

ENV CGO_ENABLED=0 GOOS=linux GOWORK=off

WORKDIR /workspace/services/ingestor
RUN go mod download
RUN go build -trimpath -ldflags="-s -w" -o /out/ingestor ./cmd/ingestor

# ----------------------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/ingestor /usr/local/bin/ingestor

ENV LOG_LEVEL=info \
    LOG_FORMAT=json

USER nonroot:nonroot
EXPOSE 9090
ENTRYPOINT ["/usr/local/bin/ingestor"]
