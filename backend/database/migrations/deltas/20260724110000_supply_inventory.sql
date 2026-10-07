-- =============================================================================
-- EPIC-026 Task C1 — Inventory riil barang operasional (scope 'general')
--
-- Domain-paralel KETIGA (mengikuti pola yang ADA):
--   raw material → inventory.inventory + inventory.inventory_movements
--   produk       → inventory.finished_goods_inventory
--   barang oprs  → inventory.supply_inventory + inventory.supply_inventory_movements  ← INI
--
-- Hanya untuk item item.supply_items ber-flag stockable=true. Item stockable=false
-- (habis pakai) TIDAK punya stok — di-expense saat diterima (perilaku B4 dipertahankan).
-- Stok dilacak PER GUDANG (warehouse_id), costing rata-rata tertimbang per (item, gudang).
-- Idempoten: aman dijalankan ulang.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS inventory;

-- ── 1. Saldo stok per (supply_item, gudang) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.supply_inventory (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supply_item_id  uuid NOT NULL,
    warehouse_id    uuid,
    qty_available   numeric(15,3) NOT NULL DEFAULT 0,
    qty_on_order    numeric(15,3) NOT NULL DEFAULT 0,
    qty_minimum     numeric(15,3) NOT NULL DEFAULT 0,
    unit_cost       numeric(15,2) NOT NULL DEFAULT 0,   -- rata-rata tertimbang
    last_movement_at timestamptz,
    catatan         text,
    is_active       boolean NOT NULL DEFAULT true,
    company_id      uuid,
    branch_id       uuid,
    created_by      uuid,
    updated_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supply_inventory_supply_item_id_fkey') THEN
        ALTER TABLE inventory.supply_inventory
            ADD CONSTRAINT supply_inventory_supply_item_id_fkey
            FOREIGN KEY (supply_item_id) REFERENCES item.supply_items(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supply_inventory_warehouse_id_fkey') THEN
        ALTER TABLE inventory.supply_inventory
            ADD CONSTRAINT supply_inventory_warehouse_id_fkey
            FOREIGN KEY (warehouse_id) REFERENCES configuration.warehouses(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Satu baris saldo per (item, gudang). COALESCE agar warehouse NULL tetap unik.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supply_inventory_item_wh
    ON inventory.supply_inventory (supply_item_id, COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_supply_inventory_supply_item
    ON inventory.supply_inventory (supply_item_id);
CREATE INDEX IF NOT EXISTS idx_supply_inventory_warehouse
    ON inventory.supply_inventory (warehouse_id);

-- ── 2. Buku besar pergerakan stok ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.supply_inventory_movements (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supply_inventory_id  uuid NOT NULL,
    supply_item_id       uuid NOT NULL,
    warehouse_id         uuid,
    tipe                 varchar(20) NOT NULL,           -- in | out | adjustment | return
    jumlah               numeric(15,3) NOT NULL,
    qty_before           numeric(15,3) NOT NULL,
    qty_after            numeric(15,3) NOT NULL,
    unit_cost            numeric(15,2),
    total_cost           numeric(15,2),
    reference_type       varchar(50),                    -- grn | usage | adjustment | opname | return
    reference_id         uuid,
    reference_number     varchar(100),
    alasan               text,
    catatan              text,
    company_id           uuid,
    branch_id            uuid,
    created_by           uuid,
    created_at           timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supply_inventory_movements_inv_fkey') THEN
        ALTER TABLE inventory.supply_inventory_movements
            ADD CONSTRAINT supply_inventory_movements_inv_fkey
            FOREIGN KEY (supply_inventory_id) REFERENCES inventory.supply_inventory(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supply_inventory_movements_tipe_check') THEN
        ALTER TABLE inventory.supply_inventory_movements
            ADD CONSTRAINT supply_inventory_movements_tipe_check
            CHECK (tipe = ANY (ARRAY['in','out','adjustment','return']));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supply_inv_mov_inventory
    ON inventory.supply_inventory_movements (supply_inventory_id);
CREATE INDEX IF NOT EXISTS idx_supply_inv_mov_supply_item
    ON inventory.supply_inventory_movements (supply_item_id);
CREATE INDEX IF NOT EXISTS idx_supply_inv_mov_created_at
    ON inventory.supply_inventory_movements (created_at DESC);

COMMENT ON TABLE inventory.supply_inventory IS 'Saldo stok barang operasional (item.supply_items stockable=true) per gudang — EPIC-026 C1';
COMMENT ON TABLE inventory.supply_inventory_movements IS 'Buku besar pergerakan stok barang operasional — EPIC-026 C1';
