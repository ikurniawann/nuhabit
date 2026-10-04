-- EPIC-050 Fase 4 — Reports & Dashboards
-- T-4.1 report builder, T-4.2 dashboard builder, T-4.3 report terjadwal (WA).

-- ============================================================
-- 1. Report tersimpan
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),   -- NULL = global (super admin)
  name varchar(120) NOT NULL,
  description varchar(500),
  dataset varchar(30) NOT NULL,
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared boolean NOT NULL DEFAULT true,                  -- false = hanya pembuat
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_reports_company ON crm.crm_reports (company_id) WHERE deleted_at IS NULL;

-- ============================================================
-- 2. Dashboard + widget
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),
  name varchar(120) NOT NULL,
  description varchar(500),
  -- true = dipakai sebagai Overview CRM untuk company tsb
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_dashboards_company ON crm.crm_dashboards (company_id) WHERE deleted_at IS NULL;
-- Hanya satu default per company (NULL company = slot global tersendiri).
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_dashboards_default
  ON crm.crm_dashboards (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS crm.crm_dashboard_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id uuid NOT NULL REFERENCES crm.crm_dashboards(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES crm.crm_reports(id) ON DELETE CASCADE,
  title varchar(120),
  -- chart = pakai chart_type report; kpi = tampilkan satu angka agregat
  widget_type varchar(20) NOT NULL DEFAULT 'chart',
  -- 1 = sepertiga lebar, 2 = dua pertiga, 3 = penuh
  width int NOT NULL DEFAULT 1 CHECK (width BETWEEN 1 AND 3),
  sort_order int NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_dashboard_widgets_dash ON crm.crm_dashboard_widgets (dashboard_id, sort_order);

-- ============================================================
-- 3. Report terjadwal (WA; email menyusul di Fase 7)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.crm_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id),
  report_id uuid NOT NULL REFERENCES crm.crm_reports(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  frequency varchar(20) NOT NULL DEFAULT 'weekly',     -- daily | weekly | monthly
  hour int NOT NULL DEFAULT 8 CHECK (hour BETWEEN 0 AND 23),
  day_of_week int CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Minggu (frequency weekly)
  day_of_month int CHECK (day_of_month BETWEEN 1 AND 28),
  channel varchar(20) NOT NULL DEFAULT 'wa',           -- wa | in_app
  -- [{ "type": "user", "user_id": "..." } | { "type": "number", "number": "628.." }]
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_status varchar(20),
  last_error text,
  next_run_at timestamptz,
  created_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_report_schedules_due
  ON crm.crm_report_schedules (next_run_at) WHERE is_active;

-- ============================================================
-- 4. Menu sidebar — CRM → Laporan
-- ============================================================
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('crm.reports.builder', 'Report Builder', '/dashboard/crm/reports/builder', 'chart-bar',
   'sidebar', 20, '{"actions":["read","create","update","delete","export"]}'::jsonb),
  ('crm.reports.dashboards', 'Dashboard CRM', '/dashboard/crm/dashboards', 'home',
   'sidebar', 30, '{"actions":["read","create","update","delete"]}'::jsonb),
  ('crm.reports.schedules', 'Laporan Terjadwal', '/dashboard/crm/reports/schedules', 'clock',
   'sidebar', 40, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm'
WHERE code IN ('crm.reports.builder', 'crm.reports.dashboards', 'crm.reports.schedules');

UPDATE iam.menus child SET parent_id = parent.id, updated_at = now()
FROM iam.menus parent
WHERE parent.code = 'crm.reports'
  AND child.code IN ('crm.reports.builder', 'crm.reports.dashboards', 'crm.reports.schedules');

WITH RECURSIVE tree AS (
  SELECT id, 1 AS lvl FROM iam.menus WHERE code = 'crm'
  UNION ALL
  SELECT m.id, t.lvl + 1 FROM iam.menus m JOIN tree t ON m.parent_id = t.id
)
UPDATE iam.menus m SET level = t.lvl, updated_at = now()
FROM tree t WHERE t.id = m.id AND m.level IS DISTINCT FROM t.lvl;

-- Grant: super_admin & admin penuh; role lain yang sudah pegang crm.reports.overview → read.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code IN ('crm.reports.builder', 'crm.reports.dashboards', 'crm.reports.schedules')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT rmp.role_id, m.id, '["read"]'::jsonb
FROM iam.role_menu_permissions rmp
JOIN iam.menus om ON om.id = rmp.menu_id AND om.code = 'crm.reports.overview'
JOIN iam.roles r ON r.id = rmp.role_id AND r.code NOT IN ('super_admin', 'admin')
CROSS JOIN iam.menus m
WHERE rmp.is_active
  AND m.code IN ('crm.reports.builder', 'crm.reports.dashboards', 'crm.reports.schedules')
ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, updated_at = now();
