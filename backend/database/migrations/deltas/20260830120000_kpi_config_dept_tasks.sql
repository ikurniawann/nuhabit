-- Konfigurasi KPI + Task Departemen (permintaan owner 2026-08-30):
-- 1) Halaman ceklis HRD: indikator mana berpengaruh ke KPI per peran
--    (mis. absen kena utk kasir, tidak utk HRD) — mesin per-peran sudah
--    ada (kpi_role_indicators), delta ini menambah jejak pengubah.
-- 2) Task management departemen: task rutin (harian/mingguan/bulanan)
--    dan task sekali jalan, ditandai selesai oleh penanggung jawab,
--    direview HRD, dan dihitung sebagai indikator KPI 'task_completion'
--    (konsep MBO / task compliance).

-- ── 1. Jejak pengubah konfigurasi KPI ────────────────────────────────
ALTER TABLE performance.kpi_role_indicators
  ADD COLUMN IF NOT EXISTS updated_by varchar(120);

-- ── 2. Task departemen ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hris.department_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES hris.departments(id),
  assignee_employee_id uuid REFERENCES hris.employees(id),
  title varchar(200) NOT NULL,
  description text,
  -- 'once' | 'daily' | 'weekly' | 'monthly'
  recurrence varchar(10) NOT NULL DEFAULT 'once',
  weekly_day int CHECK (weekly_day BETWEEN 1 AND 7),      -- utk weekly (1=Senin)
  monthly_day int CHECK (monthly_day BETWEEN 1 AND 28),   -- utk monthly
  due_date date,                                          -- utk once
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_by_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_department_tasks_dept
  ON hris.department_tasks(department_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS hris.department_task_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES hris.department_tasks(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  -- 'pending' → 'done' (ditandai penanggung jawab) → 'approved'/'rejected' (HRD)
  status varchar(12) NOT NULL DEFAULT 'pending',
  done_at timestamptz,
  done_by uuid,
  done_by_name varchar(120),
  review_notes text,
  reviewed_by uuid,
  reviewed_by_name varchar(120),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, occurrence_date)
);
CREATE INDEX IF NOT EXISTS idx_dept_task_occ_date
  ON hris.department_task_occurrences(occurrence_date);

-- ── 3. Indikator KPI baru: Penyelesaian Tugas Departemen ─────────────
-- Nilai per karyawan = tugas ter-approve HRD ÷ tugas jatuh tempo pada
-- periode (occurrence assignee ybs). Target default 90% (pola logbook).
INSERT INTO performance.kpi_indicators
  (code, name, description, unit, direction, source_kind, source_ref, default_target, is_active)
VALUES
  ('task_completion', 'Penyelesaian Tugas Departemen',
   'Persentase tugas departemen (rutin & sekali jalan) yang selesai dan disetujui HRD pada periodenya.',
   '%', 'higher_better', 'auto', 'hris.department_task_occurrences', 0.9000, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  unit = EXCLUDED.unit, direction = EXCLUDED.direction,
  source_kind = EXCLUDED.source_kind, source_ref = EXCLUDED.source_ref,
  is_active = true, updated_at = now();

-- ── 4. Menu ──────────────────────────────────────────────────────────
-- 4a. Konfigurasi KPI (khusus pengelola KPI: super_admin/administrator/hrd)
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.performance.kpi-config', 'Konfigurasi KPI', '/dashboard/hris/kpi-config',
        'adjustments-horizontal', 'sidebar', 68, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'hris', level = 3 WHERE code = 'hris.performance.kpi-config';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.performance.kpi-config' AND parent.code = 'hris.performance';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, m.permission_context->'actions'
FROM iam.roles r CROSS JOIN iam.menus m
WHERE m.code = 'hris.performance.kpi-config'
  AND r.code IN ('super_admin', 'administrator', 'admin', 'hrd')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- 4b. Task Departemen (semua role — halaman & API yang menyaring aksi:
--     anggota menandai selesai, supervisor mengelola, HRD mereview)
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('hris.performance.dept-tasks', 'Task Departemen', '/dashboard/hris/dept-tasks',
        'clipboard-document-check', 'sidebar', 66, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'hris', level = 3 WHERE code = 'hris.performance.dept-tasks';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'hris.performance.dept-tasks' AND parent.code = 'hris.performance';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, m.permission_context->'actions'
FROM iam.roles r CROSS JOIN iam.menus m
WHERE m.code = 'hris.performance.dept-tasks' AND r.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
