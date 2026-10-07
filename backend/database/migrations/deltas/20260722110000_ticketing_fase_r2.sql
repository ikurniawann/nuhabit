-- EPIC-023 Fase R2: Channel Manager — sub-menu distribusi ticket ke kanal
-- (POS walk-in / Website booking) + harga override per kanal per varian.
-- Skema distribusi & override sudah dibuat di R1; delta ini hanya menu.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('ticketing.channel-manager', 'Channel Manager',
        '/dashboard/ticketing/channel-manager', 'ticket', 'sidebar', 7,
        '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'ticketing', level = 2
WHERE code = 'ticketing.channel-manager';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'ticketing.channel-manager' AND parent.code = 'ticketing';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'super_admin' AND m.code = 'ticketing.channel-manager'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
