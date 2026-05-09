FROM golang:1.22 AS builder
WORKDIR /workspace
COPY services/connectors/iotsens-fake services/connectors/iotsens-fake
ENV CGO_ENABLED=0 GOOS=linux GOWORK=off
WORKDIR /workspace/services/connectors/iotsens-fake
RUN go build -trimpath -ldflags="-s -w" -o /out/iotsens-fake ./cmd/iotsens-fake

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/iotsens-fake /usr/local/bin/iotsens-fake
USER nonroot:nonroot
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/iotsens-fake"]
