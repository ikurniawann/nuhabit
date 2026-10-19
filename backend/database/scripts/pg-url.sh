# Sourced by backup.sh and restore-check.sh; not meant to run on its own.
#
# pg_url_split URL moves the password of a postgres:// URL into PGPASSWORD
# and sets PG_URL_BASE (the URL without password and database) and
# PG_URL_QUERY (the "?..." part, or empty). pg_dump and psql then get a URL
# without the password on their command line, where `ps` would show it.

pg_url_decode() {
  local s="${1//\\/\\\\}"
  printf '%b' "${s//%/\\x}"
}

pg_url_split() {
  local url="$1" scheme rest authority path userinfo hostport user pass
  case "$url" in
    postgres://* | postgresql://*) ;;
    *) echo "DATABASE_URL must start with postgres:// or postgresql://" >&2; return 1 ;;
  esac
  scheme="${url%%://*}"
  rest="${url#*://}"
  authority="${rest%%[/?]*}"
  path="${rest:${#authority}}"
  PG_URL_QUERY=""
  if [[ "$path" == *\?* ]]; then
    # libpq rejects the pgx-only settings (pool_max_conns and friends).
    local param params=() kept=()
    IFS='&' read -r -a params <<<"${path#*\?}"
    for param in ${params[@]+"${params[@]}"}; do
      case "${param%%=*}" in
        pool_* | statement_cache_capacity | description_cache_capacity | default_query_exec_mode) ;;
        "") ;;
        *) kept+=("$param") ;;
      esac
    done
    if (( ${#kept[@]} )); then
      PG_URL_QUERY="?$(IFS='&'; printf '%s' "${kept[*]}")"
    fi
  fi
  if [[ "$PG_URL_QUERY" == *password=* ]]; then
    echo "put the password in the userinfo part of the URL, not in ?password=" >&2
    return 1
  fi
  if [[ "$authority" == *@* ]]; then
    userinfo="${authority%@*}"
    hostport="${authority##*@}"
    if [[ "$userinfo" == *:* ]]; then
      user="${userinfo%%:*}"
      pass="${userinfo#*:}"
      PGPASSWORD="$(pg_url_decode "$pass")"
      export PGPASSWORD
      authority="$user@$hostport"
    fi
  fi
  PG_URL_BASE="$scheme://$authority"
}

# pg_url_for DB prints the password-free URL of database DB on the same server.
pg_url_for() {
  printf '%s/%s%s' "$PG_URL_BASE" "$1" "$PG_URL_QUERY"
}

# pg_url_dbname URL prints the database part of URL (empty when absent).
pg_url_dbname() {
  local rest="${1#*://}" path
  path="${rest#"${rest%%[/?]*}"}"
  path="${path#/}"
  pg_url_decode "${path%%\?*}"
}
