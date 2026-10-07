-- =============================================================================
-- v_products_cogs: estimasi HPP konsisten dengan editor BOM.
--
-- Sebelumnya estimated_cogs hanya memakai unit_cost dari inventory (0 bila belum
-- ada GRN) dan tidak menormalisasi satuan. Sekarang memakai avg_cost dari
-- v_raw_materials_stock (yang sudah fallback ke harga_beli) lalu dinormalisasi ke
-- satuan KECIL (÷ konversi_factor) karena qty BOM dicatat dalam satuan kecil.
-- =============================================================================

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
    p.branch_id
   FROM products p
     LEFT JOIN units u ON p.satuan_id = u.id
     LEFT JOIN ( SELECT bi.product_id,
            count(*) AS total_bahan,
            sum(
                bi.qty_required
                * (1::numeric + COALESCE(bi.waste_factor, 0::numeric))
                * (
                    COALESCE(vrs.avg_cost, 0::numeric)
                    / CASE
                        WHEN vrs.satuan_kecil_id IS NOT NULL AND COALESCE(vrs.konversi_factor, 0::numeric) > 0::numeric
                            THEN vrs.konversi_factor
                        ELSE 1::numeric
                      END
                  )
            ) AS estimated_cogs
           FROM bom_items bi
             LEFT JOIN v_raw_materials_stock vrs ON vrs.id = bi.raw_material_id
          WHERE bi.is_active = true
          GROUP BY bi.product_id) bom ON p.id = bom.product_id
  WHERE p.deleted_at IS NULL;
