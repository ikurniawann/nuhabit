-- Modul Resort / Akomodasi (permintaan owner 2026-09-06, rekomendasi #1
-- untuk Dusun Bambu: cabin, glamping, village residence).
--
-- Alur: master tipe kamar & unit kamar → cek ketersediaan per tanggal →
-- reservasi (walk-in / website / OTA) → check-in (kamar ditetapkan) →
-- folio tamu (kamar, F&B, aktivitas, denda, pembayaran) → check-out.
--
-- Tarif: weekday / weekend (Jumat & Sabtu malam) per tipe kamar, ditimpa
-- kalender musim (resort.rate_dates) berupa harga tetap atau surcharge %.
-- Reservasi menyimpan SNAPSHOT tarif per malam supaya perubahan master tidak
-- mengubah tagihan berjalan.

CREATE SCHEMA IF NOT EXISTS resort;

-- ── Master tipe kamar ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resort.room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  code varchar(30) NOT NULL,
  name varchar(120) NOT NULL,
  description text,
  zone varchar(60),
  capacity_adults integer NOT NULL DEFAULT 2 CHECK (capacity_adults > 0),
  capacity_children integer NOT NULL DEFAULT 0 CHECK (capacity_children >= 0),
  extra_bed_capacity integer NOT NULL DEFAULT 0 CHECK (extra_bed_capacity >= 0),
  rate_weekday numeric(14,2) NOT NULL DEFAULT 0 CHECK (rate_weekday >= 0),
  rate_weekend numeric(14,2) NOT NULL DEFAULT 0 CHECK (rate_weekend >= 0),
  extra_bed_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (extra_bed_rate >= 0),
  amenities text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_resort_room_types_code ON resort.room_types(branch_id, code);

-- ── Unit kamar fisik ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resort.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  room_type_id uuid NOT NULL REFERENCES resort.room_types(id) ON DELETE CASCADE,
  code varchar(30) NOT NULL,
  name varchar(120) NOT NULL,
  zone varchar(60),
  -- housekeeping: siap dijual, perlu dibersihkan, perbaikan, ditutup sementara
  status varchar(20) NOT NULL DEFAULT 'siap'
    CHECK (status IN ('siap', 'kotor', 'perbaikan', 'ditutup')),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_resort_rooms_code ON resort.rooms(branch_id, code);
CREATE INDEX IF NOT EXISTS idx_resort_rooms_type ON resort.rooms(room_type_id, is_active);

-- ── Kalender musim / tarif khusus ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resort.rate_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  -- NULL = berlaku untuk semua tipe kamar
  room_type_id uuid REFERENCES resort.room_types(id) ON DELETE CASCADE,
  label varchar(120) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  rate numeric(14,2) CHECK (rate IS NULL OR rate >= 0),
  surcharge_percent numeric(6,2) CHECK (surcharge_percent IS NULL OR surcharge_percent >= -100),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (rate IS NOT NULL OR surcharge_percent IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_resort_rate_dates_range ON resort.rate_dates(branch_id, start_date, end_date);

-- ── Reservasi ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resort.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  reservation_code varchar(20) NOT NULL,
  access_token varchar(80) NOT NULL UNIQUE,
  guest_name varchar(150) NOT NULL,
  guest_phone varchar(30) NOT NULL,
  guest_email varchar(150),
  check_in date NOT NULL,
  check_out date NOT NULL,
  nights integer NOT NULL CHECK (nights > 0),
  adults integer NOT NULL DEFAULT 2 CHECK (adults > 0),
  children integer NOT NULL DEFAULT 0 CHECK (children >= 0),
  status varchar(20) NOT NULL DEFAULT 'menunggu-bayar'
    CHECK (status IN ('menunggu-bayar', 'terkonfirmasi', 'check-in', 'check-out', 'dibatalkan', 'no-show')),
  source varchar(20) NOT NULL DEFAULT 'walk-in'
    CHECK (source IN ('walk-in', 'website', 'ota', 'telepon', 'korporat')),
  room_total numeric(14,2) NOT NULL DEFAULT 0,
  extra_total numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  special_request text,
  xendit_invoice_id varchar(120),
  xendit_invoice_url text,
  -- Integrasi Ticketing: tab gelang tamu menginap (F&B & aktivitas)
  ticket_visit_id uuid,
  paid_at timestamptz,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid,
  created_by_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_resort_reservations_code ON resort.reservations(branch_id, reservation_code);
CREATE INDEX IF NOT EXISTS idx_resort_reservations_stay ON resort.reservations(branch_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_resort_reservations_status ON resort.reservations(branch_id, status, check_in);

-- ── Kamar yang dipesan (snapshot tarif) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS resort.reservation_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  reservation_id uuid NOT NULL REFERENCES resort.reservations(id) ON DELETE CASCADE,
  room_type_id uuid NOT NULL REFERENCES resort.room_types(id),
  room_id uuid REFERENCES resort.rooms(id) ON DELETE SET NULL,
  room_type_name varchar(120) NOT NULL,
  room_name varchar(120),
  nightly_rate numeric(14,2) NOT NULL DEFAULT 0,
  nights integer NOT NULL DEFAULT 1,
  extra_bed integer NOT NULL DEFAULT 0,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  guest_name varchar(150),
  rate_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resort_reservation_rooms ON resort.reservation_rooms(reservation_id);
CREATE INDEX IF NOT EXISTS idx_resort_reservation_rooms_room ON resort.reservation_rooms(room_id);

-- ── Folio tamu ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resort.folio_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  reservation_id uuid NOT NULL REFERENCES resort.reservations(id) ON DELETE CASCADE,
  charge_type varchar(20) NOT NULL
    CHECK (charge_type IN ('kamar', 'extra-bed', 'fnb', 'aktivitas', 'laundry', 'denda', 'diskon', 'pembayaran', 'refund')),
  direction varchar(10) NOT NULL CHECK (direction IN ('debit', 'kredit')),
  description varchar(200) NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method varchar(30),
  pos_order_id uuid,
  voided_by_charge_id uuid,
  created_by uuid,
  created_by_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resort_folio_reservation ON resort.folio_charges(reservation_id, created_at);

-- ── Menu: grup Resort + Reservasi, Front Office, Kamar ─────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('resort', 'Resort', NULL, 'building', 'group', 86, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'resort', level = 1, parent_id = NULL WHERE code = 'resort';

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('resort.reservations', 'Reservasi', '/dashboard/resort/reservations', 'calendar', 'sidebar', 10,
   '{"actions":["read","create","update","delete"]}'::jsonb),
  ('resort.front-office', 'Front Office', '/dashboard/resort/front-office', 'identification', 'sidebar', 20,
   '{"actions":["read","create","update"]}'::jsonb),
  ('resort.rooms', 'Kamar & Tipe', '/dashboard/resort/rooms', 'building', 'sidebar', 30,
   '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'resort', level = 2 WHERE code LIKE 'resort.%';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code LIKE 'resort.%' AND parent.code = 'resort';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'direksi', 'admin')
  AND (m.code = 'resort' OR m.code LIKE 'resort.%')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
