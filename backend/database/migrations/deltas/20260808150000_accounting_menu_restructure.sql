-- =============================================================================
-- Restructure Accounting sidebar into grouped modules.
-- Existing pages keep their URLs; new leaves are Coming Soon.
-- Menu codes follow the tree so iam-menus seeder parent wiring stays correct.
-- =============================================================================

-- 1) Rename existing leaves to hierarchical codes (keep menu id + permissions)
UPDATE iam.menus SET code = 'accounting.master.chart-of-accounts', updated_at = now()
WHERE code = 'accounting.chart-of-accounts';

UPDATE iam.menus SET code = 'accounting.master.account-types', updated_at = now()
WHERE code = 'accounting.account-types';

UPDATE iam.menus SET code = 'accounting.master.journal-mappings', updated_at = now()
WHERE code = 'accounting.journal-mappings';

UPDATE iam.menus SET code = 'accounting.ledger.journal-entries', updated_at = now()
WHERE code = 'accounting.journal-entries';

UPDATE iam.menus SET code = 'accounting.ledger.journal-history', updated_at = now()
WHERE code = 'accounting.journal-history';

UPDATE iam.menus SET code = 'accounting.ledger.general-ledger', updated_at = now()
WHERE code = 'accounting.reports.general-ledger';

UPDATE iam.menus SET code = 'accounting.ledger.trial-balance', updated_at = now()
WHERE code = 'accounting.reports.trial-balance';

UPDATE iam.menus SET code = 'accounting.dashboard.overview', updated_at = now()
WHERE code = 'accounting.reports.overview';

UPDATE iam.menus SET code = 'accounting.period.beginning-balance', updated_at = now()
WHERE code = 'accounting.beginning-balance';

UPDATE iam.menus SET code = 'accounting.period.fiscal-years', updated_at = now()
WHERE code = 'accounting.fiscal-years';

