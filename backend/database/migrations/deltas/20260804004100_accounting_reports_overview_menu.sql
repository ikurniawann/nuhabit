-- Add clickable Overview under Reports hub
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('accounting.reports.overview', 'All Reports',
   '/dashboard/accounting/reports', 'chart-bar', 'sidebar', 38,
   '{"actions":["read","export"]}'::jsonb)
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
    level = 3,
    parent_id = parent.id,
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    order_number = 38
FROM iam.menus parent
WHERE child.code = 'accounting.reports.overview'
  AND parent.code = 'accounting.reports';

-- Bump report children order after overview
UPDATE iam.menus SET order_number = 39, updated_at = now()
WHERE code = 'accounting.reports.balance-sheet';
UPDATE iam.menus SET order_number = 40, updated_at = now()
WHERE code = 'accounting.reports.income-statement';
UPDATE iam.menus SET order_number = 41, updated_at = now()
WHERE code = 'accounting.reports.cash-flow';
UPDATE iam.menus SET order_number = 42, updated_at = now()
WHERE code = 'accounting.reports.general-ledger';
UPDATE iam.menus SET order_number = 43, updated_at = now()
WHERE code = 'accounting.reports.trial-balance';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       '["read","create","update","delete","approve","export","import","execute"]'::jsonb,
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'accounting.reports.overview'
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
  AND m.code = 'accounting.reports.overview'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
