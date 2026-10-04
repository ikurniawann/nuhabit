-- =============================================================================
-- EPIC-034 Fase B — penanda produk gift card di katalog POS.
-- =============================================================================
-- Keputusan owner #5 (26 Jul): gift card dijual lewat produk POS BIASA supaya
-- masuk laporan penjualan seperti produk lain — tetapi WAJIB ditandai beda
-- sejak MVP karena uangnya adalah TITIPAN (liability), bukan revenue saat
-- dijual. Penandanya = `product_kind`, mengikuti preseden
-- `ticketing.ticket_products.product_kind` (single|bundle|season_pass).
--
-- Konsekuensi perilaku (ditegakkan di server, bukan di klien):
--   1. Produk `gift_card` boleh dijual dgn nominal bebas/preset (harga
--      diketik kasir), sedangkan produk `regular` harga tetap dari katalog.
--   2. Baris penjualan produk `gift_card` bisa dipisahkan dari revenue biasa
--      di laporan (Fase E merapikan akuntansi liability penuh).
--
-- Idempoten (IF NOT EXISTS + DO guard), atomik (runner BEGIN/COMMIT), dev.
-- =============================================================================

ALTER TABLE pos.pos_products
  ADD COLUMN IF NOT EXISTS product_kind varchar(20) NOT NULL DEFAULT 'regular';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_products_product_kind_check'
  ) THEN
    ALTER TABLE pos.pos_products
      ADD CONSTRAINT pos_products_product_kind_check
      CHECK (product_kind IN ('regular', 'gift_card'));
  END IF;
END $$;

COMMENT ON COLUMN pos.pos_products.product_kind IS
  'regular = produk jualan biasa (revenue saat dijual); gift_card = penjualan '
  'saldo titipan (liability) — nominal diketik kasir, kartu terbit saat lunas '
  '(EPIC-034 Fase B).';

-- Produk gift card jarang dan tidak boleh ketinggalan di query katalog kasir
CREATE INDEX IF NOT EXISTS idx_pos_products_kind
  ON pos.pos_products (product_kind)
  WHERE product_kind <> 'regular';
