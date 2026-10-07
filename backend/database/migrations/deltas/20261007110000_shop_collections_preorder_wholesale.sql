-- =============================================================================
-- Shop: default storefront, product shop settings (pre-order, wholesale
-- pricing), pre-order order lines, and the wholesale (B2B) partner portal.
-- Idempotent.
-- =============================================================================

-- 1) Default storefront (/apparel renders it). One row at most carries it;
--    the oldest active storefront takes it when none does.
ALTER TABLE shop.storefronts ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_storefronts_default
  ON shop.storefronts (is_default) WHERE is_default;

UPDATE shop.storefronts SET is_default = true
WHERE id = (SELECT id FROM shop.storefronts WHERE is_active ORDER BY created_at, id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM shop.storefronts WHERE is_default);

-- 2) Shop settings per product. preorder_until keeps a zero-stock product
--    buyable until that date; the wholesale columns feed the partner
--    catalog (a NULL wholesale price means list price minus the account's
--    discount).
CREATE TABLE IF NOT EXISTS shop.product_settings (
    product_id uuid PRIMARY KEY REFERENCES pos.pos_products(id) ON DELETE CASCADE,
    preorder_until date,
    wholesale_price_idr numeric(15,2) CHECK (wholesale_price_idr IS NULL OR wholesale_price_idr >= 0),
    wholesale_min_qty integer NOT NULL DEFAULT 1 CHECK (wholesale_min_qty >= 1),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Pre-order lines: sold at zero stock, no reservation held.
ALTER TABLE shop.order_items ADD COLUMN IF NOT EXISTS is_preorder boolean NOT NULL DEFAULT false;

-- 4) Wholesale partner accounts and their sessions.
CREATE TABLE IF NOT EXISTS shop.wholesale_accounts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id uuid REFERENCES shop.storefronts(id),
    company_name varchar(160) NOT NULL,
    contact_name varchar(120) NOT NULL,
    email varchar(160) NOT NULL,
    password_hash text NOT NULL,
    phone varchar(30),
    discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
    min_order_idr numeric(15,2) NOT NULL DEFAULT 0 CHECK (min_order_idr >= 0),
    payment_terms text NOT NULL DEFAULT 'invoice' CHECK (payment_terms IN ('invoice', 'pay_later')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_wholesale_accounts_email
  ON shop.wholesale_accounts (lower(email));

CREATE TABLE IF NOT EXISTS shop.wholesale_sessions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_hash text NOT NULL,
    account_id uuid NOT NULL REFERENCES shop.wholesale_accounts(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_wholesale_sessions_token
  ON shop.wholesale_sessions (token_hash);

-- 5) Wholesale orders: the account, its payment terms and, for pay_later,
--    the due date.
ALTER TABLE shop.orders ADD COLUMN IF NOT EXISTS wholesale_account_id uuid REFERENCES shop.wholesale_accounts(id);
ALTER TABLE shop.orders ADD COLUMN IF NOT EXISTS payment_terms text
  CHECK (payment_terms IS NULL OR payment_terms IN ('invoice', 'pay_later'));
ALTER TABLE shop.orders ADD COLUMN IF NOT EXISTS due_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_shop_orders_wholesale
  ON shop.orders (wholesale_account_id, created_at DESC) WHERE wholesale_account_id IS NOT NULL;

-- 6) IAM menu "Mitra Wholesale" under the shop section.
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('shop.wholesale', 'Mitra Wholesale', '/dashboard/shop/wholesale', 'briefcase', 'sidebar', 3, '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'shop', level = 2 WHERE code = 'shop.wholesale';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'shop.wholesale' AND parent.code = 'shop';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'shop.wholesale'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
