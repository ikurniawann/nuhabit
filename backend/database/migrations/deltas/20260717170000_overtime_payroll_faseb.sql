-- EPIC-008 Fase B: integrasi payroll ↔ absensi v2 + pengajuan lembur dua arah.
--   1. hris.overtime_requests — pengajuan lembur karyawan (ESS) DAN penugasan
--      lembur dari perusahaan (dibuat HRD, dikonfirmasi karyawan).
--   2. Kolom kebijakan payroll di payroll_settings: potongan keterlambatan
--      (konfigurabel, nonaktif default) + pembagi upah per jam lembur (1/173).
--   3. Kolom late_deduction di payroll_details agar potongan telat tampil
--      terpisah di slip (bukan menumpang other_deduction).
--   4. Menu: ESS → Lembur, Kepegawaian → Lembur (HRD).

-- ── 1. Pengajuan lembur dua arah ────────────────────────────────────────
-- source 'employee': diajukan karyawan → diputuskan HRD/atasan langsung.
-- source 'company' : penugasan dibuat HRD → dikonfirmasi/ditolak karyawan ybs.
CREATE TABLE IF NOT EXISTS hris.overtime_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  date             date NOT NULL,
  start_time       time NOT NULL,
  end_time         time NOT NULL,
  hours            numeric(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  source           text NOT NULL DEFAULT 'employee' CHECK (source IN ('employee','company')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason           text,
  requested_by     uuid REFERENCES hris.employees(id),
  decided_by       uuid REFERENCES hris.employees(id),
  decided_at       timestamptz,
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS overtime_requests_employee_date_idx
  ON hris.overtime_requests (employee_id, date);
CREATE INDEX IF NOT EXISTS overtime_requests_status_date_idx
  ON hris.overtime_requests (status, date);

DROP TRIGGER IF EXISTS update_overtime_requests_updated_at ON hris.overtime_requests;
CREATE TRIGGER update_overtime_requests_updated_at
  BEFORE UPDATE ON hris.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Kebijakan payroll baru ───────────────────────────────────────────
-- late_deduction_mode: 'off' (default) | 'per_minute' | 'flat'
--   per_minute → late_deduction_amount = Rp per menit keterlambatan
--   flat       → late_deduction_amount = Rp per kejadian terlambat
-- overtime_hourly_divisor: upah per jam lembur = gaji pokok / pembagi
--   (standar Kepmenaker: 173).
ALTER TABLE hris.payroll_settings
  ADD COLUMN IF NOT EXISTS late_deduction_mode     text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS late_deduction_amount   numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_hourly_divisor numeric(6,2) NOT NULL DEFAULT 173;

-- ── 3. Potongan telat terpisah di detail payroll ────────────────────────
ALTER TABLE hris.payroll_details
  ADD COLUMN IF NOT EXISTS late_deduction numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_hours numeric(6,2) NOT NULL DEFAULT 0;

-- ── 4a. Menu ESS → Lembur ───────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ess.overtime', 'Lembur', '/dashboard/me/lembur', 'clock', 'sidebar', 30,
        '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'ess', level = 2 WHERE code = 'ess.overtime';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'ess.overtime' AND parent.code = 'ess';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('employee', 'hrd', 'hiring_manager') AND m.code = 'ess.overtime'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- ── 4b. Menu Kepegawaian → Lembur (HRD) ─────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.kepegawaian.overtime', 'Lembur', '/dashboard/hris/overtime', 'clock',
        'sidebar', 40, '{"actions":["read","create","update","approve"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'hris', level = 3 WHERE code = 'hris.kepegawaian.overtime';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.kepegawaian.overtime' AND parent.code = 'hris.kepegawaian';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'hris.kepegawaian.overtime'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'hrd' AND m.code = 'hris.kepegawaian.overtime'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
