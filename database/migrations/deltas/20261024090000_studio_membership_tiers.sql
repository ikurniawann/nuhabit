-- EPIC-069 — Membership: tier loyalitas dari spending member (12 bulan berjalan).
--   • studio.membership_tiers: tangga tier yang diisi client (ambang spending &
--     perks). Sengaja TIDAK di-seed — keputusan client "saya isi sendiri".
--     Perks terstruktur diterapkan sistem (diskon F&B/POS, booking lebih awal,
--     batas cancel khusus, prioritas waitlist); `perks` = daftar teks perks lain
--     (guest pass, merch, …) yang tampil di Member App & dipenuhi staf.
--   • studio.member_memberships: tier tersimpan per member + masa berlakunya
--     (valid_until = 12 bulan sejak terakhir memenuhi ambang tier itu) dan
--     spending 12 bulan terakhir saat dievaluasi.
--   • studio.membership_tier_changes: riwayat naik/turun tier.
--   Benefit tier XP (crm.crm_membership_tiers) tidak lagi dipakai — datanya
--   dibiarkan supaya bisa dikembalikan.

CREATE TABLE IF NOT EXISTS studio.membership_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(40) NOT NULL,
  min_spend numeric(14,2) NOT NULL CHECK (min_spend >= 0),
  display_color varchar(9),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  early_booking_days integer NOT NULL DEFAULT 0 CHECK (early_booking_days BETWEEN 0 AND 14),
  cancel_window_hours integer CHECK (cancel_window_hours BETWEEN 0 AND 72),
  waitlist_priority boolean NOT NULL DEFAULT false,
  perks text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_tiers_min_spend ON studio.membership_tiers (min_spend) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_tiers_name ON studio.membership_tiers (lower(name)) WHERE is_active;

CREATE TABLE IF NOT EXISTS studio.member_memberships (
  customer_id uuid PRIMARY KEY REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  tier_id uuid REFERENCES studio.membership_tiers(id) ON DELETE SET NULL,
  valid_until date,
  spend_12m numeric(14,2) NOT NULL DEFAULT 0,
  evaluated_on date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_memberships_tier ON studio.member_memberships (tier_id);

CREATE TABLE IF NOT EXISTS studio.membership_tier_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES pos.pos_customers(id) ON DELETE CASCADE,
  from_tier_id uuid REFERENCES studio.membership_tiers(id) ON DELETE SET NULL,
  to_tier_id uuid REFERENCES studio.membership_tiers(id) ON DELETE SET NULL,
  from_tier_name varchar(40),
  to_tier_name varchar(40),
  direction varchar(10) NOT NULL CHECK (direction IN ('up', 'down')),
  spend_12m numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_membership_tier_changes_customer ON studio.membership_tier_changes (customer_id, created_at DESC);

-- Spending POS per member (12 bulan) — dibaca saat evaluasi.
CREATE INDEX IF NOT EXISTS idx_pos_orders_customer_paid ON pos.pos_orders (customer_id, created_at) WHERE payment_status = 'paid' AND customer_id IS NOT NULL;

-- Kelola tier Membership butuh aksi tambah & hapus di menu Program Loyalitas —
-- diberikan hanya ke role yang sudah boleh mengubah (super_admin/admin/direksi).
UPDATE iam.menus SET permission_context = jsonb_set(COALESCE(permission_context, '{}'::jsonb), '{actions}', '["read","create","update","delete"]'::jsonb), updated_at = now()
WHERE code = 'studio.loyalty';
UPDATE iam.role_menu_permissions p
SET granted_actions = (SELECT jsonb_agg(DISTINCT a) FROM jsonb_array_elements_text(p.granted_actions || '["create","delete"]'::jsonb) a), updated_at = now()
FROM iam.menus m
WHERE m.id = p.menu_id AND m.code = 'studio.loyalty' AND p.granted_actions ? 'update';
