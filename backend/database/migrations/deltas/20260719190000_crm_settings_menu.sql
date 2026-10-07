-- EPIC-011 Fase B: sub-menu CRM Settings di sidebar CRM.
-- Halaman /dashboard/crm/settings adalah konfigurasi Super Admin (tier, XP
-- rules, bonus topup %, free XP) — menu hanya di-grant ke super_admin,
-- selaras guard requireCrmConfigRole di API-nya.

-- 1. Grup level 2: CRM → Pengaturan
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('crm.settings', 'Pengaturan', NULL, 'settings', 'group', 90, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm', level = 2 WHERE code = 'crm.settings';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.settings' AND parent.code = 'crm';

-- 2. Item sidebar level 3: CRM Settings
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('crm.settings.config', 'CRM Settings', '/dashboard/crm/settings',
        'settings', 'sidebar', 10, '{"actions":["read","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm', level = 3 WHERE code = 'crm.settings.config';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.settings.config' AND parent.code = 'crm.settings';

-- 3. Grant hanya super_admin (konfigurasi platform)
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'super_admin'
  AND m.code IN ('crm.settings', 'crm.settings.config')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();
