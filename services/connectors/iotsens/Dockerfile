FROM golang:1.22 AS builder
WORKDIR /workspace

COPY packages/shared packages/shared
COPY services/connectors/iotsens services/connectors/iotsens

ENV CGO_ENABLED=0 GOOS=linux GOWORK=off
WORKDIR /workspace/services/connectors/iotsens
RUN go mod download
RUN go build -trimpath -ldflags="-s -w" -o /out/iotsens ./cmd/iotsens

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/iotsens /usr/local/bin/iotsens
ENV LOG_LEVEL=info LOG_FORMAT=json
USER nonroot:nonroot
EXPOSE 9092
ENTRYPOINT ["/usr/local/bin/iotsens"]
