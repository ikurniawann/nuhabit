# Go API for NüHabit. Build from backend/:
#   docker build -t nuhabit-api backend
#
# Build stage: dependencies download in their own layer so a source-only change
# does not re-resolve the module graph.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
# CGO off gives static binaries; -trimpath and -s -w keep them small and free
# of local paths.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

# Runtime: distroless static, non-root (uid 65532). It ships CA certificates
# and the tz database (Asia/Jakarta) and nothing else: no shell, no curl.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/api /out/migrate /usr/local/bin/
# The migrate binary reads the SQL from here (MIGRATIONS_DIR).
COPY database/migrations /app/database/migrations
ENV PORT=8080 \
    APP_ENV=production \
    TZ=Asia/Jakarta \
    MODULES=all \
    BACKEND_ROOT=/app \
    MIGRATIONS_DIR=/app/database/migrations
EXPOSE 8080
USER nonroot:nonroot
# No shell or curl here, so the binary probes its own /health. Orchestrators
# should probe HTTP directly: liveness GET /health, readiness GET /ready.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=4 \
    CMD ["/usr/local/bin/api", "-healthcheck"]
ENTRYPOINT ["/usr/local/bin/api"]
