# =============================================================================
# Build multi-stage du binaire `simulator`
#   - stage builder : golang:1.22 + go workspace
#   - stage final   : distroless static (aucune lib système, ~5 MB)
# =============================================================================

# ---- builder ----------------------------------------------------------------
FROM golang:1.22 AS builder

WORKDIR /workspace

# Copie le module shared (référencé via `replace`) puis le module simulator.
# On NE copie PAS go.work : il listerait des modules absents (api, ingestor,
# rules-engine), ce qui ferait échouer `go mod download`. Le replace dans
# services/simulator/go.mod suffit pour résoudre shared.
COPY packages/shared packages/shared
COPY services/simulator services/simulator

# Build statique sans cgo (compatible distroless static)
ENV CGO_ENABLED=0 GOOS=linux GOWORK=off

WORKDIR /workspace/services/simulator
RUN go mod download
RUN go build -trimpath -ldflags="-s -w" -o /out/simulator ./cmd/simulator

# ---- final ------------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/simulator /usr/local/bin/simulator

# La config est montée en volume (cf. docker-compose.yml).
ENV SIMULATOR_CONFIG=/etc/simulator/simulator.yml \
    LOG_LEVEL=info \
    LOG_FORMAT=json

USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/simulator"]
