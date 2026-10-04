-- =============================================================================
-- EPIC-039 Fase E — pengiriman order toko online + menu back-office pesanan.
-- =============================================================================
-- shop.shipments (digeser dari Fase C — kini shop.orders sudah ada):
-- satu order maksimal satu pengiriman aktif. Dua mode:
--   * Biteship  : create order via API → provider_order_id (+waybill via
--                 webhook /api/public/shop/webhook/biteship)
--   * manual    : resi diinput back-office (RajaOngkir / kurir apa pun)
-- Idempoten, dev.
-- =============================================================================

CREATE TABLE IF NOT EXISTS shop.shipments (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id uuid NOT NULL REFERENCES shop.orders(id) ON DELETE CASCADE,
    provider text NOT NULL DEFAULT 'manual'
        CHECK (provider IN ('biteship', 'rajaongkir', 'manual')),
    courier_code varchar(30),
    courier_service varchar(60),
    provider_order_id text,
    waybill varchar(60),
    price numeric(12,2) NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','pickup','in_transit','delivered','failed','cancelled')),
    tracking_history jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Satu pengiriman aktif per order (failed/cancelled boleh diulang)
CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_shipments_active
  ON shop.shipments (order_id)
  WHERE status NOT IN ('failed','cancelled');

CREATE INDEX IF NOT EXISTS idx_shop_shipments_provider_order
  ON shop.shipments (provider_order_id)
  WHERE provider_order_id IS NOT NULL;

-- Menu: parent "Toko Online" + anak "Pesanan"
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('shop', 'Toko Online', '/dashboard/shop', 'shopping-bag', 'sidebar', 58, '{"actions":["read"]}'::jsonb),
  ('shop.orders', 'Pesanan', '/dashboard/shop/orders', 'package', 'sidebar', 1, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number,
  is_active = true,
  is_visible = true,
  deleted_at = NULL,
  updated_at = now();

UPDATE iam.menus SET module = 'shop', level = 1 WHERE code = 'shop';
UPDATE iam.menus SET module = 'shop', level = 2 WHERE code = 'shop.orders';

UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'shop.orders' AND parent.code = 'shop';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","update"]'::jsonb
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code IN ('shop', 'shop.orders')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
