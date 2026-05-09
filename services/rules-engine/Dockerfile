FROM golang:1.22 AS builder
WORKDIR /workspace

COPY packages/shared packages/shared
COPY services/rules-engine services/rules-engine

ENV CGO_ENABLED=0 GOOS=linux GOWORK=off
WORKDIR /workspace/services/rules-engine
RUN go mod download
RUN go build -trimpath -ldflags="-s -w" -o /out/rules ./cmd/rules

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/rules /usr/local/bin/rules
ENV LOG_LEVEL=info LOG_FORMAT=json
USER nonroot:nonroot
EXPOSE 9091
ENTRYPOINT ["/usr/local/bin/rules"]
