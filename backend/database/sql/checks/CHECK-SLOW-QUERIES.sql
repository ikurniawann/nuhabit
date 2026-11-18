-- =============================================================================
-- Slowest statements from pg_stat_statements. Read-only.
--
-- Needs the extension (see backend/docs/DEPLOY.md, "Finding slow queries"):
--   shared_preload_libraries = 'pg_stat_statements'   -- postgresql.conf, restart
--   CREATE EXTENSION IF NOT EXISTS pg_stat_statements; -- once, as a superuser
--
-- Run: psql "$DATABASE_URL" -f backend/database/sql/checks/CHECK-SLOW-QUERIES.sql
-- Counters accumulate since the last reset; to measure a fresh window run
--   SELECT pg_stat_statements_reset();
-- as a superuser, wait for traffic, then run this file.
-- =============================================================================

\echo '== Top 20 by total time (where the database spends its time) =='
SELECT round(total_exec_time::numeric / 1000, 1) AS total_s,
       calls,
       round(mean_exec_time::numeric, 1) AS mean_ms,
       round(max_exec_time::numeric, 1) AS max_ms,
       round((100 * total_exec_time / NULLIF(sum(total_exec_time) OVER (), 0))::numeric, 1) AS pct,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
 ORDER BY total_exec_time DESC
 LIMIT 20;

\echo '== Top 20 by mean time, at least 20 calls (slow every time) =='
SELECT round(mean_exec_time::numeric, 1) AS mean_ms,
       round(max_exec_time::numeric, 1) AS max_ms,
       calls,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
   AND calls >= 20
 ORDER BY mean_exec_time DESC
 LIMIT 20;

\echo '== Top 20 by calls (candidates for caching or batching) =='
SELECT calls,
       round(total_exec_time::numeric / 1000, 1) AS total_s,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
 ORDER BY calls DESC
 LIMIT 20;
