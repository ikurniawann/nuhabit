-- =============================================================================
-- v_finished_goods_stock: tambah satuan_nama untuk halaman Inventory Stock Product.
-- Kolom baru ditambahkan di akhir agar kompatibel dengan CREATE OR REPLACE VIEW.
-- =============================================================================

CREATE OR REPLACE VIEW "public"."v_finished_goods_stock" AS
 SELECT fgi.id,
    fgi.product_id,
    fgi.qty_available,
    fgi.unit_cost,
    fgi.last_movement_at,
    fgi.is_active,
    fgi.created_by,
    fgi.updated_by,
    fgi.created_at,
    fgi.updated_at,
    p.kode AS product_kode,
    p.nama AS product_nama,
    p.kategori AS product_kategori,
    p.harga_jual,
    fgi.qty_available * COALESCE(fgi.unit_cost, 0::numeric) AS total_value,
    u.nama AS satuan_nama
   FROM finished_goods_inventory fgi
     JOIN products p ON p.id = fgi.product_id
     LEFT JOIN units u ON u.id = p.satuan_id
  WHERE fgi.is_active = true;
