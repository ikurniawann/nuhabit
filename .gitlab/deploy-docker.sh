#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-host.docker.internal}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
encode_db_pass() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import urllib.parse,os; print(urllib.parse.quote(os.environ["DB_PASS"], safe=""))'
  elif command -v node >/dev/null 2>&1; then
    node -e 'console.log(encodeURIComponent(process.env.DB_PASS))'
  else
    printf '%s' "$DB_PASS" | sed -e 's/%/%25/g' -e 's/@/%40/g' -e 's/!/%21/g' -e 's/\*/%2A/g'
  fi
}

# Dev (arkiv-development) boleh pakai password lama via DB_PASS / DEV_DB_PASS_URLENCODED
# supaya tidak tertukar dengan password postgres produksi.
if [ "${CONTAINER_NAME:-}" = "arkiv-development" ]; then
  if [ -n "${DEV_DB_PASS_URLENCODED:-}" ]; then
    DB_PASS_URLENCODED="$DEV_DB_PASS_URLENCODED"
  elif [ -n "${DB_PASS:-}" ]; then
    DB_PASS_URLENCODED="$(encode_db_pass)"
  else
    DB_PASS_URLENCODED="${DB_PASS_URLENCODED:-}"
  fi
else
  DB_PASS_URLENCODED="${DB_PASS_URLENCODED:-}"
fi
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
BIND_ADDRESS="${BIND_ADDRESS:-0.0.0.0}"

require_var() {
  if [ -z "${!1:-}" ]; then
    echo "Missing required environment variable: $1" >&2
    exit 1
  fi
}

require_var DOCKER_IMAGE
require_var CONTAINER_NAME
require_var HOST_PORT
require_var DATABASE_NAME
require_var STORAGE_DIR
require_var DB_PASS_URLENCODED

