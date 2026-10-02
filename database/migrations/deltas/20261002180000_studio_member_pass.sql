-- =============================================================================
-- EPIC-053 — Studio: Member Pass (paket kredit kelas / PT / facility)
--
-- Alur:
--   pass_products (katalog paket)  →  jual ke member (pos.pos_customers)
--   →  member_passes (snapshot kredit, nilai, masa berlaku)
--   →  pass_credit_ledger (issue / redeem / adjust / expire / refund)
--
-- Akuntansi (PRD §2 Revenue Breakdown): saat terjual → UTANG (pendapatan
-- diterima di muka). Redeem kredit (EPIC-054) → revenue kelas / PT sebesar nilai
-- per kredit. Pass kedaluwarsa → sisa nilai diakui (breakage) + nilai facility.
-- Nilai per kredit dihitung kumulatif supaya total redeem = nilai persis
-- (lihat src/lib/studio/pass.ts), dan pembagian kelas vs PT inilah dasar pool
-- komisi coach (10% revenue kelas + 40% revenue PT, EPIC-056).
-- =============================================================================

-- ── Katalog paket ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS studio.pass_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  code varchar(30) NOT NULL,
  name varchar(120) NOT NULL,
  category varchar(30) NOT NULL DEFAULT 'class'
    CHECK (category IN ('class', 'class_pt', 'class_pt_facility')),
  class_credits integer NOT NULL DEFAULT 0 CHECK (class_credits >= 0),
  pt_credits integer NOT NULL DEFAULT 0 CHECK (pt_credits >= 0),
  facility_access boolean NOT NULL DEFAULT false,
  validity_days integer NOT NULL CHECK (validity_days BETWEEN 1 AND 730),
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  -- Pembagian harga untuk pengakuan revenue: class + pt + facility = price.
  class_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (class_value >= 0),
  pt_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (pt_value >= 0),
  facility_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (facility_value >= 0),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_pass_products_has_benefit CHECK (class_credits + pt_credits > 0 OR facility_access),
  CONSTRAINT studio_pass_products_value_split CHECK (class_value + pt_value + facility_value = price),
  CONSTRAINT studio_pass_products_value_needs_credit CHECK (
    (class_value = 0 OR class_credits > 0) AND (pt_value = 0 OR pt_credits > 0) AND (facility_value = 0 OR facility_access)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_pass_products_code ON studio.pass_products(branch_id, upper(code));
CREATE INDEX IF NOT EXISTS idx_studio_pass_products_branch ON studio.pass_products(branch_id, is_active, sort_order);

-- ── Pass milik member ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS studio.member_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  pass_code varchar(20) NOT NULL,
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES studio.pass_products(id) ON DELETE RESTRICT,
  product_name varchar(120) NOT NULL,
  category varchar(30) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending_payment', 'active', 'expired', 'exhausted', 'cancelled')),
  class_credits_total integer NOT NULL DEFAULT 0 CHECK (class_credits_total >= 0),
  pt_credits_total integer NOT NULL DEFAULT 0 CHECK (pt_credits_total >= 0),
  facility_access boolean NOT NULL DEFAULT false,
  price_paid numeric(14,2) NOT NULL CHECK (price_paid >= 0),
  class_value numeric(14,2) NOT NULL DEFAULT 0,
  pt_value numeric(14,2) NOT NULL DEFAULT 0,
  facility_value numeric(14,2) NOT NULL DEFAULT 0,
  valid_from date NOT NULL,
  valid_until date NOT NULL,
  frozen_days integer NOT NULL DEFAULT 0 CHECK (frozen_days >= 0),
  channel varchar(20) NOT NULL DEFAULT 'front_desk' CHECK (channel IN ('front_desk', 'online', 'complimentary')),
  payment_method varchar(20) CHECK (payment_method IN ('cash', 'qris', 'card', 'transfer', 'xendit', 'complimentary')),
  payment_ref varchar(120),
  paid_at timestamptz,
  journal_entry_id uuid,
  breakage_recognized_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_member_passes_window CHECK (valid_until >= valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_member_passes_code ON studio.member_passes(branch_id, pass_code);
CREATE INDEX IF NOT EXISTS idx_studio_member_passes_customer ON studio.member_passes(customer_id, status, valid_until);
CREATE INDEX IF NOT EXISTS idx_studio_member_passes_branch ON studio.member_passes(branch_id, status, valid_until);

-- ── Ledger kredit ───────────────────────────────────────────────────────────
-- qty positif = kredit bertambah (issue/adjust+/refund), negatif = terpakai
-- (redeem/adjust-/expire). amount = nilai rupiah yang ikut berpindah dari
-- utang ke revenue (redeem/expire) atau sebaliknya.
CREATE TABLE IF NOT EXISTS studio.pass_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  pass_id uuid NOT NULL REFERENCES studio.member_passes(id) ON DELETE CASCADE,
  entry_type varchar(20) NOT NULL CHECK (entry_type IN ('issue', 'redeem', 'unredeem', 'adjust', 'expire', 'cancel')),
  credit_type varchar(10) NOT NULL CHECK (credit_type IN ('class', 'pt', 'facility')),
  qty integer NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  session_id uuid REFERENCES studio.class_sessions(id) ON DELETE SET NULL,
  booking_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_pass_ledger_pass ON studio.pass_credit_ledger(pass_id, credit_type, created_at);
CREATE INDEX IF NOT EXISTS idx_studio_pass_ledger_branch_date ON studio.pass_credit_ledger(branch_id, entry_type, created_at);

-- ── Menu ────────────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('studio.passes', 'Member Pass', '/dashboard/studio/passes', 'identification', 'sidebar', 5,
   '{"actions":["read","create","update","delete"]}'::jsonb),
  ('studio.pass-products', 'Paket Member', '/dashboard/studio/pass-products', 'money', 'sidebar', 35,
   '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code IN ('studio.passes', 'studio.pass-products');
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('studio.passes', 'studio.pass-products') AND parent.code = 'studio';
-- Ikon coach: identification dipakai Member Pass, coach pakai users.
UPDATE iam.menus SET icon = 'users' WHERE code = 'studio.coaches';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi')
  AND m.code IN ('studio.passes', 'studio.pass-products')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
