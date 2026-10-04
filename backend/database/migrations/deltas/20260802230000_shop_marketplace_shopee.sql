-- =============================================================================
-- EPIC-039 Fase F — omnichannel marketplace (prioritas Shopee).
-- =============================================================================
-- Arah sinkron (keputusan owner): Arkiv = MASTER stok (push ke Shopee, minus
-- buffer configurable per akun, default 0); pesanan di-PULL → shop.orders
-- source 'shopee' (idempoten by order_sn) → potong stok. Pembayaran & kurir
-- order Shopee diurus Shopee — Xendit & modul kurir TIDAK dipakai.
-- Token OAuth disimpan di DB (mengikuti preseden payment_gateways.secret_key);
-- kredensial partner (SHOPEE_PARTNER_ID/KEY) tetap di env.
-- Idempoten, dev.
-- =============================================================================

CREATE TABLE IF NOT EXISTS shop.marketplace_accounts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_code varchar(20) NOT NULL DEFAULT 'shopee' REFERENCES shop.channels(code),
    shop_id text NOT NULL,
    shop_name text,
    access_token text,
    refresh_token text,
    token_expires_at timestamptz,
    status text NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected','expired','disconnected')),
    -- Buffer stok: stok yang dipush = stok riil - buffer (keputusan owner:
    -- configurable, default 0)
    stock_buffer integer NOT NULL DEFAULT 0 CHECK (stock_buffer >= 0),
    last_pull_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_marketplace_accounts UNIQUE (channel_code, shop_id)
);

CREATE TABLE IF NOT EXISTS shop.marketplace_links (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id uuid NOT NULL REFERENCES shop.marketplace_accounts(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES pos.pos_products(id) ON DELETE CASCADE,
    sku_id uuid REFERENCES pos.pos_product_skus(id) ON DELETE CASCADE,
    marketplace_item_id text NOT NULL,
    marketplace_model_id text,          -- NULL = item tanpa variasi
    marketplace_item_name text,
    last_pushed_stock numeric(12,2),
    last_push_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Satu listing marketplace ↔ satu produk/SKU lokal per akun (dua arah)
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_links_remote
  ON shop.marketplace_links (account_id, marketplace_item_id, COALESCE(marketplace_model_id, ''));
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_links_local
  ON shop.marketplace_links (account_id, product_id, COALESCE(sku_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS shop.marketplace_sync_log (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id uuid REFERENCES shop.marketplace_accounts(id) ON DELETE CASCADE,
    direction text NOT NULL CHECK (direction IN ('push_stock','pull_orders','auth')),
    status text NOT NULL CHECK (status IN ('ok','error')),
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_sync_log_recent
  ON shop.marketplace_sync_log (account_id, created_at DESC);

-- Order marketplace numpang pipeline shop.orders (badge per source)
ALTER TABLE shop.orders
  ADD COLUMN IF NOT EXISTS source_channel varchar(20) NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS marketplace_order_sn text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_orders_marketplace_sn
  ON shop.orders (marketplace_order_sn)
  WHERE marketplace_order_sn IS NOT NULL;

-- Menu: Toko Online → Marketplace
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('shop.marketplace', 'Marketplace', '/dashboard/shop/marketplace', 'store', 'sidebar', 2, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon,
  order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'shop', level = 2 WHERE code = 'shop.marketplace';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'shop.marketplace' AND parent.code = 'shop';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","update"]'::jsonb
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'shop.marketplace'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
