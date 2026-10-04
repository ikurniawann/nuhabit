-- =============================================================================
-- v_products_cogs: hormati satuan baris BOM (besar vs kecil)
--
-- View lama selalu ÷ konversi_factor (asumsi qty selalu satuan kecil). Demo BOM
-- dan editor bisa menyimpan qty dalam satuan besar (KG/L), sehingga HPP undercount.
-- Sekarang: jika satuan BOM = satuan besar bahan → pakai avg_cost utuh;
--           jika satuan kecil (atau default) → avg_cost / konversi.
-- =============================================================================

-- CREATE OR REPLACE preserves owner/ACLs better than DROP+CREATE.
CREATE OR REPLACE VIEW "public"."v_products_cogs" AS
 SELECT p.id,
    p.kode,
    p.nama,
    p.deskripsi,
    p.kategori,
    p.satuan_id,
    p.harga_jual,
    p.is_active,
    p.created_at,
    p.updated_at,
    p.created_by,
    p.updated_by,
    p.deleted_at,
    p.deleted_by,
    u.nama AS satuan_nama,
    COALESCE(bom.total_bahan, 0::bigint) AS total_bahan_baku,
    COALESCE(bom.estimated_cogs, 0::numeric) AS estimated_cogs,
    COALESCE(bom.estimated_cogs, 0::numeric) AS hpp_estimasi,
    p.harga_modal,
    p.markup_persen,
    p.company_id,
    p.branch_id,
    p.warehouse_id,
    wh.name AS warehouse_name,
    wh.code AS warehouse_code,
    p.production_output_type
   FROM item.products p
     LEFT JOIN item.units u ON p.satuan_id = u.id
     LEFT JOIN configuration.warehouses wh ON wh.id = p.warehouse_id
     LEFT JOIN (
       SELECT bi.product_id,
              count(*) AS total_bahan,
              sum(
                bi.qty_required
                * (1::numeric + COALESCE(bi.waste_factor, 0::numeric))
                * (
                    CASE
                      WHEN bi.satuan_id IS NOT NULL
                           AND vrs.satuan_besar_id IS NOT NULL
                           AND bi.satuan_id = vrs.satuan_besar_id
                        THEN COALESCE(vrs.avg_cost, 0::numeric)
                      WHEN vrs.satuan_kecil_id IS NOT NULL
                           AND COALESCE(vrs.konversi_factor, 0::numeric) > 0::numeric
                        THEN COALESCE(vrs.avg_cost, 0::numeric) / vrs.konversi_factor
                      ELSE COALESCE(vrs.avg_cost, 0::numeric)
                    END
                  )
              ) AS estimated_cogs
         FROM manufacturing.bom_items bi
         LEFT JOIN v_raw_materials_stock vrs ON vrs.id = bi.raw_material_id
        WHERE bi.is_active = true
        GROUP BY bi.product_id
     ) bom ON p.id = bom.product_id
  WHERE p.deleted_at IS NULL;

-- Perbaiki satuan BOM demo yang tidak cocok dengan master bahan (ML vs GR)
UPDATE manufacturing.bom_items bi
SET satuan_id = rm.satuan_kecil_id,
    updated_at = now()
FROM item.raw_materials rm
WHERE bi.raw_material_id = rm.id
  AND bi.is_active = true
  AND rm.kode IN ('BB-SAUS-007', 'BB-SAUS-008')
  AND rm.satuan_kecil_id IS NOT NULL
  AND bi.satuan_id IS DISTINCT FROM rm.satuan_kecil_id
  AND bi.satuan_id IS DISTINCT FROM rm.satuan_besar_id;

-- Ownership/grants (DROP+CREATE previously left migrate-role owner → permission denied)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arkiv') THEN
    EXECUTE 'ALTER VIEW public.v_products_cogs OWNER TO arkiv';
    EXECUTE 'GRANT SELECT ON TABLE public.v_products_cogs TO arkiv';
  END IF;
END $$;
GRANT SELECT ON TABLE public.v_products_cogs TO authenticated;
GRANT SELECT ON TABLE public.v_products_cogs TO service_role;
