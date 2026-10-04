-- Static QRIS self-order (owner 2026-09-28): pemesan scan gambar QRIS statis
-- venue (bukan QR dinamis Xendit), lalu mengunggah bukti bayar. Kasir
-- memverifikasi bukti itu sebelum melunasi order secara manual.
--
-- Berkas bukti disimpan di storage/private (bukan bucket publik); kolom ini
-- hanya menyimpan path relatifnya. Konfigurasi gambar QRIS & saklar aktif ada
-- di configuration.app_settings (static_qris_enabled, static_qris_image_url).
ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS payment_proof_path text,
  ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at timestamptz;
