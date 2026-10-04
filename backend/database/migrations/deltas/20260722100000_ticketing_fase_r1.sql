-- EPIC-023 Fase R1: Revisi Manage Ticket — Ticket sebagai PRODUK.
-- Owner meluruskan model (2026-07-21): master Ticket bisa dibuat banyak
-- (kategori auto-add, status draft/active, base price, thumbnail,
-- description), varian Adult/Child ber-harga Regular & High Season per
-- varian, kalender per ticket (high season + blok-online), kebijakan
-- re-entry per ticket, distribusi kanal per ticket + harga override per
-- kanal. Master flat Fase A (ticket_types/ticket_seasons/ticket_prices)
-- DIGANTI; data dev di-wipe (keputusan owner) — registry gelang &
-- pengaturan venue dipertahankan.

-- ============================================================
-- 1. Wipe data operasional dev (visit uji lama tak lagi kompatibel)
-- ============================================================
DELETE FROM ticketing.ticket_visit_charges;
DELETE FROM ticketing.ticket_gate_events;
DELETE FROM ticketing.ticket_visit_bands;
DELETE FROM ticketing.ticket_visits;
UPDATE ticketing.ticket_bands SET status = 'tersedia', updated_at = now()
WHERE status = 'dipakai';

-- ============================================================
-- 2. Lepas & buang master lama
-- ============================================================
ALTER TABLE ticketing.ticket_visit_bands
  DROP COLUMN IF EXISTS ticket_type_id;
DROP TABLE IF EXISTS ticketing.ticket_prices;
DROP TABLE IF EXISTS ticketing.ticket_seasons;
DROP TABLE IF EXISTS ticketing.ticket_types;

-- ============================================================
-- 3. Master Kategori Ticket (auto-add via autocomplete)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  name varchar(100) NOT NULL,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, name)
);

-- ============================================================
-- 4. Ticket = produk
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  -- Ticket ID tampilan, auto per venue: TKT-0001, TKT-0002, ...
  code varchar(20) NOT NULL,
  name varchar(150) NOT NULL,
  category_id uuid REFERENCES ticketing.ticket_categories(id),
  status varchar(10) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active')),
  -- harga acuan/tampilan; harga transaksi dari varian
  base_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  thumbnail_url text,
  description text,
  -- kebijakan operasional per ticket (keputusan owner); default dari venue
  re_entry_policy varchar(25) NOT NULL DEFAULT 'sekali-masuk'
    CHECK (re_entry_policy IN ('sekali-masuk', 'bebas-keluar-masuk')),
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_ticket_products_branch_status
  ON ticketing.ticket_products (branch_id, status);

-- ============================================================
-- 5. Varian per ticket — dua kolom harga (keputusan owner):
--    Regular & High Season; NULL = belum diisi → transaksi ditolak
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  ticket_product_id uuid NOT NULL
    REFERENCES ticketing.ticket_products(id) ON DELETE CASCADE,
  code varchar(20) NOT NULL, -- 'adult' / 'child' (extensible)
  name varchar(60) NOT NULL,
  price_regular numeric(14,2) CHECK (price_regular IS NULL OR price_regular >= 0),
  price_high numeric(14,2) CHECK (price_high IS NULL OR price_high >= 0),
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_product_id, code)
);

CREATE INDEX IF NOT EXISTS idx_ticket_product_variants_product
  ON ticketing.ticket_product_variants (ticket_product_id);

-- ============================================================
-- 6. Kalender per ticket: high season (harga high berlaku) dan
--    blok-online (tanggal tidak dijual di website; walk-in tetap jalan)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_product_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  ticket_product_id uuid NOT NULL
    REFERENCES ticketing.ticket_products(id) ON DELETE CASCADE,
  date_kind varchar(15) NOT NULL
    CHECK (date_kind IN ('high-season', 'blok-online')),
  label varchar(120) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_ticket_product_dates_product
  ON ticketing.ticket_product_dates (ticket_product_id, date_kind);

-- ============================================================
-- 7. Distribusi kanal per ticket (Channel Manager — UI di Fase R2;
--    default saat ticket dibuat: walk-in ON, website OFF)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_product_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  ticket_product_id uuid NOT NULL
    REFERENCES ticketing.ticket_products(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES ticketing.ticket_channels(id),
  is_distributed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_product_id, channel_id)
);

-- ============================================================
-- 8. Harga override per kanal per varian (keputusan owner: harga bisa
--    beda per kanal; NULL = ikut harga varian)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_variant_channel_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  variant_id uuid NOT NULL
    REFERENCES ticketing.ticket_product_variants(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES ticketing.ticket_channels(id),
  price_regular numeric(14,2) CHECK (price_regular IS NULL OR price_regular >= 0),
  price_high numeric(14,2) CHECK (price_high IS NULL OR price_high >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, channel_id)
);

-- ============================================================
-- 9. Gelang visit kini menunjuk varian produk
-- ============================================================
ALTER TABLE ticketing.ticket_visit_bands
  ADD COLUMN IF NOT EXISTS variant_id uuid
    REFERENCES ticketing.ticket_product_variants(id);
-- data sudah di-wipe → aman dijadikan NOT NULL
ALTER TABLE ticketing.ticket_visit_bands
  ALTER COLUMN variant_id SET NOT NULL;

-- ============================================================
-- 10. Menu: Master Ticket (admin) — kalender & harga pindah ke sini
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ticketing.tickets', 'Master Ticket', '/dashboard/ticketing/tickets',
        'ticket', 'sidebar', 5, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'ticketing', level = 2
WHERE code = 'ticketing.tickets';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'ticketing.tickets' AND parent.code = 'ticketing';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'super_admin' AND m.code = 'ticketing.tickets'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- ============================================================
-- 11. Kategori unik case-insensitive (hasil review: race auto-add
--     "Anak" vs "anak" jangan menciptakan dua baris)
-- ============================================================
ALTER TABLE ticketing.ticket_categories
  DROP CONSTRAINT IF EXISTS ticket_categories_branch_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_categories_branch_lower_name
  ON ticketing.ticket_categories (branch_id, lower(name));
