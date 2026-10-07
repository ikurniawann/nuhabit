-- EPIC-032 A3 — menu sidebar Engine Promosi (level 1 'promo' + level 2
-- 'promo.campaigns'). Grant super_admin; role marketing menyusul Task A4.
-- Idempoten (ON CONFLICT), reversible.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('promo', 'Promo', NULL, 'gift', 'sidebar', 85, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type, order_number = EXCLUDED.order_number,
  is_active = true, is_visible = true, deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'promo', level = 1 WHERE code = 'promo';

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('promo.campaigns', 'Campaign & Voucher',
        '/dashboard/promo', 'ticket', 'sidebar', 1,
        '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();
UPDATE iam.menus SET module = 'promo', level = 2 WHERE code = 'promo.campaigns';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'promo.campaigns' AND parent.code = 'promo';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'super_admin' AND m.code IN ('promo', 'promo.campaigns')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
