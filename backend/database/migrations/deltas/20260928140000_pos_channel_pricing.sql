-- Harga per channel penjualan (owner 2026-09-28): harga di GoFood/GrabFood/
-- ShopeeFood boleh beda dari harga dine-in (base_price) untuk menutup komisi
-- platform.
--
-- Model: aturan markup per channel (persen + pembulatan supaya harga tidak
-- "keriting", mis. 25.000 +20% = 30.000; 18.000 +20% = 21.600 → 22.000),
-- lalu per produk boleh ditimpa manual. Varian & add-on mengikuti aturan
-- markup yang sama (tanpa override). Tanpa baris override = harga otomatis.
--
-- is_active = false → channel memakai base_price apa adanya (perilaku lama).

CREATE TABLE IF NOT EXISTS pos.sales_channels (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text NOT NULL,
  markup_percent numeric(6,2) NOT NULL DEFAULT 0 CHECK (markup_percent >= 0 AND markup_percent <= 300),
  rounding_step integer NOT NULL DEFAULT 1000 CHECK (rounding_step IN (1, 100, 500, 1000)),
  rounding_mode text NOT NULL DEFAULT 'up' CHECK (rounding_mode IN ('up', 'nearest', 'down')),
  is_active boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Titik awal 20% dibulatkan ke atas per Rp1.000 — hanya usulan, diubah owner
-- di POS → Katalog → Harga Channel. Tidak berdampak apa pun sampai katalog
-- GoFood disinkron ulang.
INSERT INTO pos.sales_channels (code, name, markup_percent, rounding_step, rounding_mode, is_active, sort_order)
VALUES
  ('gofood', 'GoFood', 20, 1000, 'up', true, 10),
  ('grabfood', 'GrabFood', 20, 1000, 'up', false, 20),
  ('shopeefood', 'ShopeeFood', 20, 1000, 'up', false, 30)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS pos.pos_product_channel_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES pos.pos_products(id) ON DELETE CASCADE,
  channel_code text NOT NULL REFERENCES pos.sales_channels(code) ON DELETE CASCADE,
  price numeric(14,2) NOT NULL CHECK (price > 0 AND price <= 100000000),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, channel_code)
);

CREATE INDEX IF NOT EXISTS idx_pos_product_channel_prices_channel
  ON pos.pos_product_channel_prices (channel_code);

-- Menu POS → Katalog → Harga Channel (pola sama dgn pos.loyalty.payment-methods).
INSERT INTO iam.menus (
  code, menu_name, route_path, icon, menu_type, order_number, permission_context, module, level, is_active, is_visible
)
SELECT
  'pos.catalog.channel-prices',
  'Harga Channel',
  '/dashboard/pos/channel-prices',
  'banknotes',
  'sidebar',
  15,
  '{"actions":["read","update"]}'::jsonb,
  'pos',
  2,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM iam.menus WHERE code = 'pos.catalog.channel-prices'
);

UPDATE iam.menus child
SET parent_id = parent.id,
    module = 'pos',
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'pos.catalog.channel-prices'
  AND parent.code = 'pos.catalog';

-- Harga jual = keputusan owner → hanya super_admin & admin.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'pos.catalog.channel-prices'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
