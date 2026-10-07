-- =============================================================================
-- Raw materials: simpan kode Chart of Accounts per pemakaian
--   coa_production — pemakaian produksi (COGS)
--   coa_rnd        — riset & pengembangan
--   coa_asset      — inventori / aset (default dari kategori Market List)
--
-- Kode mengacu accounting.chart_of_accounts.code (contoh: 1301001).
-- Enum lama `coa` (PRODUCTION|RND|ASSET) tetap ada untuk kompatibilitas.
-- =============================================================================

ALTER TABLE item.raw_materials
  ADD COLUMN IF NOT EXISTS coa_production varchar(20),
  ADD COLUMN IF NOT EXISTS coa_rnd varchar(20),
  ADD COLUMN IF NOT EXISTS coa_asset varchar(20);

COMMENT ON COLUMN item.raw_materials.coa_production IS
  'Kode akun COA untuk pemakaian produksi (mis. 5101001)';
COMMENT ON COLUMN item.raw_materials.coa_rnd IS
  'Kode akun COA untuk pemakaian riset & pengembangan';
COMMENT ON COLUMN item.raw_materials.coa_asset IS
  'Kode akun COA inventori/aset (mis. 1301001 Inv - ST Dry Goods)';

CREATE INDEX IF NOT EXISTS idx_raw_materials_coa_asset
  ON item.raw_materials (coa_asset)
  WHERE deleted_at IS NULL AND coa_asset IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raw_materials_coa_production
  ON item.raw_materials (coa_production)
  WHERE deleted_at IS NULL AND coa_production IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Refresh v_raw_materials_stock agar kolom COA ikut terbaca di list/detail
-- (basis: 20260628260000_raw_materials_harga_beli.sql + kolom baru)
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
    rm.harga_beli,
    rm.coa,
    rm.coa_production,
    rm.coa_rnd,
    rm.coa_asset
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
