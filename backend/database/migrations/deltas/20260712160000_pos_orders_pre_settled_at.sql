-- Pre Settlement marker for restaurant board (red until paid / cleared on new open bill).
ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS pre_settled_at timestamptz;

COMMENT ON COLUMN pos.pos_orders.pre_settled_at IS
  'Set when Pre Settlement is requested; cleared when new items are saved for the table; null when not awaiting payment UI.';