# Env runtime + build (NEXT_PUBLIC_*, kunci integrasi) dari CI variable
# RUNTIME_CONFIG_CONTENT, ditulis ke file di host di LUAR checkout dengan mode
# 600. Image tidak pernah memuat .env: build menerimanya sebagai BuildKit
# secret, container lewat --env-file. Tanpa RUNTIME_CONFIG_CONTENT, file yang
# sudah ada dipakai ulang (mis. diisi manual oleh admin).
ENV_FILE="${ENV_FILE:-$HOME/.config/arkiv/${CONTAINER_NAME}.env}"
if [ -n "${RUNTIME_CONFIG_CONTENT:-}" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  # --env-file Docker tidak memahami `export` maupun kutip seperti dotenv:
  # buang prefix export dan satu lapis kutip pembungkus nilai.
  (umask 077 && printf '%s\n' "$RUNTIME_CONFIG_CONTENT" | sed -E \
    -e 's/^[[:space:]]*export[[:space:]]+//' \
    -e 's/^([A-Za-z_][A-Za-z0-9_]*)="(.*)"[[:space:]]*$/\1=\2/' \
    -e "s/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'[[:space:]]*\$/\1=\2/" \
    > "$ENV_FILE")
  chmod 600 "$ENV_FILE"
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "File env tidak ditemukan: $ENV_FILE (set RUNTIME_CONFIG_CONTENT atau ENV_FILE)" >&2
  exit 1
fi

if [ -w /etc/gai.conf ] && ! grep -q 'precedence :ffff:0:0/96' /etc/gai.conf; then
  echo 'precedence :ffff:0:0/96  100' >> /etc/gai.conf
fi

# Unggahan (kontrak bertanda tangan, psikotes, CV, foto member) ditulis ke
# /app/storage di dalam container. Tanpa volume, seluruhnya ikut terhapus setiap
# redeploy karena container dibuat ulang dari image.
#
# Direktori ini disiapkan sekali oleh admin, bukan oleh CI: isinya data pribadi
# sehingga dikunci ke uid 1001 (user nextjs) dengan mode 750 — runner yang jalan
# sebagai user biasa memang tidak boleh menulis ke sana.
#
#   sudo mkdir -p <dir>/uploads <dir>/private
#   sudo chown -R 1001:65533 <dir> && sudo chmod 750 <dir>
if [ ! -d "$STORAGE_DIR" ]; then
  echo "STORAGE_DIR tidak ditemukan: $STORAGE_DIR" >&2
  echo "Siapkan dulu di host (lihat komentar di skrip ini). Deploy dihentikan agar" >&2
  echo "docker tidak membuat direktori kosong milik root dan unggahan gagal lagi." >&2
  exit 1
fi

DATABASE_URL_RUNTIME="postgresql://${DB_USER}:${DB_PASS_URLENCODED}@${DB_HOST}:${DB_PORT}/${DATABASE_NAME}"

# Go API (backend/) jalan di host yang sama, satu Docker network dengan Next.
# Semua route /api sudah di-port ke Go, jadi API aktif secara default dan
# proxy Next meneruskan /api ke sana (BACKEND_URL). BACKEND_ENABLED=0 adalah
# rollback: container API dihentikan dan Next melayani semua route lewat kode
# TS yang masih ada.
BACKEND_ENABLED="${BACKEND_ENABLED:-1}"
NETWORK="${CONTAINER_NAME}-net"
API_CONTAINER="${CONTAINER_NAME}-api"
API_IMAGE="${DOCKER_IMAGE}-api"
# Log json-file Docker tidak dibatasi secara default dan Go mencatat satu baris
# per request: tanpa rotasi, disk host lama-lama penuh.
LOG_OPTS=(--log-opt max-size=50m --log-opt max-file=5)
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK"

# 1. Build kedua image selagi container lama tetap melayani. Tag :previous
#    menunjuk image yang dipakai container yang sedang jalan (bukan :latest,
#    yang bisa berisi build gagal-migrasi yang tidak pernah jalan), untuk
#    rollback tanpa build ulang (lihat backend/docs/DEPLOY.md).
tag_running() {
  local running
  running="$(docker inspect --format '{{.Image}}' "$1" 2>/dev/null)" || return 0
  docker tag "$running" "$2:previous"
}
tag_running "$CONTAINER_NAME" "$DOCKER_IMAGE"
tag_running "$API_CONTAINER" "$API_IMAGE"
# Dockerfile memakai RUN --mount (cache + secret), jadi wajib BuildKit.
docker pull node:22-alpine || true
DOCKER_BUILDKIT=1 docker build --network=host \
  --secret "id=dotenv,src=${ENV_FILE}" \
  -t "$DOCKER_IMAGE:latest" .
# Image API selalu dibangun: binary migrate di dalamnya menjalankan migrasi,
# juga saat BACKEND_ENABLED=0.
DOCKER_BUILDKIT=1 docker build --network=host -t "$API_IMAGE:latest" backend

# 2. Migrasi sebelum container mana pun dihentikan: bila gagal, deploy
#    berhenti dan versi lama tetap jalan. Advisory lock di migrate mencegah
#    dua deploy menerapkan file yang sama. MIGRATE_ON_DEPLOY=0 melewatinya.
run_migrate() {
  docker run --rm --network "$NETWORK" \
    --add-host host.docker.internal:host-gateway \
    -e MIGRATE_DATABASE_URL="$DATABASE_URL_RUNTIME" \
    -e ALLOW_REMOTE_DB=1 \
    --entrypoint /usr/local/bin/migrate \
    "$API_IMAGE:latest" "$@"
}
if [ "${MIGRATE_ON_DEPLOY:-1}" = "1" ]; then
  run_migrate -apply
  # -verify memutar ulang semua migrasi ke database sementara di server yang
  # sama lalu membandingkan katalognya dengan database target. Exit 3 berarti
  # drift (objek dari migrasi hilang atau berbeda): deploy berhenti. Exit lain
  # berarti pemeriksaan tidak bisa jalan (mis. role tanpa CREATEDB) dan hanya
  # dicatat sebagai peringatan. MIGRATE_VERIFY=0 melewatinya.
  if [ "${MIGRATE_VERIFY:-1}" = "1" ]; then
    verify_status=0
    run_migrate -verify || verify_status=$?
    if [ "$verify_status" = "3" ]; then
      echo "Skema database berbeda dari migrasi (daftar di atas). Deploy dihentikan; container lama tetap jalan." >&2
      exit 1
    elif [ "$verify_status" != "0" ]; then
      echo "PERINGATAN: pemeriksaan drift skema tidak bisa dijalankan (exit $verify_status)." >&2
    fi
  fi
fi

# 3. Ganti container: API dulu, supaya Next langsung bisa diarahkan ke sana.
DEGRADED=""
BACKEND_ENV=()
docker stop "$API_CONTAINER" >/dev/null 2>&1 || true
docker rm "$API_CONTAINER" >/dev/null 2>&1 || true
if [ "$BACKEND_ENABLED" = "1" ]; then
  # uid 1001 sama dengan user nextjs: STORAGE_DIR milik 1001 dengan mode 750.
  # public/ Next tidak ikut di image API: foto /products untuk GoFood diambil
  # dari container Next lewat PUBLIC_ORIGIN (satu network). APP_ENV ditulis
  # di sini agar nilai di ENV_FILE tidak bisa mematikan mode produksi.
  # --stop-timeout memberi graceful shutdown (20 detik) waktu menyelesaikan
  # request dan SSE yang masih jalan.
  docker run -d \
    --name "$API_CONTAINER" \
    --restart unless-stopped \
    --stop-timeout 30 \
    "${LOG_OPTS[@]}" \
    --network "$NETWORK" \
    --user 1001:65533 \
    --add-host host.docker.internal:host-gateway \
    -v "${STORAGE_DIR}:/app/storage" \
    --env-file "$ENV_FILE" \
    -e DATABASE_URL="$DATABASE_URL_RUNTIME" \
    -e MIGRATE_DATABASE_URL="$DATABASE_URL_RUNTIME" \
    -e APP_ENV=production \
    -e STORAGE_DIR=/app/storage \
    -e PUBLIC_ORIGIN="http://${CONTAINER_NAME}:${CONTAINER_PORT}" \
    "$API_IMAGE:latest"
  # Tunggu HEALTHCHECK bawaan image (api -healthcheck) menjadi healthy.
  api_ready=""
  for attempt in $(seq 1 30); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$API_CONTAINER" 2>/dev/null)" = "healthy" ]; then
      api_ready=1
      break
    fi
    sleep 2
  done
  if [ -z "$api_ready" ]; then
    DEGRADED="container Go API tidak sehat"
    docker logs --tail 100 "$API_CONTAINER" >&2 || true
    # Hentikan loop restart; container dan log-nya tetap ada untuk diperiksa.
    docker stop "$API_CONTAINER" >/dev/null 2>&1 || true
  else
    BACKEND_ENV=(-e "BACKEND_URL=http://${API_CONTAINER}:8080")
  fi
