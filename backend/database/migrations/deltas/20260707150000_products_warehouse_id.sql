-- =============================================================================
-- Products: mandatory stall (warehouse_id) per product
-- =============================================================================

ALTER TABLE item.products
    ADD COLUMN IF NOT EXISTS warehouse_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_warehouse_id_fkey'
    ) THEN
        ALTER TABLE item.products
            ADD CONSTRAINT products_warehouse_id_fkey
            FOREIGN KEY (warehouse_id) REFERENCES configuration.warehouses(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- Backfill from branch default warehouse
UPDATE item.products p
SET warehouse_id = sub.wh_id,
    updated_at = now()
FROM (
    SELECT p2.id AS product_id,
           (
               SELECT w.id
               FROM configuration.warehouses w
               WHERE w.branch_id = p2.branch_id
                 AND w.is_active = true
               ORDER BY w.is_default DESC, w.created_at ASC
               LIMIT 1
           ) AS wh_id
    FROM item.products p2
    WHERE p2.deleted_at IS NULL
      AND p2.warehouse_id IS NULL
      AND p2.branch_id IS NOT NULL
) sub
WHERE p.id = sub.product_id
  AND sub.wh_id IS NOT NULL;

-- Legacy rows without branch: first active warehouse
UPDATE item.products p
SET warehouse_id = (
    SELECT w.id
    FROM configuration.warehouses w
    WHERE w.is_active = true
    ORDER BY w.is_default DESC, w.created_at ASC
    LIMIT 1
),
updated_at = now()
WHERE p.deleted_at IS NULL
  AND p.warehouse_id IS NULL;

DROP INDEX IF EXISTS item.uq_products_scope_kode;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_scope_kode
    ON item.products (
        COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(branch_id,  '00000000-0000-0000-0000-000000000000'::uuid),
        warehouse_id,
        kode
    )
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_warehouse_id ON item.products (warehouse_id);

ALTER TABLE item.products
    ALTER COLUMN warehouse_id SET NOT NULL;

COMMENT ON COLUMN item.products.warehouse_id IS
    'Stall (warehouse) this product belongs to — mandatory per product.';

DROP VIEW IF EXISTS "public"."v_products_cogs";

CREATE VIEW "public"."v_products_cogs" AS
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
   FROM products p
     LEFT JOIN units u ON p.satuan_id = u.id
     LEFT JOIN configuration.warehouses wh ON wh.id = p.warehouse_id
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
