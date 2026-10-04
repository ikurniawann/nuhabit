-- Saklar fitur loyalty per instance (owner 2026-09-28): ARK Coin dan XP bisa
-- dinonaktifkan dari CRM → Pengaturan. Nonaktif = hilang dari menu & kasir,
-- API pemakai saldo ARK menolak; data tidak dihapus.
--
-- PUT /api/crm/settings hanya meng-UPDATE key yang sudah ada, jadi baris
-- harus dibuat di sini. Default TRUE = perilaku lama instance yang sudah jalan.
INSERT INTO crm.crm_settings (key, value, description)
VALUES
  ('ark_coin_enabled', 'true', 'Aktifkan fitur ARK Coin (saldo member, topup, metode bayar ARK Coin)'),
  ('xp_enabled', 'true', 'Aktifkan fitur XP (level, badge, avatar, reward, produk khusus min XP)')
ON CONFLICT (key) DO NOTHING;
