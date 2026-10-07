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

# Runtime: Debian slim, because OCR shells out to the tesseract CLI
# (internal/platform/ocr) with the eng and ind language packs. It also
# carries CA certificates and the tz database (Asia/Jakarta). Non-root
# (uid 65532, as distroless nonroot was); the deploy script overrides it with
# 1001 to match the shared storage volume. The image grows from about 30 MB
# (distroless static + binaries) to about 150 MB.
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tzdata tesseract-ocr tesseract-ocr-eng tesseract-ocr-ind \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 65532 nonroot \
 && useradd --system --uid 65532 --gid nonroot --no-create-home --shell /usr/sbin/nologin nonroot
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
# No curl here, so the binary probes its own /health. Orchestrators should
# probe HTTP directly: liveness GET /health, readiness GET /ready.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=4 \
    CMD ["/usr/local/bin/api", "-healthcheck"]
ENTRYPOINT ["/usr/local/bin/api"]
