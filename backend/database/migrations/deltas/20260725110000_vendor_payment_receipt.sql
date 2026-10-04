-- EPIC-018 Fase B: arsip nota/faktur vendor menempel ke pembayaran.
-- File fisik tersimpan di storage/private/purchasing-receipts (di luar git);
-- kolom ini menyimpan path relatifnya + nama file asli untuk ditampilkan.

ALTER TABLE purchasing.vendor_payments
  ADD COLUMN IF NOT EXISTS receipt_path text,
  ADD COLUMN IF NOT EXISTS receipt_name text;

COMMENT ON COLUMN purchasing.vendor_payments.receipt_path IS
  'Path relatif nota/bukti di storage/private (purchasing-receipts/...)';
