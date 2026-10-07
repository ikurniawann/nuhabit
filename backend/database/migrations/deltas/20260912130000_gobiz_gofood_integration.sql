-- EPIC-049 — Integrasi GoBiz / GoFood (Direct Integration model).
--
-- Order GoFood masuk lewat webhook GoBiz (event gofood.order.*) → dicatat di
-- pos.gofood_orders (satu baris per order GoFood, kunci order_number "F-…")
-- dan dipetakan ke pos.pos_orders (order_type delivery, paid via 'gofood')
-- saat diterima (auto-accept atau manual dari halaman POS → GoFood).
-- pos.gofood_events menyimpan tiap event mentah dgn event_id UNIK sebagai
-- idempotency (GoBiz tidak menjamin exactly-once). pos.gofood_catalog_syncs
-- = log push katalog (PUT /v1/catalog wajib full replace).
--
-- Idempoten (IF NOT EXISTS). Tidak menyentuh tabel lain.

CREATE TABLE IF NOT EXISTS pos.gofood_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gofood_order_id text NOT NULL UNIQUE,
  gofood_order_type text NOT NULL DEFAULT 'delivery'
    CHECK (gofood_order_type IN ('delivery', 'pickup')),
  outlet_id text,
  status text NOT NULL DEFAULT 'awaiting_acceptance'
    CHECK (status IN (
      'created', 'awaiting_acceptance', 'accepted', 'rejected',
      'driver_otw_pickup', 'driver_arrived', 'placed', 'completed',
      'cancelled', 'error'
    )),
  pos_order_id uuid REFERENCES pos.pos_orders(id) ON DELETE SET NULL,
  order_total numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IDR',
  customer_name text,
  driver_name text,
  pin text,
  cutlery_requested boolean NOT NULL DEFAULT false,
  takeaway_charges numeric(12,2) NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  unmapped_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload jsonb,
  notes text,
  awaiting_since timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  food_ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  last_error text,
  company_id uuid,
  branch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gofood_orders_status_created
  ON pos.gofood_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gofood_orders_pos_order
  ON pos.gofood_orders (pos_order_id);

CREATE TABLE IF NOT EXISTS pos.gofood_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_name text NOT NULL,
  gofood_order_id text,
  idempotency_key text,
  payload jsonb NOT NULL,
  result text,
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_gofood_events_order
  ON pos.gofood_events (gofood_order_id, received_at DESC);

CREATE TABLE IF NOT EXISTS pos.gofood_catalog_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  item_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'success', 'failed')),
  response jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE pos.gofood_orders IS 'EPIC-049: order GoFood dari webhook GoBiz, dipetakan ke pos_orders saat diterima.';
COMMENT ON TABLE pos.gofood_events IS 'EPIC-049: log event webhook GoBiz; event_id unik = idempotency.';
