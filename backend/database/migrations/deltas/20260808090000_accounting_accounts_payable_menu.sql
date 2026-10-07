-- =============================================================================
-- Move RM Purchasing Invoice → Accounting "Account Payable"
-- =============================================================================

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('accounting.accounts-payable', 'Account Payable',
   '/dashboard/accounting/accounts-payable', 'banknotes', 'sidebar', 39,
   '{"actions":["read","create","update"]}'::jsonb)
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
WHERE child.code = 'accounting.accounts-payable'
  AND parent.code = 'accounting';

-- Hide old RM purchasing invoice sidebar entry
UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    deleted_at = COALESCE(deleted_at, now()),
    updated_at = now()
WHERE code = 'items.raw-material.purchasing.invoice';

-- Grant AP menu to roles that previously had RM invoice + finance
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       COALESCE(
         (
           SELECT rmp.granted_actions
           FROM iam.role_menu_permissions rmp
           JOIN iam.menus old ON old.id = rmp.menu_id
           WHERE rmp.role_id = r.id
             AND old.code = 'items.raw-material.purchasing.invoice'
           LIMIT 1
         ),
         COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
       ),
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN (
    'super_admin', 'admin', 'finance_staff',
    'purchasing_admin', 'purchasing_manager', 'purchasing_staff'
  )
  AND m.code = 'accounting.accounts-payable'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
