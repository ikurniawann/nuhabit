ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS xendit_qr_id text;

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS xendit_external_id text;

COMMENT ON COLUMN pos.pos_orders.xendit_qr_id IS
  'Xendit QR Codes id (qr_id) for stall QRIS; mixed checkout also copies from pos_checkouts.';

COMMENT ON COLUMN pos.pos_orders.xendit_external_id IS
  'Xendit reference_id (pos-{uuid} or pos-chk-{checkoutId}).';
