#!/usr/bin/env bash
# Local PostgreSQL for NüHabit on port 55432, in its own data directory so it
# never collides with the Homebrew cluster on 5432.
#
#   backend/database/scripts/local-pg.sh init     # once: initdb + create database nuhabit
#   backend/database/scripts/local-pg.sh start
#   backend/database/scripts/local-pg.sh stop
#   backend/database/scripts/local-pg.sh status
#
# After init, apply the schema and the base seeders:
#   pnpm db:migrate:apply
#   cd backend/database && for s in business-hierarchy business-stalls hris-master-data \
#     iam-menus iam-admin-permissions iam-role-permissions; do node seeders/$s.js; done
#   node backend/database/scripts/create-local-super-user.js
set -euo pipefail

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
PGDATA="${NUHABIT_PGDATA:-$HOME/.local/share/nuhabit-pg17}"
PORT="${NUHABIT_PGPORT:-55432}"
# macOS launches postgres multithreaded without a locale, which it refuses.
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

case "${1:-}" in
  init)
    if [ -f "$PGDATA/PG_VERSION" ]; then
      echo "already initialised: $PGDATA"
    else
      "$PG_BIN/initdb" -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 >/dev/null
      echo "initialised $PGDATA"
    fi
    "$0" start
    "$PG_BIN/psql" "postgres://postgres@localhost:$PORT/postgres" -qtc "SELECT 1 FROM pg_database WHERE datname = 'nuhabit'" | grep -q 1 \
      || "$PG_BIN/createdb" -h localhost -p "$PORT" -U postgres nuhabit
    # The migrations reference these roles; GitHub CI creates them the same way.
    "$PG_BIN/psql" "postgres://postgres@localhost:$PORT/nuhabit" -qc "DO \$\$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END \$\$;"
    echo "database nuhabit ready on :$PORT"
    ;;
  start)
    if "$PG_BIN/pg_isready" -h localhost -p "$PORT" -q; then
      echo "already running on :$PORT"
    else
      "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -o "-p $PORT" start >/dev/null
      echo "started on :$PORT"
    fi
    ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$PGDATA" stop >/dev/null && echo "stopped"
    ;;
  status)
    "$PG_BIN/pg_isready" -h localhost -p "$PORT"
    ;;
  *)
    echo "usage: $0 init|start|stop|status" >&2
    exit 2
    ;;
esac
