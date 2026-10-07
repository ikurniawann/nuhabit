-- =============================================================================
-- IAM: Beginning Balance menu under Accounting
-- =============================================================================

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('accounting.beginning-balance', 'Beginning Balance',
   '/dashboard/accounting/beginning-balance', 'banknotes', 'sidebar', 38,
   '{"actions":["read","create","update","delete","approve"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name          = EXCLUDED.menu_name,
  route_path         = EXCLUDED.route_path,
  icon               = EXCLUDED.icon,
  menu_type          = EXCLUDED.menu_type,
  order_number       = EXCLUDED.order_number,
  permission_context = EXCLUDED.permission_context,
  is_active          = true,
  is_visible         = true,
  deleted_at         = NULL,
  updated_at         = now();

UPDATE iam.menus child
SET module = 'accounting',
    level = 2,
    parent_id = parent.id,
    is_active = true,
    is_visible = true,
    deleted_at = NULL
FROM iam.menus parent
WHERE child.code = 'accounting.beginning-balance'
  AND parent.code = 'accounting';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       '["read","create","update","delete","approve","export","import","execute"]'::jsonb,
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'accounting.beginning-balance'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       COALESCE(m.permission_context->'actions', '["read"]'::jsonb),
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code = 'finance_staff'
  AND m.code = 'accounting.beginning-balance'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
