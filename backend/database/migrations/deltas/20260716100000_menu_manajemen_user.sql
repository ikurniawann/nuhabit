-- Pisahkan menu "Users" (campuran karyawan + akun) menjadi dua menu:
--   • hris.users     → "Karyawan" (/dashboard/employees) — direktori karyawan (HRIS)
--   • settings.users → "Manajemen User" (/dashboard/settings/users) — akun login,
--     role, reset password, akses aplikasi (IAM)
-- Halaman /dashboard/settings/users diubah dari redirect menjadi halaman sungguhan.

-- ── 1. Ganti label menu direktori karyawan ─────────────────────────────
UPDATE iam.menus
SET menu_name = 'Karyawan', updated_at = now()
WHERE code = 'hris.users' AND deleted_at IS NULL;

-- ── 2. Menu baru: Manajemen User di grup Settings ──────────────────────
-- order 35: antara Menu Configuration (30) dan Role & Permission (40),
-- berdampingan dengan pengaturan akses lain.
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('settings.users', 'Manajemen User', '/dashboard/settings/users', 'users',
        'sidebar', 35, '{"actions":["read"]}'::jsonb)
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

UPDATE iam.menus
SET module = 'settings', level = 2
WHERE code = 'settings.users';

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'settings.users'
  AND parent.code = 'settings';

-- ── 3. Permission ───────────────────────────────────────────────────────
-- super_admin & admin: semua action (pola iam-admin-permissions.sql)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'settings.users'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

-- hrd: read — paritas requireRole halaman; pembuatan akun/reset password
-- tetap ditegakkan di route handler, bukan di grant IAM.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code = 'hrd'
  AND m.code = 'settings.users'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
