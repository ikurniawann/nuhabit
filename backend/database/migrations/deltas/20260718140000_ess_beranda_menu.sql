-- Menu "Beranda" untuk Area Karyawan (ESS): /dashboard/me kini beranda
-- ringkasan (bukan lagi redirect ke absensi). Item mandiri top-level di atas
-- Pengumuman (order 1) — tampil utk SEMUA role; API menggate berdasarkan
-- keterhubungan akun ke record karyawan.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, module, level, permission_context)
VALUES ('ess.home', 'Beranda', '/dashboard/me',
        'home', 'sidebar', 1, 'ess', 1, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, module = EXCLUDED.module,
  level = EXCLUDED.level, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.deleted_at IS NULL AND m.code = 'ess.home'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
