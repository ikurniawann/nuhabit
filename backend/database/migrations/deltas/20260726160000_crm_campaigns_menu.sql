-- EPIC-033 — menu Kampanye WA di bawah modul CRM.
-- Grant: super_admin + marketing. Idempoten, reversible.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES ('crm.campaigns', 'Kampanye WA',
        '/dashboard/crm/campaigns', 'megaphone', 'sidebar', 7,
        '{"actions":["read","create","update"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'crm', level = 2 WHERE code = 'crm.campaigns';
UPDATE iam.menus child SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'crm.campaigns' AND parent.code = 'crm';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'marketing') AND m.code = 'crm.campaigns'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now();

-- Marketing juga butuh menu induk CRM agar grupnya tampil
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read"]'::jsonb
FROM iam.roles r CROSS JOIN iam.menus m
WHERE r.code = 'marketing' AND m.code = 'crm'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true, updated_at = now();
