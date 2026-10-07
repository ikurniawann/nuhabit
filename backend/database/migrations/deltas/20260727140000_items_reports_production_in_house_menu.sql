-- Add Items → Reports → Production In-House menu

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('items.reports.production-in-house', 'Production In-House', '/dashboard/purchasing/reports/production-in-house',
   'cube', 'sidebar', 60, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name,
  route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon,
  menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active = true,
  is_visible = true,
  deleted_at = NULL,
  updated_at = now();

UPDATE iam.menus
SET module = 'items',
    level = 3,
    updated_at = now()
WHERE code = 'items.reports.production-in-house';

UPDATE iam.menus child
SET parent_id = parent.id,
    updated_at = now()
FROM iam.menus parent
WHERE child.code = 'items.reports.production-in-house'
  AND parent.code = 'items.reports';

-- Grant to roles that already can open other Items reports
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT rmp.role_id, m_new.id, COALESCE(rmp.granted_actions, '["read"]'::jsonb), true
FROM iam.role_menu_permissions rmp
JOIN iam.menus m_src ON m_src.id = rmp.menu_id
  AND m_src.code = 'items.reports.po-summary'
CROSS JOIN iam.menus m_new
WHERE m_new.code = 'items.reports.production-in-house'
  AND rmp.is_active
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at = now();
