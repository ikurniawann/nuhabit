-- =============================================================================
-- Studio — Kalender Kelas (monitoring jadwal dalam bentuk kalender hari/minggu/
-- bulan). Halaman baca saja; pengeditan tetap di Jadwal Kelas.
-- =============================================================================

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('studio.calendar', 'Kalender Kelas', '/dashboard/studio/calendar', 'calendar', 'sidebar', 7,
        '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'studio', level = 2 WHERE code = 'studio.calendar';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent WHERE child.code = 'studio.calendar' AND parent.code = 'studio';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id, '["read"]'::jsonb, true
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin', 'direksi') AND m.code = 'studio.calendar'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
