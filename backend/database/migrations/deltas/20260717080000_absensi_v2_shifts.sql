-- Absensi v2 (EPIC-007 Tahap A–D): shift kerja per karyawan + selfie absen.
--   1. Master shift (hris.shifts) + jadwal mingguan per karyawan
--      (hris.employee_shifts, berversi via effective_from/to).
--   2. Kolom foto selfie + snapshot shift di hris.attendance — snapshot agar
--      perubahan jadwal tidak mengubah catatan absen lama.
--   3. Menu Kepegawaian → Shift Kerja + submenu ESS (Absensi, Izin & Cuti).

-- ── 1. Master shift ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hris.shifts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  start_time             time NOT NULL,
  end_time               time NOT NULL,
  break_minutes          integer NOT NULL DEFAULT 60 CHECK (break_minutes >= 0),
  late_tolerance_minutes integer NOT NULL DEFAULT 10 CHECK (late_tolerance_minutes >= 0),
  is_overnight           boolean NOT NULL DEFAULT false,
  is_active              boolean NOT NULL DEFAULT true,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_shifts_updated_at ON hris.shifts;
CREATE TRIGGER update_shifts_updated_at
  BEFORE UPDATE ON hris.shifts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO hris.shifts (name, start_time, end_time, break_minutes, late_tolerance_minutes, is_overnight, sort_order)
SELECT * FROM (VALUES
  ('Shift Pagi',  '08:00'::time, '16:00'::time, 60, 10, false, 10),
  ('Shift Siang', '14:00'::time, '22:00'::time, 60, 10, false, 20),
  ('Shift Malam', '22:00'::time, '06:00'::time, 60, 10, true,  30)
) AS seed(name, start_time, end_time, break_minutes, late_tolerance_minutes, is_overnight, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM hris.shifts);

-- ── 2. Jadwal mingguan per karyawan ─────────────────────────────────────
-- Satu baris per (karyawan, hari, periode-berlaku); shift_id NULL = libur.
-- Perubahan pola = tutup baris lama (effective_to) + insert pola baru,
-- sehingga riwayat jadwal tersimpan utk audit keterlambatan.
CREATE TABLE IF NOT EXISTS hris.employee_shifts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES hris.employees(id) ON DELETE CASCADE,
  day_of_week    integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Senin
  shift_id       uuid REFERENCES hris.shifts(id),
  effective_from date NOT NULL,
  effective_to   date CHECK (effective_to IS NULL OR effective_to >= effective_from),
  created_by_name text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_shifts_lookup_idx
  ON hris.employee_shifts (employee_id, day_of_week, effective_from DESC);

-- ── 3. Kolom absensi: selfie + snapshot shift ───────────────────────────
ALTER TABLE hris.attendance
  ADD COLUMN IF NOT EXISTS clock_in_photo_url  text,
  ADD COLUMN IF NOT EXISTS clock_out_photo_url text,
  ADD COLUMN IF NOT EXISTS shift_id            uuid REFERENCES hris.shifts(id),
  ADD COLUMN IF NOT EXISTS scheduled_start     timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end       timestamptz;

-- ── 4. Menu: Kepegawaian → Shift Kerja ──────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.kepegawaian.shifts', 'Shift Kerja', '/dashboard/hris/shifts', 'clipboard',
        'sidebar', 30, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'hris', level = 3 WHERE code = 'hris.kepegawaian.shifts';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.kepegawaian.shifts' AND parent.code = 'hris.kepegawaian';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'hris.kepegawaian.shifts'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'hrd' AND m.code = 'hris.kepegawaian.shifts'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- ── 5. Menu ESS dipecah: Area Karyawan (grup) → Absensi + Izin & Cuti ──
UPDATE iam.menus
SET route_path = NULL, menu_type = 'group', updated_at = now()
WHERE code = 'ess' AND deleted_at IS NULL;

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('ess.attendance', 'Absensi', '/dashboard/me/absensi', 'calendar', 'sidebar', 10, '{"actions":["read"]}'::jsonb),
  ('ess.leave', 'Izin & Cuti', '/dashboard/me/cuti', 'paper-airplane', 'sidebar', 20, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'ess', level = 2
WHERE code IN ('ess.attendance', 'ess.leave');
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('ess.attendance', 'ess.leave') AND parent.code = 'ess';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('employee', 'hrd', 'hiring_manager')
  AND m.code IN ('ess.attendance', 'ess.leave')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
