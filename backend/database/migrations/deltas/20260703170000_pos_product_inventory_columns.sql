-- Simple POS product stock columns (used by stock-alerts & dashboard low-stock widgets).
ALTER TABLE pos.pos_products
    ADD COLUMN IF NOT EXISTS inventory_quantity numeric(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS inventory_min_stock numeric(12,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pos_products_inventory
    ON pos.pos_products (inventory_quantity, inventory_min_stock)
    WHERE inventory_tracking = true;
