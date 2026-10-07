-- AR: Invoice B2B (funnel) di bawah Accounts Receivable; retire menu Finance

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES (
  'accounting.receivable.invoices-b2b',
  'Invoice B2B',
  '/dashboard/accounting/receivable/invoices-b2b',
  'file-text',
  'sidebar',
  20,
  '{"actions":["read","create","update","delete"]}'::jsonb
)
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

UPDATE iam.menus
SET module = 'accounting',
    level = 3,
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
WHERE code = 'accounting.receivable.invoices-b2b';

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code = 'accounting.receivable.invoices-b2b'
  AND parent.code = 'accounting.receivable';

UPDATE iam.menus
SET order_number = 30, updated_at = now()
WHERE code = 'accounting.receivable.invoices';

UPDATE iam.menus
SET order_number = 40, updated_at = now()
WHERE code = 'accounting.receivable.receipts';

UPDATE iam.menus
SET order_number = 50, updated_at = now()
WHERE code = 'accounting.receivable.aging';

UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    deleted_at = COALESCE(deleted_at, now()),
    updated_at = now()
WHERE code IN ('finance', 'finance.invoices')
  AND deleted_at IS NULL;

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       '["read","create","update","delete","approve","export","import","execute"]'::jsonb,
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'accounting.receivable.invoices-b2b'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       COALESCE(
         (
           SELECT rmp.granted_actions
           FROM iam.role_menu_permissions rmp
           JOIN iam.menus old ON old.id = rmp.menu_id
           WHERE rmp.role_id = r.id
             AND old.code = 'finance.invoices'
           LIMIT 1
         ),
         COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
       ),
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code = 'finance_staff'
  AND m.code = 'accounting.receivable.invoices-b2b'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
