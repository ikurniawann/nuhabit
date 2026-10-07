-- EPIC-042 — dipindahkan dari migrations/013_api_tokens.sql (2026-09-14).
-- Folder migrations/ di akar repo TIDAK dibaca database/scripts/apply-migrations.js,
-- yang hanya memindai database/migrations/. Akibatnya tabel ini tidak pernah
-- dibuat di deploy baru dan pembuatan API token gagal dengan 503.

-- EPIC-042: Open API tokens — akses machine-to-machine (agent OpenClaw dsb.)
-- Token disimpan sebagai hash SHA-256; nilai asli hanya tampil sekali saat
-- dibuat. Setiap token menempel ke satu akun user (service account) sehingga
-- IAM/menu grant tetap berlaku, lalu DIBATASI lagi oleh scopes.

CREATE TABLE IF NOT EXISTS configuration.api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  -- 12 karakter pertama token (setelah prefix) utk identifikasi di UI tanpa
  -- membuka nilai token.
  token_prefix varchar(20) NOT NULL,
  -- Akun user yang "diperankan" token (IAM grant ikut akun ini).
  user_id uuid NOT NULL REFERENCES configuration.users(id) ON DELETE CASCADE,
  -- Scope: '*' = semua; selain itu '<modul>:read' / '<modul>:write',
  -- mis. 'pos:write', 'member:read'.
  scopes text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES configuration.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON configuration.api_tokens(user_id);

-- Audit per request token (fire-and-forget dari aplikasi; dibersihkan berkala
-- bila membesar). Tidak menyimpan body — cukup jejak siapa/apa/kapan/status.
CREATE TABLE IF NOT EXISTS configuration.api_token_request_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_id uuid NOT NULL REFERENCES configuration.api_tokens(id) ON DELETE CASCADE,
  method varchar(10) NOT NULL,
  path text NOT NULL,
  allowed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_token_logs_token
  ON configuration.api_token_request_logs(token_id, created_at DESC);
