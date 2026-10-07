-- EPIC-047 Fase 2 — jahitan "GRN per varian (beli barang jadi dari vendor)".
--
-- Sampai hari ini, GRN produk (belanja barang jadi dari vendor) memposting
-- stok LEVEL PRODUK lewat public.pos_receive_merchandise_stock — dan fungsi
-- itu sendiri (§6, 20260802150000_pos_merchandise_skus.sql) SENGAJA
-- me-return 0 tanpa menulis apa pun bila produk POS-nya punya SKU aktif,
-- dengan komentar "per-varian GRN = fase lanjut". Akibatnya: beli KAOS-001
-- (16 varian ukuran x warna) lewat GRN hari ini DIAM-DIAM tidak menambah
-- stok SKU mana pun — bukan error, bukan warning yang terlihat user, cuma
-- log server. Migration ini membuka jahitan itu:
--
-- 1. `purchasing.purchase_order_items.pos_sku_id` — baris PO produk ber-varian
--    memilih SKU spesifik (S-Merah, M-Hitam, dst), bukan cuma product_id.
-- 2. `purchasing.grn_items.pos_sku_id` — GRN mewarisi SKU dari PO item saat
--    diterima (lihat src/lib/purchasing/grn-qc.ts), supaya QC tahu SKU mana
--    yang stoknya harus naik.
-- 3. `public.pos_receive_merchandise_sku_stock(p_sku_id, p_qty)` — versi
--    per-SKU dari `pos_receive_merchandise_stock`, menaikkan
--    `pos.pos_product_skus.stock_quantity` langsung (SKU sudah punya
--    identitas stok sendiri sejak EPIC-039 Fase B). TIDAK menggerbang pada
--    `pos_products.inventory_tracking` produk induk — SKU memegang stoknya
--    sendiri, sama seperti `pos_sell_merchandise_sku_stock` yang sudah ada
--    (fungsi jual per-SKU) tidak menggerbang di situ juga.
--
-- Guard "GRN produk ber-varian WAJIB pos_sku_id" hidup di kode
-- (submitGrnQcInspection), bukan di database — kolom di sini tetap nullable
-- supaya produk TANPA varian (mayoritas F&B/operasional) tidak terpengaruh
-- sama sekali.
--
-- Idempoten (IF NOT EXISTS), tanpa ON DELETE CASCADE pada FK pos_sku_id
-- (riwayat pembelian tidak boleh hilang otomatis kalau SKU-nya suatu saat
-- dihapus — dev belum ada jalur hapus SKU, tapi berjaga-jaga).

ALTER TABLE purchasing.purchase_order_items
  ADD COLUMN IF NOT EXISTS pos_sku_id uuid REFERENCES pos.pos_product_skus(id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_pos_sku_id
  ON purchasing.purchase_order_items (pos_sku_id)
  WHERE pos_sku_id IS NOT NULL;

ALTER TABLE purchasing.grn_items
  ADD COLUMN IF NOT EXISTS pos_sku_id uuid REFERENCES pos.pos_product_skus(id);
CREATE INDEX IF NOT EXISTS idx_grn_items_pos_sku_id
  ON purchasing.grn_items (pos_sku_id)
  WHERE pos_sku_id IS NOT NULL;

-- Terima (tambah) stok SKU merchandise dari GRN. Mirror
-- pos_sell_merchandise_sku_stock (jual/kurangi) — sama-sama tidak
-- menggerbang pada inventory_tracking produk induk, SKU aktif sudah cukup.
-- p_qty <= 0 = no-op (0 baris ter-update), dipanggil hanya untuk qty
-- positif dari grn-qc.ts.
CREATE OR REPLACE FUNCTION public.pos_receive_merchandise_sku_stock(
  p_sku_id uuid,
  p_qty numeric
)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN 0;
  END IF;

  UPDATE pos.pos_product_skus
  SET stock_quantity = COALESCE(stock_quantity, 0) + p_qty,
      updated_at = now()
  WHERE id = p_sku_id
    AND is_active = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;
