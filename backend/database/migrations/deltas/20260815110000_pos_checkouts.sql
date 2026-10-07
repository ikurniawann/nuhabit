CREATE TABLE IF NOT EXISTS pos.pos_checkouts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  checkout_number varchar(32) NOT NULL UNIQUE,
  queue_number varchar(16),
  company_id uuid,
  branch_id uuid,
  table_id text,
  customer_id uuid,
  cashier_id uuid NOT NULL,
  shift_id uuid,
  payment_method pos_payment_method,
  payment_status pos_payment_status NOT NULL DEFAULT 'unpaid',
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  service_charge_amount numeric(12,2) NOT NULL DEFAULT 0,
  other_charges_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  change_amount numeric(12,2) NOT NULL DEFAULT 0,
  xendit_qr_id text,
  xendit_external_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_checkouts_table
  ON pos.pos_checkouts (table_id, payment_status);

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS checkout_id uuid REFERENCES pos.pos_checkouts(id);

ALTER TABLE pos.pos_orders
  ADD COLUMN IF NOT EXISTS sold_from varchar(16) NOT NULL DEFAULT 'stall';

ALTER TABLE pos.pos_orders
  DROP CONSTRAINT IF EXISTS pos_orders_sold_from_check;

ALTER TABLE pos.pos_orders
  ADD CONSTRAINT pos_orders_sold_from_check
  CHECK (sold_from IN ('central', 'stall'));

CREATE INDEX IF NOT EXISTS idx_pos_orders_checkout_id
  ON pos.pos_orders (checkout_id);
