-- EPIC-047 Fase 1B — jahitan "produksi selesai → stok per SKU".
--
-- Sampai hari ini, complete production order (cabang FINISHED_GOOD di
-- src/app/api/purchasing/production/orders/[id]/route.ts) berhenti di
-- finished_goods_inventory LEVEL PRODUK dan tidak pernah menyentuh
-- pos.pos_product_skus — walau produknya sudah punya matriks varian
-- (ukuran x warna, Fase 1A). Tabel ini menyimpan RINCIAN pembagian output
-- satu batch produksi ke SKU POS-nya, supaya stok per SKU bisa naik tepat
-- sejumlah yang diposting (bukan cuma total produk).
--
-- Idempoten pada production_batch_id + pos_sku_id: complete dua kali pada
-- production_batch yang sama (batch_number deterministik per order) tidak
-- pernah menggandakan baris atau stok SKU (lihat ON CONFLICT DO NOTHING di
-- route).
--
-- BOM & HPP TIDAK berubah oleh migration ini — production_batches tetap
-- satu baris per produk per batch; tabel ini murni pecahan qty output ke
-- SKU, tidak menyentuh bahan baku / kalkulasi biaya.

CREATE TABLE IF NOT EXISTS manufacturing.production_output_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES manufacturing.production_orders(id) ON DELETE CASCADE,
  production_batch_id uuid NOT NULL REFERENCES manufacturing.production_batches(id) ON DELETE CASCADE,
  pos_sku_id uuid NOT NULL REFERENCES pos.pos_product_skus(id),
  qty numeric(14,2) NOT NULL CHECK (qty > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_batch_id, pos_sku_id)
);
CREATE INDEX IF NOT EXISTS idx_production_output_variants_order
  ON manufacturing.production_output_variants(production_order_id);
CREATE INDEX IF NOT EXISTS idx_production_output_variants_sku
  ON manufacturing.production_output_variants(pos_sku_id);

-- Jejak per-varian di kartu stok produk jadi (inventory.finished_goods_movements)
-- — baris level produk yang sudah ada TETAP jadi sumber kebenaran total
-- persediaan; kolom ini opsional, hanya diisi untuk baris rincian varian.
ALTER TABLE inventory.finished_goods_movements
  ADD COLUMN IF NOT EXISTS pos_sku_id uuid REFERENCES pos.pos_product_skus(id);
CREATE INDEX IF NOT EXISTS idx_fgm_pos_sku_id
  ON inventory.finished_goods_movements(pos_sku_id)
  WHERE pos_sku_id IS NOT NULL;