fi

# NEXT_PUBLIC_* sudah di-inline saat build, jadi tidak diteruskan lagi lewat
# -e. DATABASE_URL di bawah menimpa nilai yang sama di ENV_FILE (bila ada).
start_next() {
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    "${LOG_OPTS[@]}" \
    --network "$NETWORK" \
    -p "${BIND_ADDRESS}:${HOST_PORT}:${CONTAINER_PORT}" \
    --add-host host.docker.internal:host-gateway \
    -v "${STORAGE_DIR}:/app/storage" \
    --env-file "$ENV_FILE" \
    -e DATABASE_URL="$DATABASE_URL_RUNTIME" \
    -e MIGRATE_DATABASE_URL="$DATABASE_URL_RUNTIME" \
    -e NODE_ENV=production \
    "$@" \
    "$DOCKER_IMAGE:latest" >/dev/null
  for attempt in $(seq 1 30); do
    if curl -fsSL "http://127.0.0.1:${HOST_PORT}/login" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  echo "Application did not become ready on port ${HOST_PORT}" >&2
  docker logs --tail 100 "$CONTAINER_NAME" >&2 || true
  return 1
}
start_next ${BACKEND_ENV[@]+"${BACKEND_ENV[@]}"}

# 4. Pastikan proxy Next benar-benar sampai ke Go: hanya Go yang memasang
#    X-Request-Id. Bila tidak, Next dijalankan ulang tanpa BACKEND_URL agar
#    TS melayani semua route, dan deploy ditandai gagal supaya terlihat.
if [ ${#BACKEND_ENV[@]} -gt 0 ] &&
  ! curl -s -o /dev/null -D - "http://127.0.0.1:${HOST_PORT}/api/auth/me" | grep -qi '^x-request-id:'; then
  DEGRADED="proxy Next tidak meneruskan /api ke Go"
  docker logs --tail 50 "$CONTAINER_NAME" >&2 || true
  start_next
fi

if [ -n "$DEGRADED" ]; then
  echo "Deploy selesai TANPA Go API (${DEGRADED}): Next melayani semua route. Perbaiki lalu deploy ulang." >&2
  exit 1
fi
