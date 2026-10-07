-- POS: stamp each order with the selling stall (1 order = 1 stall)

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES configuration.warehouses(id);

CREATE INDEX IF NOT EXISTS idx_pos_orders_warehouse
  ON pos.pos_orders (warehouse_id);

COMMENT ON COLUMN pos.pos_orders.warehouse_id IS
  'Stall (warehouse) where the order was sold. Required for new POS sales; one order = one stall.';
