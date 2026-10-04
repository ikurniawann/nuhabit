-- =============================================================================
-- Product inventory: align stock / opname with mandatory product stall (warehouse_id)
-- =============================================================================

-- Opname header: track which stall is being counted
ALTER TABLE inventory.product_stock_opnames
    ADD COLUMN IF NOT EXISTS warehouse_id uuid;

UPDATE inventory.product_stock_opnames pso
SET warehouse_id = sub.wh_id,
    updated_at = now()
FROM (
    SELECT pso2.id AS opname_id,
           (
               SELECT w.id
               FROM configuration.warehouses w
               WHERE w.branch_id = pso2.branch_id
                 AND w.is_active = true
               ORDER BY w.is_default DESC, w.created_at ASC
               LIMIT 1
           ) AS wh_id
    FROM inventory.product_stock_opnames pso2
    WHERE pso2.warehouse_id IS NULL
      AND pso2.branch_id IS NOT NULL
) sub
WHERE pso.id = sub.opname_id
  AND sub.wh_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'product_stock_opnames_warehouse_id_fkey'
    ) THEN
        ALTER TABLE inventory.product_stock_opnames
            ADD CONSTRAINT product_stock_opnames_warehouse_id_fkey
            FOREIGN KEY (warehouse_id) REFERENCES configuration.warehouses(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_stock_opnames_warehouse
    ON inventory.product_stock_opnames (warehouse_id);

COMMENT ON COLUMN inventory.product_stock_opnames.warehouse_id IS
    'Stall (warehouse) being counted in this product stock opname session.';

-- Stock view: expose stall from product master
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
    p.branch_id,
    p.warehouse_id,
    wh.name AS warehouse_name,
    wh.code AS warehouse_code
   FROM products p
     LEFT JOIN finished_goods_inventory fgi
       ON fgi.product_id = p.id AND fgi.is_active = true
     LEFT JOIN units u ON u.id = p.satuan_id
     LEFT JOIN configuration.warehouses wh ON wh.id = p.warehouse_id
  WHERE p.deleted_at IS NULL
    AND p.is_active = true;
