-- EPIC-047 Fase 3 — jahitan "stock opname per SKU".
--
-- Ditunda dari Fase 1C sub-step 3 (lihat header
-- 20260910120000_production_variant_output.sql §Acceptance & epic §"Tidak
-- termasuk"). Sampai hari ini, stock opname produk
-- (`inventory.product_stock_opname_lines`) menghitung fisik HANYA di level
-- produk (`finished_goods_inventory`) — produk merchandise ber-varian
-- (mis. KAOS-001, 16 SKU ukuran x warna) tidak punya baris opname per SKU,
-- padahal stok fisiknya tersebar di `pos.pos_product_skus.stock_quantity`
-- sejak EPIC-039 Fase B, dan produksi (Fase 1B) + GRN (Fase 2) sudah
-- memposting ke situ. Tanpa kolom ini, opname KAOS-001 hanya mencocokkan
-- total produk, buta terhadap selisih per ukuran/warna.
--
-- Migration ini menambah SATU kolom nullable — tanpa cascade, sama seperti
-- pola `purchase_order_items.pos_sku_id` / `grn_items.pos_sku_id`
-- (20260910233939_grn_variant_sku.sql): baris opname produk TANPA varian
-- (mayoritas F&B/operasional, dan produk apparel tanpa matriks SKU) tetap
-- NULL dan jalur lama byte-identical. Guard "produk ber-varian wajib
-- pos_sku_id per baris (bukan campur baris level-produk)" hidup di kode
-- (listProductInventoryForOpname / complete route), bukan di database.
--
-- Idempoten (IF NOT EXISTS), dev-only, mengikuti konvensi
-- 20260910233939_grn_variant_sku.sql.

ALTER TABLE inventory.product_stock_opname_lines
  ADD COLUMN IF NOT EXISTS pos_sku_id uuid REFERENCES pos.pos_product_skus(id);
CREATE INDEX IF NOT EXISTS idx_product_stock_opname_lines_pos_sku_id
  ON inventory.product_stock_opname_lines (pos_sku_id)
  WHERE pos_sku_id IS NOT NULL;
