-- Fase 2 ESS (Employee Self-Service):
--   • role baru `employee` — karyawan biasa, hanya mengakses area ESS
--   • menu "Area Karyawan" (/dashboard/me): absensi & cuti milik sendiri
-- Diberikan juga ke hrd/hiring_manager (mereka karyawan juga); route API
-- membatasi non-HR ke datanya sendiri sehingga menu ini aman untuk semua.

-- ── 1. Role employee ────────────────────────────────────────────────────
INSERT INTO iam.roles (code, name, description)
VALUES ('employee', 'Karyawan',
        'Karyawan biasa — akses Employee Self-Service (absensi & cuti sendiri)')
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active   = true,
  deleted_at  = NULL,
  updated_at  = now();

-- ── 2. Menu Area Karyawan ───────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ess', 'Area Karyawan', '/dashboard/me', 'calendar',
        'sidebar', 5, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name          = EXCLUDED.menu_name,
  route_path         = EXCLUDED.route_path,
  icon               = EXCLUDED.icon,
  menu_type          = EXCLUDED.menu_type,
  order_number       = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active          = true,
  is_visible         = true,
  deleted_at         = NULL,
  updated_at         = now();

UPDATE iam.menus SET module = 'ess', level = 1, parent_id = NULL
WHERE code = 'ess';

-- ── 3. Permission ───────────────────────────────────────────────────────
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('employee', 'hrd', 'hiring_manager')
  AND m.code = 'ess'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
