-- =============================================================================
-- Shop checkout round: pickup at a branch, promo codes, ARK Coin payment and
-- the storefront settings form. Idempotent.
-- =============================================================================

-- 1) Orders: delivery, promo, payment method and the courier's estimate.
ALTER TABLE shop.orders
  ADD COLUMN IF NOT EXISTS delivery_method text NOT NULL DEFAULT 'ship',
  ADD COLUMN IF NOT EXISTS pickup_branch_id uuid REFERENCES configuration.branches(id),
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS promo_code text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'xendit',
  ADD COLUMN IF NOT EXISTS eta_text text;

ALTER TABLE shop.orders DROP CONSTRAINT IF EXISTS orders_delivery_method_check;
ALTER TABLE shop.orders ADD CONSTRAINT orders_delivery_method_check
  CHECK (delivery_method IN ('ship', 'pickup'));

ALTER TABLE shop.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE shop.orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('xendit', 'arkcoin'));

ALTER TABLE shop.orders DROP CONSTRAINT IF EXISTS orders_discount_amount_check;
ALTER TABLE shop.orders ADD CONSTRAINT orders_discount_amount_check
  CHECK (discount_amount >= 0);

-- Pickup orders move paid -> ready_for_pickup -> picked_up instead of
-- packing -> shipped -> completed.
ALTER TABLE shop.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE shop.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'paid', 'packing', 'shipped', 'completed', 'cancelled', 'refund',
                    'ready_for_pickup', 'picked_up'));

CREATE INDEX IF NOT EXISTS idx_shop_orders_customer
  ON shop.orders (customer_id, created_at DESC) WHERE customer_id IS NOT NULL;

-- 2) Promo redemptions may belong to a shop order.
ALTER TABLE promo.promo_redemptions DROP CONSTRAINT IF EXISTS promo_redemptions_context_type_check;
ALTER TABLE promo.promo_redemptions ADD CONSTRAINT promo_redemptions_context_type_check
  CHECK (context_type IN ('ticket_booking', 'pos_order', 'shop_order'));

-- 3) Storefront settings (one row per storefront; a missing row means the
--    defaults).
CREATE TABLE IF NOT EXISTS shop.storefront_settings (
    storefront_id uuid PRIMARY KEY REFERENCES shop.storefronts(id) ON DELETE CASCADE,
    pickup_enabled boolean NOT NULL DEFAULT true,
    free_shipping_threshold numeric(15,2) CHECK (free_shipping_threshold IS NULL OR free_shipping_threshold >= 0),
    low_stock_threshold integer NOT NULL DEFAULT 3 CHECK (low_stock_threshold >= 0),
    whatsapp_number text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid REFERENCES configuration.users(id)
);

-- 4) IAM menu "Storefront Settings" under the shop section.
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('shop.settings', 'Storefront Settings', '/dashboard/shop/settings', 'settings', 'sidebar', 4, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'shop', level = 2 WHERE code = 'shop.settings';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'shop.settings' AND parent.code = 'shop';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","update"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'shop.settings'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
