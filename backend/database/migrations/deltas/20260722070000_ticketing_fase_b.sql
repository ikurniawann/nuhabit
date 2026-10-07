-- EPIC-023 Fase B: Visit Core — registrasi kunjungan, gate tap-charge,
-- dan settlement kasir keluar. Ledger tab dua arah (keputusan owner
-- 2026-07-21): debit = tagihan (tiket/fnb/denda/koreksi/refund-deposit),
-- kredit = uang masuk (deposit/pembayaran). Prepaid: kredit − debit ≥ 0;
-- postpaid: debit − kredit ≤ credit_limit. Settlement menutup visit saat
-- ledger seimbang (debit = kredit).
-- Catatan arah refund-deposit: di sketsa epic tercantum kredit, tapi
-- secara akuntansi refund MENGURANGI uang titipan pengunjung → debit,
-- supaya visit settled selalu berakhir ledger seimbang.

-- ============================================================
-- 1. Visit group — satu sesi kunjungan (perorangan/rombongan)
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  contact_name varchar(150) NOT NULL,
  contact_phone varchar(30),
  -- opsional tautan ke member loyalty (kartu member permanen ≠ gelang)
  customer_id uuid REFERENCES pos.pos_customers(id),
  -- kanal penjualan saat registrasi (walk-in; website menyusul Fase D)
  channel_id uuid REFERENCES ticketing.ticket_channels(id),
  payment_mode varchar(10) NOT NULL DEFAULT 'postpaid'
    CHECK (payment_mode IN ('postpaid', 'prepaid')),
  -- plafon tagihan snapshot dari ticket_settings saat registrasi (postpaid)
  credit_limit numeric(14,2)
    CHECK (credit_limit IS NULL OR credit_limit >= 0),
  status varchar(10) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'settled', 'void')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  settled_by uuid REFERENCES configuration.users(id),
  notes varchar(300),
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_visits_branch_status
  ON ticketing.ticket_visits (branch_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_visits_opened
  ON ticketing.ticket_visits (opened_at);

-- ============================================================
-- 2. Gelang yang terikat ke visit — 1 gelang = 1 tiket berkategori
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_visit_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  visit_id uuid NOT NULL
    REFERENCES ticketing.ticket_visits(id) ON DELETE CASCADE,
  band_id uuid NOT NULL REFERENCES ticketing.ticket_bands(id),
  ticket_type_id uuid NOT NULL REFERENCES ticketing.ticket_types(id),
  -- tap gate pertama yang diterima (charge tiket terjadi di sini)
  entered_at timestamptz,
  status varchar(10) NOT NULL DEFAULT 'aktif'
    CHECK (status IN ('aktif', 'selesai', 'hilang')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_visit_bands_visit
  ON ticketing.ticket_visit_bands (visit_id);
-- satu gelang fisik hanya boleh aktif di satu visit pada satu waktu
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_visit_bands_active
  ON ticketing.ticket_visit_bands (band_id)
  WHERE status = 'aktif';

-- ============================================================
-- 3. Ledger tab dua arah — append-only, void = baris pembalik
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_visit_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  visit_id uuid NOT NULL
    REFERENCES ticketing.ticket_visits(id) ON DELETE CASCADE,
  band_id uuid REFERENCES ticketing.ticket_bands(id),
  charge_type varchar(20) NOT NULL CHECK (charge_type IN
    ('tiket', 'fnb', 'denda', 'koreksi', 'refund-deposit',
     'deposit', 'pembayaran')),
  direction varchar(6) NOT NULL CHECK (direction IN ('debit', 'kredit')),
  -- konsistensi arah per jenis: uang masuk = kredit, selain itu debit
  CONSTRAINT chk_charge_direction CHECK (
    (charge_type IN ('deposit', 'pembayaran') AND direction = 'kredit')
    OR (charge_type NOT IN ('deposit', 'pembayaran') AND direction = 'debit')
  ),
  description varchar(300) NOT NULL,
  -- snapshot nominal saat kejadian; selalu positif, arah dari direction
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  -- metode uang fisik untuk deposit/pembayaran/refund (cash/qris/card)
  payment_method varchar(20),
  -- order POS sumber charge fnb (Fase C)
  pos_order_id uuid REFERENCES pos.pos_orders(id),
  -- konteks resolve harga tiket: {ticket_type_id, season_kind, channel_id}
  price_context jsonb,
  -- baris pembalik menunjuk baris yang dibatalkan (void)
  voided_by_charge_id uuid REFERENCES ticketing.ticket_visit_charges(id),
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_visit_charges_visit
  ON ticketing.ticket_visit_charges (visit_id);
CREATE INDEX IF NOT EXISTS idx_ticket_visit_charges_order
  ON ticketing.ticket_visit_charges (pos_order_id)
  WHERE pos_order_id IS NOT NULL;

-- ============================================================
-- 4. Log tap gate — append-only, audit & traffic
-- ============================================================
CREATE TABLE IF NOT EXISTS ticketing.ticket_gate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  band_uid varchar(64) NOT NULL,
  band_id uuid REFERENCES ticketing.ticket_bands(id),
  visit_id uuid REFERENCES ticketing.ticket_visits(id),
  gate_label varchar(60) NOT NULL DEFAULT 'gate-1',
  result varchar(30) NOT NULL,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_gate_events_branch_time
  ON ticketing.ticket_gate_events (branch_id, created_at);

-- ============================================================
-- 5. Menu: Loket & Kasir + Mode Gate (role operasional POS ikut)
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ticketing.loket', 'Loket & Kasir', '/dashboard/ticketing/loket',
        'ticket', 'sidebar', 10, '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ticketing.gate', 'Mode Gate', '/dashboard/ticketing/gate',
        'ticket', 'sidebar', 20, '{"actions":["read","create"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'ticketing', level = 2
WHERE code IN ('ticketing.loket', 'ticketing.gate');
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('ticketing.loket', 'ticketing.gate')
  AND parent.code = 'ticketing';

-- ============================================================
-- 6. Grant: super_admin penuh; pos_supervisor & pos = operasional
--    (grup ticketing ikut di-grant agar sidebar tampil)
-- ============================================================
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'pos_supervisor', 'pos')
  AND m.code IN ('ticketing', 'ticketing.loket', 'ticketing.gate')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
