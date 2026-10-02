-- =============================================================================
-- EPIC-056 — Studio: Komisi Coach (di luar payroll) + Coach Portal
--
-- Skema owner (Excel "Staffing Assumptions" → Incentive Spread):
--   pool = 10% revenue kelas + 40% revenue Personal Training (bisa diubah)
--   dibagi per orang menurut peran: Head Coach 20%, Coach 16% (bisa diubah,
--   override per coach). Keputusan owner 2026-10-02 (opsi B): persentase per
--   orang TETAP; bila total < 100% sisa pool = revenue perusahaan; bila > 100%
--   approve diblokir sampai disesuaikan.
--   Revenue = nilai kredit yang diakui saat dipakai (redeem: hadir, no-show,
--   batal telat) di bulan itu. Breakage pass kedaluwarsa TIDAK masuk pool.
--
-- Alur bulanan: draft (hitung ulang bebas) → approved (angka dikunci, jurnal
-- STUDIO_COMMISSION_ACCRUAL: Dr beban komisi, Cr utang komisi) → paid per coach
-- (STUDIO_COMMISSION_PAYMENT: Dr utang komisi, Cr kas/bank). Gaji tetap tetap
-- di payroll HRIS.
-- =============================================================================

ALTER TABLE studio.coaches ADD COLUMN IF NOT EXISTS commission_share_percent numeric(5,2)
  CHECK (commission_share_percent IS NULL OR (commission_share_percent >= 0 AND commission_share_percent <= 100));

CREATE TABLE IF NOT EXISTS studio.commission_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  period date NOT NULL,                      -- tanggal 1 bulan
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  class_revenue numeric(14,2) NOT NULL DEFAULT 0,
  pt_revenue numeric(14,2) NOT NULL DEFAULT 0,
  class_pool_percent numeric(5,2) NOT NULL,
  pt_pool_percent numeric(5,2) NOT NULL,
  class_pool numeric(14,2) NOT NULL DEFAULT 0,
  pt_pool numeric(14,2) NOT NULL DEFAULT 0,
  total_pool numeric(14,2) NOT NULL DEFAULT 0,
  allocated_percent numeric(6,2) NOT NULL DEFAULT 0,
  allocated_amount numeric(14,2) NOT NULL DEFAULT 0,
  retained_amount numeric(14,2) NOT NULL DEFAULT 0,
  computed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  accrual_journal_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_commission_period_first_day CHECK (extract(day FROM period) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_commission_period ON studio.commission_periods(branch_id, period);

CREATE TABLE IF NOT EXISTS studio.commission_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES studio.commission_periods(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  coach_id uuid NOT NULL REFERENCES studio.coaches(id) ON DELETE RESTRICT,
  coach_name varchar(120) NOT NULL,
  level varchar(20) NOT NULL,
  share_percent numeric(5,2) NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  class_sessions integer NOT NULL DEFAULT 0,
  pt_sessions integer NOT NULL DEFAULT 0,
  attendees integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at timestamptz,
  paid_by uuid,
  payment_method varchar(20) CHECK (payment_method IN ('cash', 'transfer')),
  payment_ref varchar(120),
  payment_journal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_commission_line ON studio.commission_lines(period_id, coach_id);
CREATE INDEX IF NOT EXISTS idx_studio_commission_lines_coach ON studio.commission_lines(coach_id, status);

-- ── Menu ────────────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('studio.commissions', 'Komisi Coach', '/dashboard/studio/commissions', 'dollar-sign', 'sidebar', 50,
        '{"actions":["read","create","update","approve"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code = 'studio.commissions';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'studio.commissions' AND parent.code = 'studio';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi') AND m.code = 'studio.commissions'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
