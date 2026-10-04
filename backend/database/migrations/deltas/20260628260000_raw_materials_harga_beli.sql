-- =============================================================================
-- Harga beli master pada bahan baku
--   item.raw_materials → harga_beli (perkiraan harga beli per satuan besar)
--
-- Harga aktual tetap dihitung dari penerimaan (avg_cost inventory). harga_beli
-- dipakai sebagai harga acuan/fallback agar bahan tidak ber-harga 0 sebelum ada
-- transaksi pembelian (PO/GRN).
-- =============================================================================

ALTER TABLE item.raw_materials
    ADD COLUMN IF NOT EXISTS harga_beli numeric NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- v_raw_materials_stock:
--   - avg_cost fallback ke harga_beli bila belum ada unit_cost dari inventory
--   - tambah kolom harga_beli (di akhir, kompatibel CREATE OR REPLACE)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW "public"."v_raw_materials_stock" AS
 SELECT rm.id,
    rm.kode,
    rm.nama,
    rm.kategori,
    rm.deskripsi,
    rm.satuan_besar_id,
    rm.satuan_kecil_id,
    rm.konversi_factor,
    rm.stok_minimum,
    rm.stok_maximum,
    rm.shelf_life_days,
    rm.storage_condition,
    rm.is_active,
    rm.created_at,
    rm.updated_at,
    rm.created_by,
    rm.updated_by,
    u1.nama AS satuan_besar_nama,
    u2.nama AS satuan_kecil_nama,
    COALESCE(i.qty_available, 0::numeric) AS qty_onhand,
    0 AS qty_reserved,
    COALESCE(i.qty_on_order, 0::numeric) AS qty_on_order,
    COALESCE(NULLIF(i.unit_cost, 0::numeric), rm.harga_beli, 0::numeric) AS avg_cost,
        CASE
            WHEN COALESCE(i.qty_available, 0::numeric) <= 0::numeric THEN 'HABIS'::text
            WHEN COALESCE(i.qty_available, 0::numeric) <= COALESCE(i.qty_minimum, rm.stok_minimum, 0::numeric) THEN 'MENIPIS'::text
            ELSE 'AMAN'::text
        END AS status_stok,
    COALESCE(rm.material_type, 'PURCHASED'::character varying) AS material_type,
    rm.source_product_id,
    rm.deleted_at,
    rm.deleted_by,
    u1.nama AS satuan,
    COALESCE(i.lokasi_rak, '-'::character varying) AS lokasi_rak,
    COALESCE(i.qty_minimum, rm.stok_minimum, 0::numeric) AS min_stock,
    COALESCE(i.qty_maximum, rm.stok_maximum) AS max_stock,
    COALESCE(NULLIF(i.unit_cost, 0::numeric), rm.harga_beli, 0::numeric) AS unit_cost,
    COALESCE(i.qty_available, 0::numeric) * COALESCE(i.unit_cost, 0::numeric) AS total_value,
    rm.company_id,
    rm.branch_id,
    rm.harga_beli
   FROM raw_materials rm
     LEFT JOIN units u1 ON rm.satuan_besar_id = u1.id
     LEFT JOIN units u2 ON rm.satuan_kecil_id = u2.id
     LEFT JOIN ( SELECT inv.raw_material_id,
            sum(inv.qty_available) AS qty_available,
            sum(inv.qty_on_order) AS qty_on_order,
                CASE
                    WHEN sum(inv.qty_available) > 0::numeric
                        THEN sum(inv.qty_available * COALESCE(inv.unit_cost, 0::numeric)) / sum(inv.qty_available)
                    ELSE avg(inv.unit_cost)
                END AS unit_cost,
            min(inv.qty_minimum) AS qty_minimum,
            max(inv.qty_maximum) AS qty_maximum,
            (array_agg(inv.lokasi_rak ORDER BY inv.qty_available DESC))[1] AS lokasi_rak
           FROM inventory inv
          WHERE inv.is_active = true
          GROUP BY inv.raw_material_id) i ON rm.id = i.raw_material_id
  WHERE rm.deleted_at IS NULL;
