-- =============================================================================
-- EPIC-057 T-057-5 — Member App: beli paket online (Xendit QRIS dinamis)
--
-- Alur: member memilih paket → pesanan `pending` + QR Xendit (reference_id =
-- order_code) → lunas (webhook /api/payments/xendit/webhook atau cek status dari
-- aplikasi) → issuePass channel 'online', payment_method 'xendit' → pesanan
-- `paid` + pass_id. Pesanan yang lewat expires_at tanpa bayar → `expired`.
-- Pass baru tercipta hanya saat lunas, jadi utang pass tidak pernah memuat
-- pesanan yang belum dibayar.
-- =============================================================================

ALTER TABLE studio.pass_products ADD COLUMN IF NOT EXISTS sell_online boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS studio.pass_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  order_code varchar(40) NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES studio.pass_products(id) ON DELETE RESTRICT,
  product_name varchar(150) NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
  gateway varchar(20) NOT NULL DEFAULT 'xendit',
  gateway_qr_id varchar(120),
  qr_string text,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  gateway_payment_ref varchar(120),
  pass_id uuid REFERENCES studio.member_passes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_pass_orders_customer ON studio.pass_orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_pass_orders_qr ON studio.pass_orders(gateway_qr_id);
