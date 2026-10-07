-- Rate limit login yang DURABLE (audit lanjutan 2026-09-17).
--
-- Sebelumnya pembatas laju login hanya in-memory: hilang saat restart dan
-- tidak konsisten bila nanti berjalan multi-instance (satu instance memblokir,
-- instance lain tidak). Tabel ini membuat hitungannya dibagi lewat database.
--
-- Hanya percobaan GAGAL yang dicatat; login sukses menghapus catatan akun itu
-- supaya user sah yang salah ketik beberapa kali tidak ikut terkunci.

CREATE TABLE IF NOT EXISTS auth.login_attempts (
  id bigserial PRIMARY KEY,
  -- email di-lowercase; bukan FK ke users supaya percobaan ke akun yang
  -- tidak ada pun tetap terhitung (dan tidak membocorkan keberadaan akun).
  account_key text NOT NULL,
  ip text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_account
  ON auth.login_attempts (account_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON auth.login_attempts (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created
  ON auth.login_attempts (created_at);

COMMENT ON TABLE auth.login_attempts IS
  'Percobaan login gagal utk rate limit durable; dipangkas berkala (lihat login-throttle.ts).';
