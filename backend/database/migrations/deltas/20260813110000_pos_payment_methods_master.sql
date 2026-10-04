-- Master metode bayar POS (dinamis aktif/label/urutan).
-- `code` = kunci di UI/kasir (cash, qris, credit_card, ark_coin, …).
-- `handler` = alur backend (cash, qris, credit, ark_wallet, nfc_tab, gift_card).

CREATE TABLE IF NOT EXISTS pos.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'banknote',
  handler text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  requires_cash_input boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_methods_code_key UNIQUE (code),
  CONSTRAINT payment_methods_handler_check CHECK (
    handler IN (
      'cash',
      'qris',
      'credit',
      'ark_wallet',
      'nfc_tab',
      'gift_card'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_active_sort
  ON pos.payment_methods (is_active, sort_order, name);

INSERT INTO pos.payment_methods (
  code, name, description, icon, handler, is_active, sort_order, requires_cash_input
)
VALUES
  ('cash', 'Cash', 'Pay with cash', 'banknote', 'cash', true, 10, true),
  ('qris', 'QRIS', 'Scan QR code', 'qr-code', 'qris', true, 20, false),
  ('credit_card', 'Credit Card', 'Visa / Mastercard', 'credit-card', 'credit', true, 30, false),
  ('ark_coin', 'ARK Coin', 'Member balance', 'coins', 'ark_wallet', true, 40, false),
  ('nfc_tab', 'NFC Tab', 'Gelang ticketing', 'ticket', 'nfc_tab', true, 50, false),
  ('gift_card', 'Gift Card', 'Saldo kartu hadiah', 'gift', 'gift_card', true, 60, false)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  handler = EXCLUDED.handler,
  requires_cash_input = EXCLUDED.requires_cash_input,
  updated_at = now();

INSERT INTO iam.menus (
  code, menu_name, route_path, icon, menu_type, order_number, permission_context, module, level, is_active, is_visible
)
SELECT
  'pos.loyalty.payment-methods',
  'Metode Bayar',
  '/dashboard/pos/payment-methods',
  'credit-card',
  'sidebar',
  25,
  '{"actions":["read","update"]}'::jsonb,
  'pos',
  2,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM iam.menus WHERE code = 'pos.loyalty.payment-methods'
);

UPDATE iam.menus child
SET parent_id = parent.id,
    module = 'pos',
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'pos.loyalty.payment-methods'
  AND parent.code = 'pos.loyalty';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin')
  AND m.code = 'pos.loyalty.payment-methods'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
