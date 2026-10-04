-- =============================================================================
-- EPIC-026 B4 — Penerimaan (GRN) barang operasional (scope 'general')
-- =============================================================================
-- Menambah target item ketiga `supply_item_id` di grn_items dan melonggarkan
-- diskriminan target item menjadi "tepat satu dari tiga" (num_nonnulls),
-- meniru pola scope 'product' (20260702150000_product_delivery_grn.sql).
--
-- Catatan: deliveries & grn SUDAH punya vendor_id + grn_party_check (dari
-- migrasi product); scope 'general' memakai jalur vendor yang sama, jadi tidak
-- perlu perubahan pada deliveries/grn di sini.
-- =============================================================================

ALTER TABLE purchasing.grn_items
    ADD COLUMN IF NOT EXISTS supply_item_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'grn_items_supply_item_id_fkey'
    ) THEN
        ALTER TABLE purchasing.grn_items
            ADD CONSTRAINT grn_items_supply_item_id_fkey
            FOREIGN KEY (supply_item_id) REFERENCES item.supply_items(id) ON DELETE RESTRICT;
    END IF;

    -- Relaksasi XOR (raw_material xor product) → tepat SATU dari tiga target item.
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'grn_items_item_target_check'
    ) THEN
        ALTER TABLE purchasing.grn_items DROP CONSTRAINT grn_items_item_target_check;
    END IF;

    ALTER TABLE purchasing.grn_items
        ADD CONSTRAINT grn_items_item_target_check
        CHECK (num_nonnulls(raw_material_id, product_id, supply_item_id) = 1);
END $$;

CREATE INDEX IF NOT EXISTS idx_grn_items_supply_item_id
    ON purchasing.grn_items (supply_item_id);

COMMENT ON COLUMN purchasing.grn_items.supply_item_id IS
    'Target item scope general (barang operasional) — EPIC-026 B4';
