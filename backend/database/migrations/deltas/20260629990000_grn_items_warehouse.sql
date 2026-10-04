-- =============================================================================
-- Add warehouse_id to grn_items for warehouse-level tracking of received goods.
-- Each GRN item is received into a specific warehouse, determined at receive time.
-- =============================================================================

ALTER TABLE purchasing.grn_items
    ADD COLUMN IF NOT EXISTS warehouse_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_grn_items_warehouse'
    ) THEN
        ALTER TABLE purchasing.grn_items
            ADD CONSTRAINT fk_grn_items_warehouse
            FOREIGN KEY (warehouse_id) REFERENCES configuration.warehouses(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_grn_items_warehouse_id ON purchasing.grn_items (warehouse_id);
