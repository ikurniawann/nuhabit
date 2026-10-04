-- Preferensi desktop Arkiv OS per pengguna (wallpaper, widget, suara, periode).
-- Sebelumnya hanya di localStorage: ganti perangkat = tampilan kembali ke nol.

CREATE TABLE IF NOT EXISTS configuration.user_desktop_prefs (
  user_id uuid PRIMARY KEY REFERENCES configuration.users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE configuration.user_desktop_prefs IS
  'Preferensi desktop Arkiv OS per user; localStorage hanya cache render pertama.';
