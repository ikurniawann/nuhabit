ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS payment_method_code text;

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS payment_method_name text;

ALTER TABLE pos.pos_checkouts
  ADD COLUMN IF NOT EXISTS payment_method_code text;

ALTER TABLE pos.pos_checkouts
  ADD COLUMN IF NOT EXISTS payment_method_name text;

COMMENT ON COLUMN pos.pos_orders.payment_method_code IS
  'Catalog code from pos.payment_methods. Handler enum stays on payment_method.';

COMMENT ON COLUMN pos.pos_orders.payment_method_name IS
  'Catalog display name at pay time (e.g. Transfer BCA).';
