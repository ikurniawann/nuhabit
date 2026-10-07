-- Shared request rate limits for the Go backend (internal/platform/ratelimit).
-- The TS limiters keep their counters in each process's memory; with several
-- API replicas every replica would allow the full limit. One row per key
-- holds either a fixed window (count, reset at expires_at) or a sliding
-- window (hits inside the window). Rows past expires_at are pruned.
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.rate_limits (
    key          text PRIMARY KEY,
    count        integer       NOT NULL DEFAULT 0,
    hits         timestamptz[] NOT NULL DEFAULT '{}',
    last_allowed boolean       NOT NULL DEFAULT true,
    expires_at   timestamptz   NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON platform.rate_limits (expires_at);

COMMENT ON TABLE platform.rate_limits IS
  'Rate limit counters shared by every API replica: fixed windows (count) and sliding windows (hits).';
