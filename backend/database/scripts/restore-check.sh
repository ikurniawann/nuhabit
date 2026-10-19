#!/usr/bin/env bash
# Proves the newest dump restores: loads it into a scratch database, counts
# rows in core tables, then drops the scratch database. See
# backend/docs/BACKUP.md.
#
#   RESTORE_DATABASE_URL=postgres://... BACKUP_DIR=/var/backups/nuhabit \
#     backend/database/scripts/restore-check.sh [dump-file]
#
# RESTORE_DATABASE_URL  server for the scratch database (role needs CREATEDB);
#                       defaults to DATABASE_URL. The database it names is
#                       only used to run CREATE and DROP DATABASE.
# BACKUP_DIR            where to look for the newest dump when no file is
#                       given, default /var/backups/nuhabit
# BACKUP_PREFIX         dump name prefix, default nuhabit
# RESTORE_CHECK_TABLES  space-separated schema.table list to count
# PG_BIN                directory holding psql and pg_restore (default: PATH)
#
# Exits 1 when the restore fails, a listed table is missing, or
# public.schema_migrations is empty.
set -euo pipefail

# shellcheck source=pg-url.sh
. "$(dirname "$0")/pg-url.sh"

log() { printf '%s restore-check: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

url="${RESTORE_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "$url" ]]; then
  log "set RESTORE_DATABASE_URL or DATABASE_URL"
  exit 2
fi
dir="${BACKUP_DIR:-/var/backups/nuhabit}"
prefix="${BACKUP_PREFIX:-nuhabit}"
tables="${RESTORE_CHECK_TABLES:-public.schema_migrations auth.users configuration.companies configuration.users iam.roles crm.crm_member_profiles gym.class_sessions gym.bookings pos.pos_orders}"
psql="${PG_BIN:+$PG_BIN/}psql"
pg_restore="${PG_BIN:+$PG_BIN/}pg_restore"

dump="${1:-}"
if [[ -z "$dump" ]]; then
  # Names carry a UTC timestamp, so the last one in sort order is the newest.
  dump="$(find "$dir" -maxdepth 1 -type f -name "${prefix}_*.dump" | sort | tail -n 1)"
fi
if [[ -z "$dump" || ! -f "$dump" ]]; then
  log "no dump found (looked for ${prefix}_*.dump in $dir)"
  exit 1
fi

pg_url_split "$url"
admin_db="$(pg_url_dbname "$url")"
admin_url="$(pg_url_for "${admin_db:-postgres}")"
scratch="nuhabit_restore_check_$(date -u +%Y%m%d%H%M%S)_$$"
scratch_url="$(pg_url_for "$scratch")"

drop_scratch() {
  "$psql" "$admin_url" -X -q -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$scratch\" WITH (FORCE)" \
    || log "could not drop scratch database $scratch; drop it by hand"
}

log "restoring $dump into scratch database $scratch"
"$psql" "$admin_url" -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$scratch\""
trap drop_scratch EXIT

start=$SECONDS
# Roles differ between servers, so skip ownership and grants.
if ! "$pg_restore" --no-password --no-owner --no-acl --exit-on-error \
    --dbname="$scratch_url" "$dump"; then
  log "restore failed"
  exit 1
fi
log "restored in $((SECONDS - start)) s"

failed=0
for t in $tables; do
  if [[ "$("$psql" "$scratch_url" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT to_regclass('$t') IS NOT NULL")" != "t" ]]; then
    log "MISSING $t"
    failed=1
    continue
  fi
  n="$("$psql" "$scratch_url" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM $t")"
  printf '%-40s %s\n' "$t" "$n"
  if [[ "$t" == public.schema_migrations && "$n" == 0 ]]; then
    log "public.schema_migrations is empty"
    failed=1
  fi
done
latest="$("$psql" "$scratch_url" -X -A -t -c "SELECT max(filename) FROM public.schema_migrations" 2>/dev/null || true)"
[[ -n "$latest" ]] && printf '%-40s %s\n' "latest migration" "$latest"

if (( failed )); then
  log "FAILED for $dump"
  exit 1
fi
log "OK for $dump"
