-- EPIC-047 Fase 3 — follow-up wajib untuk 20260911081906_opname_variant_sku.sql.
--
-- Ditemukan saat verifikasi fungsional (POST /api/inventory/product-stock-opnames
-- untuk gudang MAIN apparel, produk KAOS-001 16 SKU): constraint lama
-- `product_stock_opname_lines_unique_product` = UNIQUE (product_stock_opname_id,
-- product_id) — dibuat sebelum epic ini, saat SATU produk SELALU SATU baris
-- opname. Begitu preview diekspansi per SKU (migration sebelumnya), produk
-- ber-varian menulis BANYAK baris dengan `product_id` yang SAMA (beda
-- `pos_sku_id`) dalam satu opname → INSERT baris ke-2 dst langsung gagal
-- `duplicate key value violates unique constraint
-- "product_stock_opname_lines_unique_product"` (23505). Constraint ini tidak
-- disebut di temuan awal epic karena baru terlihat begitu jalur ekspansi
-- benar-benar dipakai (bukan cuma preview di memori).
--
-- Perbaikan: pecah constraint lama jadi DUA index unik partial, supaya
-- semantik lama (satu produk = satu baris) tetap utuh persis untuk produk
-- TANPA varian (`pos_sku_id IS NULL`, mayoritas F&B/operasional), sementara
-- produk ber-varian boleh banyak baris asal SKU-nya beda:
-- 1. `(product_stock_opname_id, product_id) WHERE pos_sku_id IS NULL` — jalur
--    lama byte-identical (constraint sama persis untuk baris non-SKU).
-- 2. `(product_stock_opname_id, pos_sku_id) WHERE pos_sku_id IS NOT NULL` —
--    satu SKU maksimal satu baris per opname (SKU sudah unik ke produknya,
--    jadi ini otomatis juga men-scope per produk).
--
-- Idempoten (DROP CONSTRAINT IF EXISTS + CREATE INDEX IF NOT EXISTS), dev.

ALTER TABLE inventory.product_stock_opname_lines
  DROP CONSTRAINT IF EXISTS product_stock_opname_lines_unique_product;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_stock_opname_lines_product_no_sku
  ON inventory.product_stock_opname_lines (product_stock_opname_id, product_id)
  WHERE pos_sku_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_stock_opname_lines_sku
  ON inventory.product_stock_opname_lines (product_stock_opname_id, pos_sku_id)
  WHERE pos_sku_id IS NOT NULL;
