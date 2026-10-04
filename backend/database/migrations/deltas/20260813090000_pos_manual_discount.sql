-- POS manual discount: persist type + value (amount already exists on items/orders).
-- Spec: docs/superpowers/specs/2026-08-13-pos-manual-discount-design.md

ALTER TABLE pos.pos_order_items
  ADD COLUMN IF NOT EXISTS discount_type varchar(16),
  ADD COLUMN IF NOT EXISTS discount_value numeric(12, 2);

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS manual_discount_type varchar(16),
  ADD COLUMN IF NOT EXISTS manual_discount_value numeric(12, 2);

COMMENT ON COLUMN pos.pos_order_items.discount_type IS 'percent | fixed — manual line discount';
COMMENT ON COLUMN pos.pos_order_items.discount_value IS 'Kasir input (10 = 10% or Rp amount)';
COMMENT ON COLUMN pos.pos_orders.manual_discount_type IS 'percent | fixed — manual order discount';
COMMENT ON COLUMN pos.pos_orders.manual_discount_value IS 'Kasir input for transaction discount';
