-- Self-order: nomor WhatsApp & nama pemesan wajib (owner 2026-09-28, tanpa
-- OTP). Disimpan terpisah dari customer_id — nomor belum terverifikasi, jadi
-- TIDAK ditautkan ke akun member (XP/ARK hanya lewat login OTP).
ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text;
