-- =============================================================================
-- IAM: Accounting Reports (hub + 5 reports)
-- =============================================================================

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('accounting.reports', 'Reports',
   '/dashboard/accounting/reports', 'chart-bar', 'sidebar', 38,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.reports.balance-sheet', 'Balance Sheet',
   '/dashboard/accounting/reports/balance-sheet', 'chart-bar', 'sidebar', 39,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.reports.income-statement', 'Income Statement',
   '/dashboard/accounting/reports/income-statement', 'chart-pie', 'sidebar', 40,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.reports.cash-flow', 'Cash Flow',
   '/dashboard/accounting/reports/cash-flow', 'banknotes', 'sidebar', 41,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.reports.general-ledger', 'General Ledger',
   '/dashboard/accounting/reports/general-ledger', 'document-text', 'sidebar', 42,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.reports.trial-balance', 'Trial Balance',
   '/dashboard/accounting/reports/trial-balance', 'clipboard-document-check', 'sidebar', 43,
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

-- Parent: Accounting
UPDATE iam.menus child
SET module = 'accounting',
    level = 2,
    parent_id = parent.id,
    is_active = true,
    is_visible = true,
    deleted_at = NULL
FROM iam.menus parent
WHERE child.code = 'accounting.reports'
  AND parent.code = 'accounting';

-- Children under Reports hub (level 3) — keep visible in sidebar nested
UPDATE iam.menus child
SET module = 'accounting',
    level = 3,
    parent_id = parent.id,
    is_active = true,
    is_visible = true,
    deleted_at = NULL
FROM iam.menus parent
WHERE child.code IN (
  'accounting.reports.balance-sheet',
  'accounting.reports.income-statement',
  'accounting.reports.cash-flow',
  'accounting.reports.general-ledger',
  'accounting.reports.trial-balance'
)
  AND parent.code = 'accounting.reports';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       '["read","create","update","delete","approve","export","import","execute"]'::jsonb,
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code LIKE 'accounting.reports%'
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
  AND m.code LIKE 'accounting.reports%'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
