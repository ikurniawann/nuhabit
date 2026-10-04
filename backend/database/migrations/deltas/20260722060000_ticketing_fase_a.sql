-- EPIC-023 Fase A: fondasi Ticketing Theme Park — master jenis tiket,
-- kalender musim, kanal penjualan, matriks harga, registry gelang NFC,
-- dan pengaturan per venue. Keputusan owner 2026-07-21:
--   • multi mode bayar: prepaid (deposit) + postpaid (credit limit) —
--     default per venue di ticket_settings, dipakai Fase B
--   • high season = kalender manual (rentang tanggal, high menang overlap)
--   • re-entry konfigurable (sekali-masuk / bebas-keluar-masuk)
-- Seed adult/child + kanal walk-in/website TIDAK di sini: master ber-tenant
-- (company_id+branch_id wajib) sehingga bootstrap dilakukan API saat venue
-- pertama kali membuka Ticketing Settings (lihat /api/ticketing/settings).

CREATE SCHEMA IF NOT EXISTS ticketing;

-- ============================================================
-- 1. Jenis tiket (child/adult, extensible: toddler/senior)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  code varchar(40) NOT NULL,
  name varchar(100) NOT NULL,
  -- aturan penentuan kategori di loket (mis. "usia 3-12 tahun / < 140 cm")
  rule_note varchar(300),
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_ticket_types_branch
  ON ticketing.ticket_types (branch_id);

-- ============================================================
-- 2. Kalender musim — hanya rentang high season yang dicatat;
--    tanggal di luar semua rentang = regular (default)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  name varchar(120) NOT NULL,
  season_kind varchar(10) NOT NULL DEFAULT 'high'
    CHECK (season_kind IN ('regular', 'high')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_ticket_seasons_branch
  ON ticketing.ticket_seasons (branch_id);
CREATE INDEX IF NOT EXISTS idx_ticket_seasons_range
  ON ticketing.ticket_seasons (start_date, end_date);

-- ============================================================
-- 3. Kanal penjualan (walk-in, website; extensible OTA — Fase D)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  code varchar(40) NOT NULL,
  name varchar(100) NOT NULL,
  -- kanal online mensyaratkan pembayaran di muka (website booking Fase D)
  is_online boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_ticket_channels_branch
  ON ticketing.ticket_channels (branch_id);

-- ============================================================
-- 4. Matriks harga: jenis tiket × musim × kanal → satu harga pasti.
--    Harga ter-charge di-snapshot di ledger (Fase B) — ubah master
--    tidak mengubah tagihan berjalan.
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  ticket_type_id uuid NOT NULL
    REFERENCES ticketing.ticket_types(id) ON DELETE CASCADE,
  season_kind varchar(10) NOT NULL
    CHECK (season_kind IN ('regular', 'high')),
  channel_id uuid NOT NULL
    REFERENCES ticketing.ticket_channels(id) ON DELETE CASCADE,
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_type_id, season_kind, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_prices_branch
  ON ticketing.ticket_prices (branch_id);

-- ============================================================
-- 5. Registry gelang NFC — aset berputar milik venue, BUKAN identitas
--    member (beda dari pos_customers.nfc_uid). Diikat ke visit saat
--    registrasi (Fase B) dan dilepas saat settlement.
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  -- UID kartu/gelang heksadesimal dari reader (ACR1555 / keyboard wedge)
  nfc_uid varchar(64) NOT NULL,
  label varchar(60),
  status varchar(15) NOT NULL DEFAULT 'tersedia'
    CHECK (status IN ('tersedia', 'dipakai', 'hilang', 'rusak')),
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, nfc_uid)
);

CREATE INDEX IF NOT EXISTS idx_ticket_bands_branch_status
  ON ticketing.ticket_bands (branch_id, status);

-- ============================================================
-- 6. Pengaturan ticketing per venue (satu baris per branch)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  -- keputusan owner: masih dilema → konfigurable, jangan hardcode
  re_entry_policy varchar(25) NOT NULL DEFAULT 'sekali-masuk'
    CHECK (re_entry_policy IN ('sekali-masuk', 'bebas-keluar-masuk')),
  -- plafon tagihan mode postpaid (Rp) — ditegakkan server saat charge F&B
  default_credit_limit numeric(14,2) NOT NULL DEFAULT 500000
    CHECK (default_credit_limit >= 0),
  default_payment_mode varchar(10) NOT NULL DEFAULT 'postpaid'
    CHECK (default_payment_mode IN ('postpaid', 'prepaid')),
  updated_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);

-- ============================================================
-- 7. Menu: grup "Ticketing" + item Pengaturan Tiket (super_admin saja
--    di Fase A; role kasir/gate menyusul Fase B)
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ticketing', 'Ticketing', NULL, 'ticket',
        'group', 84, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'ticketing', level = 1, parent_id = NULL
WHERE code = 'ticketing';

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ticketing.settings', 'Pengaturan Tiket', '/dashboard/ticketing/settings',
        'settings', 'sidebar', 90, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'ticketing', level = 2 WHERE code = 'ticketing.settings';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'ticketing.settings' AND parent.code = 'ticketing';

-- ============================================================
-- 8. Grant: super_admin
-- ============================================================
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'super_admin'
  AND m.code IN ('ticketing', 'ticketing.settings')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