-- 2) Upsert full tree
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('accounting', 'Accounting', NULL, 'dollar-sign', 'group', 55,
   '{"actions":["read"]}'::jsonb),

  ('accounting.dashboard', 'Dashboard', NULL, 'home', 'group', 10,
   '{"actions":["read"]}'::jsonb),
  ('accounting.dashboard.overview', 'Overview',
   '/dashboard/accounting/reports', 'home', 'sidebar', 10,
   '{"actions":["read","export"]}'::jsonb),

  ('accounting.master', 'Master Data', NULL, 'database', 'group', 20,
   '{"actions":["read"]}'::jsonb),
  ('accounting.master.chart-of-accounts', 'Chart of Accounts',
   '/dashboard/accounting/chart-of-accounts', 'sitemap', 'sidebar', 10,
   '{"actions":["read","create","update","delete","import","export"]}'::jsonb),
  ('accounting.master.account-types', 'Account Types',
   '/dashboard/accounting/account-types', 'database', 'sidebar', 20,
   '{"actions":["read","create","update","delete"]}'::jsonb),
  ('accounting.master.journal-mappings', 'Journal Mapping',
   '/dashboard/accounting/journal-mappings', 'clipboard', 'sidebar', 30,
   '{"actions":["read","create","update","delete"]}'::jsonb),

  ('accounting.ledger', 'General Ledger', NULL, 'document-text', 'group', 30,
   '{"actions":["read"]}'::jsonb),
  ('accounting.ledger.journal-entries', 'Journal Entries',
   '/dashboard/accounting/journal-entries', 'clipboard', 'sidebar', 10,
   '{"actions":["read","create","update","delete","approve"]}'::jsonb),
  ('accounting.ledger.journal-history', 'Journal History',
   '/dashboard/accounting/journal-history', 'document-magnifying-glass', 'sidebar', 20,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.ledger.general-ledger', 'General Ledger',
   '/dashboard/accounting/reports/general-ledger', 'document-text', 'sidebar', 30,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.ledger.subsidiary', 'Subsidiary Ledger',
   '/dashboard/accounting/ledger/subsidiary', 'clipboard', 'sidebar', 40,
   '{"actions":["read"]}'::jsonb),
  ('accounting.ledger.trial-balance', 'Trial Balance',
   '/dashboard/accounting/reports/trial-balance', 'clipboard-document-check', 'sidebar', 50,
   '{"actions":["read","export"]}'::jsonb),

  ('accounting.cash-bank', 'Cash & Bank', NULL, 'banknotes', 'group', 40,
   '{"actions":["read"]}'::jsonb),
  ('accounting.cash-bank.accounts', 'Cash & Bank Accounts',
   '/dashboard/accounting/cash-bank', 'banknotes', 'sidebar', 10,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.cash-bank.cash-in', 'Cash In',
   '/dashboard/accounting/cash-bank/cash-in', 'arrow-down-on-square', 'sidebar', 20,
   '{"actions":["read"]}'::jsonb),
  ('accounting.cash-bank.cash-out', 'Cash Out',
   '/dashboard/accounting/cash-bank/cash-out', 'banknotes', 'sidebar', 30,
   '{"actions":["read"]}'::jsonb),
  ('accounting.cash-bank.transfer', 'Bank Transfer',
   '/dashboard/accounting/cash-bank/transfer', 'truck', 'sidebar', 40,
   '{"actions":["read"]}'::jsonb),
  ('accounting.cash-bank.reconciliation', 'Bank Reconciliation',
   '/dashboard/accounting/cash-bank/reconciliation', 'check-circle', 'sidebar', 50,
   '{"actions":["read"]}'::jsonb),

  ('accounting.receivable', 'Accounts Receivable', NULL, 'money', 'group', 50,
   '{"actions":["read"]}'::jsonb),
  ('accounting.receivable.list', 'Receivable',
   '/dashboard/accounting/receivable', 'money', 'sidebar', 10,
   '{"actions":["read"]}'::jsonb),
  ('accounting.receivable.invoices', 'Invoice',
   '/dashboard/accounting/receivable/invoices', 'file-text', 'sidebar', 20,
   '{"actions":["read"]}'::jsonb),
  ('accounting.receivable.receipts', 'Receipt',
   '/dashboard/accounting/receivable/receipts', 'banknotes', 'sidebar', 30,
   '{"actions":["read"]}'::jsonb),
  ('accounting.receivable.aging', 'Aging',
   '/dashboard/accounting/receivable/aging', 'chart-bar', 'sidebar', 40,
   '{"actions":["read"]}'::jsonb),

  ('accounting.accounts-payable', 'Accounts Payable', NULL, 'banknotes', 'group', 60,
   '{"actions":["read"]}'::jsonb),
  ('accounting.accounts-payable.payable', 'Payable',
   '/dashboard/accounting/accounts-payable', 'banknotes', 'sidebar', 10,
   '{"actions":["read","create","update"]}'::jsonb),
  ('accounting.accounts-payable.invoices', 'Invoice',
   '/dashboard/accounting/accounts-payable/invoices', 'file-text', 'sidebar', 20,
   '{"actions":["read"]}'::jsonb),
  ('accounting.accounts-payable.payments', 'Payment',
   '/dashboard/accounting/accounts-payable/payments', 'money', 'sidebar', 30,
   '{"actions":["read"]}'::jsonb),
  ('accounting.accounts-payable.aging', 'Aging',
   '/dashboard/accounting/accounts-payable/aging', 'chart-bar', 'sidebar', 40,
   '{"actions":["read"]}'::jsonb),

  ('accounting.period', 'Period & Closing', NULL, 'calendar', 'group', 70,
   '{"actions":["read"]}'::jsonb),
  ('accounting.period.beginning-balance', 'Beginning Balance',
   '/dashboard/accounting/beginning-balance', 'banknotes', 'sidebar', 10,
   '{"actions":["read","create","update","delete","approve"]}'::jsonb),
  ('accounting.period.fiscal-years', 'Fiscal Years',
   '/dashboard/accounting/fiscal-years', 'calendar', 'sidebar', 20,
   '{"actions":["read","create","update","delete"]}'::jsonb),
  ('accounting.period.accounting-period', 'Accounting Period',
   '/dashboard/accounting/period/accounting-period', 'calendar', 'sidebar', 30,
   '{"actions":["read"]}'::jsonb),
  ('accounting.period.closing', 'Period Closing',
   '/dashboard/accounting/period/closing', 'check-circle', 'sidebar', 40,
   '{"actions":["read"]}'::jsonb),

  ('accounting.reports', 'Reports', NULL, 'chart-bar', 'group', 80,
   '{"actions":["read"]}'::jsonb),
  ('accounting.reports.balance-sheet', 'Balance Sheet',
   '/dashboard/accounting/reports/balance-sheet', 'chart-bar', 'sidebar', 10,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.reports.income-statement', 'Income Statement',
   '/dashboard/accounting/reports/income-statement', 'chart-pie', 'sidebar', 20,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.reports.cash-flow', 'Cash Flow',
   '/dashboard/accounting/reports/cash-flow', 'banknotes', 'sidebar', 30,
   '{"actions":["read","export"]}'::jsonb),
  ('accounting.reports.equity', 'Changes in Equity',
   '/dashboard/accounting/reports/changes-in-equity', 'chart', 'sidebar', 40,
   '{"actions":["read"]}'::jsonb),
  ('accounting.reports.budget', 'Budget vs Actual',
   '/dashboard/accounting/reports/budget-vs-actual', 'chart-bar', 'sidebar', 50,
   '{"actions":["read"]}'::jsonb)
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

-- 3) Module / level / parent
UPDATE iam.menus
SET module = 'accounting', level = 1, parent_id = NULL, is_active = true, is_visible = true, deleted_at = NULL
WHERE code = 'accounting';

UPDATE iam.menus
SET module = 'accounting',
    level = (length(code) - length(replace(code, '.', ''))) + 1,
    is_active = true,
    is_visible = true,
    deleted_at = NULL,
    updated_at = now()
WHERE code LIKE 'accounting.%';

UPDATE iam.menus child
SET parent_id = parent.id
FROM iam.menus parent
WHERE child.code LIKE 'accounting.%'
  AND parent.code = left(child.code, length(child.code) - position('.' in reverse(child.code)))
  AND parent.code LIKE 'accounting%';

-- 4) Grants: admin/super_admin full; finance_staff from permission_context
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       '["read","create","update","delete","approve","export","import","execute"]'::jsonb,
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND (m.code = 'accounting' OR m.code LIKE 'accounting.%')
  AND m.deleted_at IS NULL
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
  AND (m.code = 'accounting' OR m.code LIKE 'accounting.%')
  AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

-- Purchasing roles that already had AP keep the payable leaf
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       COALESCE(m.permission_context->'actions', '["read"]'::jsonb),
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('purchasing_admin', 'purchasing_manager', 'purchasing_staff')
  AND m.code IN (
    'accounting',
    'accounting.accounts-payable',
    'accounting.accounts-payable.payable'
  )
  AND m.deleted_at IS NULL
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
