-- Notifikasi pesanan masuk (owner 2026-09-28): setiap pesanan self-order
-- dikirim ke WA karyawan ber-role POS (nomor dari hris.employees.phone) dan
-- ke chat Telegram yang menekan /start di bot BCD Coffee.
--
-- Username bot bisa ditemukan siapa saja, jadi chat baru berstatus 'pending'
-- dan baru menerima notifikasi setelah disetujui admin (Settings → Notifikasi
-- WA → Notifikasi pesanan masuk). Konfigurasi di configuration.app_settings
-- (order_alert_config, telegram_bot_token, telegram_webhook_secret,
-- telegram_bot_username).
CREATE TABLE IF NOT EXISTS configuration.telegram_subscribers (
  chat_id bigint PRIMARY KEY,
  chat_type text NOT NULL DEFAULT 'private',
  title text,
  username text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'stopped')),
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
