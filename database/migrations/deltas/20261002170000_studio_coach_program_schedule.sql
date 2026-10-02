-- =============================================================================
-- EPIC-052 — Studio: Coach, Program Kelas & Jadwal (fondasi Nuhabit / Hyrox)
--
-- Schema baru `studio` untuk domain venue Hyrox. Alur:
--   program (jenis kelas) + coach  →  template mingguan (slot per hari/jam)
--   →  generate  →  class_sessions (jadwal nyata per tanggal, bisa diubah
--   per sesi: ganti coach, ubah kuota, batalkan).
-- Booking member (EPIC-054), pass (EPIC-053) & komisi coach (EPIC-056)
-- menempel ke class_sessions.
--
-- Konvensi: company_id + branch_id di setiap tabel, enum = varchar + CHECK,
-- SQL selalu schema-qualified (studio.*). Idempoten.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS studio;

-- ── Coach ───────────────────────────────────────────────────────────────────
-- Profil publik + level. employee_id menautkan ke HRIS (fix salary tetap di
-- payroll); komisi dihitung terpisah di EPIC-056.
CREATE TABLE IF NOT EXISTS studio.coaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  employee_id uuid REFERENCES hris.employees(id) ON DELETE SET NULL,
  full_name varchar(120) NOT NULL,
  display_name varchar(60),
  level varchar(20) NOT NULL DEFAULT 'coach' CHECK (level IN ('coach', 'head_coach')),
  phone varchar(30),
  email varchar(160),
  photo_url text,
  bio text,
  certifications text,
  specialties text[] NOT NULL DEFAULT '{}',
  is_public boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_studio_coaches_branch ON studio.coaches(branch_id, is_active, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_coaches_employee
  ON studio.coaches(branch_id, employee_id) WHERE employee_id IS NOT NULL;

-- ── Program (jenis kelas / sesi) ────────────────────────────────────────────
-- kind 'class' = kelas grup berkuota; 'pt' = personal training (1:1).
CREATE TABLE IF NOT EXISTS studio.programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  code varchar(30) NOT NULL,
  name varchar(120) NOT NULL,
  kind varchar(10) NOT NULL DEFAULT 'class' CHECK (kind IN ('class', 'pt')),
  description text,
  duration_minutes integer NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 15 AND 240),
  default_capacity integer NOT NULL DEFAULT 12 CHECK (default_capacity BETWEEN 1 AND 200),
  level_label varchar(40),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_programs_code ON studio.programs(branch_id, upper(code));
CREATE INDEX IF NOT EXISTS idx_studio_programs_branch ON studio.programs(branch_id, is_active, sort_order);

-- ── Template jadwal mingguan ────────────────────────────────────────────────
-- weekday ISO: 1 = Senin … 7 = Minggu. Satu baris = satu slot kelas berulang.
CREATE TABLE IF NOT EXISTS studio.schedule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL,
  program_id uuid NOT NULL REFERENCES studio.programs(id) ON DELETE CASCADE,
  coach_id uuid REFERENCES studio.coaches(id) ON DELETE SET NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 200),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_schedule_templates_window CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_studio_templates_branch ON studio.schedule_templates(branch_id, weekday, start_time);

-- ── Sesi kelas (jadwal nyata per tanggal) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS studio.class_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  session_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  program_id uuid NOT NULL REFERENCES studio.programs(id) ON DELETE RESTRICT,
  coach_id uuid REFERENCES studio.coaches(id) ON DELETE SET NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 200),
  status varchar(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  template_id uuid REFERENCES studio.schedule_templates(id) ON DELETE SET NULL,
  cancel_reason text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_class_sessions_window CHECK (end_time > start_time)
);
-- Generate idempoten: satu template hanya menghasilkan satu sesi per tanggal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_sessions_template_date
  ON studio.class_sessions(template_id, session_date) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_studio_sessions_branch_date
  ON studio.class_sessions(branch_id, session_date, start_time);
CREATE INDEX IF NOT EXISTS idx_studio_sessions_coach_date
  ON studio.class_sessions(coach_id, session_date) WHERE coach_id IS NOT NULL;

-- ── Menu: grup "Kelas & Coach" ──────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('studio', 'Kelas & Coach', NULL, 'calendar', 'group', 8, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 1, parent_id = NULL WHERE code = 'studio';

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('studio.schedule', 'Jadwal Kelas', '/dashboard/studio/schedule', 'calendar', 'sidebar', 10,
   '{"actions":["read","create","update","delete"]}'::jsonb),
  ('studio.templates', 'Template Mingguan', '/dashboard/studio/templates', 'clipboard', 'sidebar', 20,
   '{"actions":["read","create","update","delete"]}'::jsonb),
  ('studio.programs', 'Program Kelas', '/dashboard/studio/programs', 'file-text', 'sidebar', 30,
   '{"actions":["read","create","update","delete"]}'::jsonb),
  ('studio.coaches', 'Coach', '/dashboard/studio/coaches', 'identification', 'sidebar', 40,
   '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code LIKE 'studio.%';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code LIKE 'studio.%' AND parent.code = 'studio';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb), true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi')
  AND (m.code = 'studio' OR m.code LIKE 'studio.%')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
