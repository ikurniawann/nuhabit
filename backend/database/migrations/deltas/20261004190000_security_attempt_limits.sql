-- Batas percobaan gagal yang DURABLE untuk rahasia pendek (audit keamanan
-- 2026-10-04): PIN supervisor POS (void/merge) dan PIN link berbagi Dataroom.
--
-- Satu baris per (scope, subject), mis. ('pos_supervisor_pin', 'user:<uuid>')
-- atau ('dataroom_share_pin', 'share:<uuid>'). Hitungan bertahan melewati
-- restart dan dibagi antar-instance. Aturannya ada di
-- src/lib/security/attempt-limit.ts.

CREATE TABLE IF NOT EXISTS auth.attempt_limits (
  scope text NOT NULL,
  subject text NOT NULL,
  failures integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject)
);

CREATE INDEX IF NOT EXISTS idx_attempt_limits_updated
  ON auth.attempt_limits (updated_at);

COMMENT ON TABLE auth.attempt_limits IS
  'Hitungan percobaan gagal + kunci sementara per scope/subject (PIN supervisor POS, PIN share Dataroom).';
