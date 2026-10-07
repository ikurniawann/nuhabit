-- =============================================================================
-- v_finished_goods_stock: tampilkan SEMUA produk (driven dari item.products),
-- bukan hanya yang punya baris finished_goods_inventory. Stok 0 bila belum ada.
--   - LEFT JOIN finished_goods_inventory (hanya baris aktif)
--   - unit_cost fallback ke harga_modal produk agar HPP tidak 0
--   - expose company_id/branch_id untuk filter scope
-- =============================================================================

DROP VIEW IF EXISTS "public"."v_finished_goods_stock";

CREATE VIEW "public"."v_finished_goods_stock" AS
 SELECT p.id,
    p.id AS product_id,
    COALESCE(fgi.qty_available, 0::numeric) AS qty_available,
    COALESCE(NULLIF(fgi.unit_cost, 0::numeric), p.harga_modal, 0::numeric) AS unit_cost,
    fgi.last_movement_at,
    p.is_active,
    fgi.created_by,
    fgi.updated_by,
    COALESCE(fgi.created_at, p.created_at) AS created_at,
    COALESCE(fgi.updated_at, p.updated_at) AS updated_at,
    p.kode AS product_kode,
    p.nama AS product_nama,
    p.kategori AS product_kategori,
    p.harga_jual,
    COALESCE(fgi.qty_available, 0::numeric)
      * COALESCE(NULLIF(fgi.unit_cost, 0::numeric), p.harga_modal, 0::numeric) AS total_value,
    u.nama AS satuan_nama,
    p.company_id,
    p.branch_id
   FROM products p
     LEFT JOIN finished_goods_inventory fgi
       ON fgi.product_id = p.id AND fgi.is_active = true
     LEFT JOIN units u ON u.id = p.satuan_id
  WHERE p.deleted_at IS NULL
    AND p.is_active = true;
