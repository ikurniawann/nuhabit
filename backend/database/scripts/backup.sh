#!/usr/bin/env bash
# Dumps the database in DATABASE_URL to BACKUP_DIR in pg_dump custom format,
# deletes dumps older than BACKUP_KEEP days and runs BACKUP_UPLOAD_CMD on the
# new file. Schedule, off-host copy and restore: backend/docs/BACKUP.md.
#
#   DATABASE_URL=postgres://... BACKUP_DIR=/var/backups/nuhabit \
#     backend/database/scripts/backup.sh
#
# DATABASE_URL       required; read from the environment only
# BACKUP_DIR         default /var/backups/nuhabit (created with mode 700)
# BACKUP_KEEP        days to keep local dumps, default 14
# BACKUP_PREFIX      file name prefix, default nuhabit
# BACKUP_UPLOAD_CMD  optional shell command; gets the dump path as $1 and in
#                    BACKUP_FILE, e.g. 'rclone copy "$1" offsite:nuhabit/'
# PG_BIN             directory holding pg_dump (default: PATH); its major
#                    version must be at least the server's
#
# The password never reaches the command line or the output: it moves from
# the URL into PGPASSWORD. Exits non-zero when the dump, the retention sweep
# or the upload fails; a failed upload keeps the local dump.
set -euo pipefail
umask 077

# shellcheck source=pg-url.sh
. "$(dirname "$0")/pg-url.sh"

log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

if [[ -z "${DATABASE_URL:-}" ]]; then
  log "DATABASE_URL is not set"
  exit 2
fi
dir="${BACKUP_DIR:-/var/backups/nuhabit}"
keep="${BACKUP_KEEP:-14}"
prefix="${BACKUP_PREFIX:-nuhabit}"
pg_dump="${PG_BIN:+$PG_BIN/}pg_dump"
if ! [[ "$keep" =~ ^[0-9]+$ ]] || (( keep < 1 )); then
  log "BACKUP_KEEP must be a whole number of days, at least 1"
  exit 2
fi

pg_url_split "$DATABASE_URL"
dbname="$(pg_url_dbname "$DATABASE_URL")"
if [[ -z "$dbname" ]]; then
  log "DATABASE_URL names no database"
  exit 2
fi

mkdir -p "$dir"
chmod 700 "$dir"
file="$dir/${prefix}_$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$file.partial"
trap 'rm -f "$partial"' EXIT

log "dumping database $dbname to $file"
start=$SECONDS
if ! "$pg_dump" --format=custom --compress=6 --no-password \
    --file="$partial" --dbname="$(pg_url_for "$dbname")"; then
  log "pg_dump failed"
  exit 1
fi
# A dump that pg_restore cannot list is useless; catch it now, not at restore.
if ! "${PG_BIN:+$PG_BIN/}pg_restore" --list "$partial" >/dev/null; then
  log "pg_restore cannot read the new dump"
  exit 1
fi
mv "$partial" "$file"
log "wrote $(du -h "$file" | cut -f1) in $((SECONDS - start)) s"

# find rounds the age down to whole days, so +(KEEP-1) matches dumps at least
# KEEP*24 h old.
find "$dir" -maxdepth 1 -type f -name "${prefix}_*.dump" -mtime +"$((keep - 1))" -print -delete \
  | while read -r old; do log "deleted $old"; done

if [[ -n "${BACKUP_UPLOAD_CMD:-}" ]]; then
  log "uploading"
  if ! BACKUP_FILE="$file" sh -c "$BACKUP_UPLOAD_CMD" backup-upload "$file"; then
    log "upload failed; the local dump stays at $file"
    exit 1
  fi
  log "upload done"
fi
