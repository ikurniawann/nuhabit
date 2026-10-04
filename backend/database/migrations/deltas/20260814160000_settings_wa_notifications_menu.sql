-- Sub-menu Settings → Notifikasi WA di dashboard.
--
-- Konfigurasi ini (recipients owner EPIC-020 + penerima laporan tutup kasir)
-- selama ini hanya bisa dibuka dari jendela Settings di desktop /arkiv-os —
-- tempat yang tidak ditemukan pengguna dashboard. Halaman dashboard baru
-- menumpang komponen dan API yang sama; menu ini hanya pintunya.
--
-- Grant: super_admin dan direksi — mengikuti ALLOWED_ROLES di
-- /api/settings/wa-notifications.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('settings.wa_notifications', 'Notifikasi WA', '/dashboard/settings/wa-notifications',
        'settings', 'sidebar', 13, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'settings', level = 2 WHERE code = 'settings.wa_notifications';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'settings.wa_notifications' AND parent.code = 'settings';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'direksi') AND m.code = 'settings.wa_notifications'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
