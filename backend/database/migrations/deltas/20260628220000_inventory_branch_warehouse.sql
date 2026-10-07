-- =============================================================================
-- Business hierarchy scoping — Inventory (Branch + Warehouse level)
--   inventory.inventory            → branch_id + warehouse_id
--   inventory.inventory_movements  → branch_id + warehouse_id
--
-- Stok bersifat operasional per branch & warehouse. Kolom dibuat nullable agar
-- baris lama (single pool per raw_material) tetap valid; baris baru mengisi
-- branch_id + warehouse_id sesuai scope.
--
-- Unique stok berubah dari (raw_material_id) menjadi
-- (raw_material_id, branch_id, warehouse_id) memakai sentinel UUID untuk NULL.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- inventory.inventory
-- ---------------------------------------------------------------------------
ALTER TABLE inventory.inventory
    ADD COLUMN IF NOT EXISTS branch_id uuid,
    ADD COLUMN IF NOT EXISTS warehouse_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_branch_id_fkey'
    ) THEN
        ALTER TABLE inventory.inventory
            ADD CONSTRAINT inventory_branch_id_fkey
            FOREIGN KEY (branch_id) REFERENCES configuration.branches(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_warehouse_id_fkey'
    ) THEN
        ALTER TABLE inventory.inventory
            ADD CONSTRAINT inventory_warehouse_id_fkey
            FOREIGN KEY (warehouse_id) REFERENCES configuration.warehouses(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Ganti unique lama (raw_material_id) dengan unique per lokasi
ALTER TABLE inventory.inventory DROP CONSTRAINT IF EXISTS inventory_raw_material_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_material_location
    ON inventory.inventory (
        raw_material_id,
        COALESCE(branch_id,    '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

CREATE INDEX IF NOT EXISTS idx_inventory_branch_id ON inventory.inventory (branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_warehouse_id ON inventory.inventory (warehouse_id);

-- ---------------------------------------------------------------------------
-- inventory.inventory_movements
-- ---------------------------------------------------------------------------
ALTER TABLE inventory.inventory_movements
    ADD COLUMN IF NOT EXISTS branch_id uuid,
    ADD COLUMN IF NOT EXISTS warehouse_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movements_branch_id_fkey'
    ) THEN
        ALTER TABLE inventory.inventory_movements
            ADD CONSTRAINT inventory_movements_branch_id_fkey
            FOREIGN KEY (branch_id) REFERENCES configuration.branches(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movements_warehouse_id_fkey'
    ) THEN
        ALTER TABLE inventory.inventory_movements
            ADD CONSTRAINT inventory_movements_warehouse_id_fkey
            FOREIGN KEY (warehouse_id) REFERENCES configuration.warehouses(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_im_branch_id ON inventory.inventory_movements (branch_id);
CREATE INDEX IF NOT EXISTS idx_im_warehouse_id ON inventory.inventory_movements (warehouse_id);

-- =============================================================================
-- Views — dibuat tahan banyak baris inventory per raw_material (multi-warehouse)
-- =============================================================================

-- v_raw_materials_stock: agregasi stok lintas warehouse per raw_material.
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
    COALESCE(i.unit_cost, 0::numeric) AS avg_cost,
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
    COALESCE(i.unit_cost, 0::numeric) AS unit_cost,
    COALESCE(i.qty_available, 0::numeric) * COALESCE(i.unit_cost, 0::numeric) AS total_value,
    rm.company_id,
    rm.branch_id
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

-- v_inventory: per-lokasi (raw_material × branch × warehouse), tambah info scope.
CREATE OR REPLACE VIEW "public"."v_inventory" AS
 SELECT inv.id,
    inv.raw_material_id,
    rm.kode AS material_kode,
    rm.nama AS material_nama,
    rm.kategori AS material_kategori,
    inv.qty_available,
    COALESCE(rm.stok_minimum, inv.qty_minimum, 1000::numeric) AS qty_minimum,
    COALESCE(inv.qty_maximum, 10000::numeric) AS qty_maximum,
    inv.unit_cost,
    inv.qty_available * inv.unit_cost AS total_value,
        CASE
            WHEN inv.qty_available <= 0::numeric THEN 'out_of_stock'::text
            WHEN inv.qty_available <= COALESCE(rm.stok_minimum, inv.qty_minimum, 1000::numeric) THEN 'low_stock'::text
            WHEN inv.qty_available >= COALESCE(inv.qty_maximum, 10000::numeric) THEN 'overstock'::text
            ELSE 'normal'::text
        END AS stock_status,
    inv.last_movement_at,
    u_besar.nama AS satuan,
    inv.is_active,
    inv.branch_id,
    inv.warehouse_id,
    br.name AS branch_nama,
    wh.name AS warehouse_nama,
    wh.code AS warehouse_kode
   FROM inventory inv
     JOIN raw_materials rm ON rm.id = inv.raw_material_id
     LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
     LEFT JOIN configuration.branches br ON br.id = inv.branch_id
     LEFT JOIN configuration.warehouses wh ON wh.id = inv.warehouse_id
  WHERE inv.is_active = true;

-- v_products_cogs: agregasi unit_cost inventory agar tidak menggandakan baris BOM.
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
    p.markup_persen
   FROM products p
     LEFT JOIN units u ON p.satuan_id = u.id
     LEFT JOIN ( SELECT bi.product_id,
            count(*) AS total_bahan,
            sum(bi.qty_required * (1::numeric + COALESCE(bi.waste_factor, 0::numeric)) * COALESCE(i.unit_cost, 0::numeric)) AS estimated_cogs
           FROM bom_items bi
             LEFT JOIN raw_materials rm ON bi.raw_material_id = rm.id
             LEFT JOIN ( SELECT inventory.raw_material_id,
                    avg(inventory.unit_cost) AS unit_cost
                   FROM inventory
                  WHERE inventory.is_active = true
                  GROUP BY inventory.raw_material_id) i ON rm.id = i.raw_material_id
          WHERE bi.is_active = true
          GROUP BY bi.product_id) bom ON p.id = bom.product_id
  WHERE p.deleted_at IS NULL;
