-- EPIC-014 Task 5+6: item sidebar CRM untuk Wallpapers & Badges.
-- Halaman /dashboard/crm/wallpapers dan /dashboard/crm/badges adalah builder
-- collectible Super Admin (guard requireCrmConfigRole di API) — menu hanya
-- di-grant ke super_admin.

-- 1. Item sidebar: Wallpapers
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('crm.wallpapers', 'Wallpapers', '/dashboard/crm/wallpapers',
        'image', 'sidebar', 70, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm', level = 2 WHERE code = 'crm.wallpapers';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.wallpapers' AND parent.code = 'crm';

-- 2. Item sidebar: Badges
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('crm.badges', 'Badges', '/dashboard/crm/badges',
        'award', 'sidebar', 75, '{"actions":["read","create","update","delete"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm', level = 2 WHERE code = 'crm.badges';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.badges' AND parent.code = 'crm';

-- 3. Grant hanya super_admin (builder collectible platform)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'super_admin'
  AND m.code IN ('crm.wallpapers', 'crm.badges')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
