-- =============================================================================
-- App auth schema untuk PostgreSQL native
--
-- HARUS jalan PERTAMA: baseline `public` mereferensi auth.users lewat foreign
-- key, jadi schema `auth` + tabel users wajib ada lebih dulu.
--
-- Password disimpan sebagai hash (mis. bcrypt/argon2) — di-handle di app layer.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- auth.users — sumber identitas login aplikasi
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT UNIQUE NOT NULL,
  password_hash      TEXT NOT NULL,
  email_verified_at  TIMESTAMPTZ,
  banned_until       TIMESTAMPTZ,
  last_sign_in_at    TIMESTAMPTZ,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth.users (lower(email));

-- -----------------------------------------------------------------------------
-- auth.sessions — session berbasis cookie/token untuk app
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  user_agent  TEXT,
  ip_address  TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth.sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth.sessions (expires_at);

-- -----------------------------------------------------------------------------
-- Trigger updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_users_updated_at ON auth.users;
CREATE TRIGGER trg_auth_users_updated_at
  BEFORE UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auth.set_updated_at();

DROP TRIGGER IF EXISTS trg_auth_sessions_updated_at ON auth.sessions;
CREATE TRIGGER trg_auth_sessions_updated_at
  BEFORE UPDATE ON auth.sessions
  FOR EACH ROW
  EXECUTE FUNCTION auth.set_updated_at();

-- -----------------------------------------------------------------------------
-- auth.uid() stub
--
-- Beberapa view/function lama mungkin masih memanggil auth.uid().
-- Di Postgres biasa tidak ada konteks JWT; nilai diambil dari runtime setting
-- `app.current_user_id` jika app meng-set-nya, selain itu NULL. Auth context
-- sebenarnya di-handle di application layer (API routes), bukan di RLS.
-- Bisa dihapus jika semua referensi auth.uid() sudah dibersihkan.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$;
