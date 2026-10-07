-- Menu POS → Pengaturan → Supervisor POS (UI kelola PIN void/merge).
--
-- Sebelumnya PIN supervisor (users.pos_pin) hanya bisa diisi manual ke DB —
-- tidak ada satu pun halaman admin yang memuatnya. Halaman baru
-- /dashboard/pos/supervisors menutup bolong itu: tunjuk supervisor,
-- set/reset PIN (tersimpan hash bcrypt), cabut akses.
--
-- Grant: hanya super_admin dan admin — selaras ALLOWED_ROLES di
-- /api/pos/supervisors. Idempotent.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('pos.settings.supervisors', 'Supervisor POS', '/dashboard/pos/supervisors',
        'shield', 'sidebar', 35, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'pos', level = 2 WHERE code = 'pos.settings.supervisors';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'pos.settings.supervisors' AND parent.code = 'pos.settings';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read","update"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin') AND m.code = 'pos.settings.supervisors'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
