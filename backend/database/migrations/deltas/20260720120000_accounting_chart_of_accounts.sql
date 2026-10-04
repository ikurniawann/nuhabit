-- =============================================================================
-- Accounting: Chart of Accounts foundation
-- Schema + account_types + chart_of_accounts + IAM menus
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS accounting;

-- Keep DB-level search_path in sync with src/lib/db.ts SEARCH_PATH
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path TO public, iam, configuration, hris, performance, recruitment, item, purchasing, inventory, manufacturing, pos, crm, accounting, auth',
    current_database()
  );
END $$;

-- ── account_types (global lookup) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting.account_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(30) NOT NULL,
  name varchar(100) NOT NULL,
  normal_balance varchar(10) NOT NULL DEFAULT 'DEBIT',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT account_types_code_unique UNIQUE (code),
  CONSTRAINT account_types_normal_balance_check
    CHECK (normal_balance IN ('DEBIT', 'CREDIT'))
);

CREATE INDEX IF NOT EXISTS idx_account_types_active_sort
  ON accounting.account_types (is_active, sort_order, name);

INSERT INTO accounting.account_types (code, name, normal_balance, sort_order)
VALUES
  ('ASSET', 'Asset', 'DEBIT', 10),
  ('LIABILITY', 'Liability', 'CREDIT', 20),
  ('EQUITY', 'Equity', 'CREDIT', 30),
  ('REVENUE', 'Revenue', 'CREDIT', 40),
  ('COGS', 'Cost of Goods Sold', 'DEBIT', 50),
  ('EXPENSE', 'Expense', 'DEBIT', 60),
  ('OTHER_INCOME', 'Other Income', 'CREDIT', 70),
  ('OTHER_EXPENSE', 'Other Expense', 'DEBIT', 80)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  normal_balance = EXCLUDED.normal_balance,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

-- ── chart_of_accounts (company-scoped tree) ────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id) ON DELETE CASCADE,
  code varchar(20) NOT NULL,
  name varchar(200) NOT NULL,
  parent_id uuid REFERENCES accounting.chart_of_accounts(id) ON DELETE RESTRICT,
  account_type_id uuid NOT NULL REFERENCES accounting.account_types(id) ON DELETE RESTRICT,
  level integer NOT NULL DEFAULT 1,
  is_postable boolean NOT NULL DEFAULT true,
  is_contra boolean NOT NULL DEFAULT false,
  cash_flow_category varchar(20),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT chart_of_accounts_level_check CHECK (level BETWEEN 1 AND 4),
  CONSTRAINT chart_of_accounts_cash_flow_check
    CHECK (
      cash_flow_category IS NULL
      OR cash_flow_category IN ('OPERATING', 'INVESTING', 'FINANCING', 'NON_CASH')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_coa_company_code
  ON accounting.chart_of_accounts (company_id, code)
  WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_coa_global_code
  ON accounting.chart_of_accounts (code)
  WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_coa_company_id
  ON accounting.chart_of_accounts (company_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coa_parent_id
  ON accounting.chart_of_accounts (parent_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coa_account_type_id
  ON accounting.chart_of_accounts (account_type_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_coa_active_code
  ON accounting.chart_of_accounts (is_active, code)
  WHERE deleted_at IS NULL;

-- ── IAM menus ──────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('accounting', 'Accounting', NULL, 'dollar-sign', 'group', 55,
   '{"actions":["read"]}'::jsonb),
  ('accounting.chart-of-accounts', 'Chart of Accounts',
   '/dashboard/accounting/chart-of-accounts', 'sitemap', 'sidebar', 10,
   '{"actions":["read","create","update","delete","import","export"]}'::jsonb),
  ('accounting.account-types', 'Account Types',
   '/dashboard/accounting/account-types', 'database', 'sidebar', 20,
   '{"actions":["read","create","update","delete"]}'::jsonb)
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
SET module = 'accounting', level = 1, parent_id = NULL
WHERE code = 'accounting';

UPDATE iam.menus child
SET module = 'accounting',
    level = 2,
    parent_id = parent.id
FROM iam.menus parent
WHERE child.code IN ('accounting.chart-of-accounts', 'accounting.account-types')
  AND parent.code = 'accounting';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, '["read","create","update","delete","approve","export","import","execute"]'::jsonb
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code IN ('accounting', 'accounting.chart-of-accounts', 'accounting.account-types')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT r.id, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code = 'finance_staff'
  AND m.code IN ('accounting', 'accounting.chart-of-accounts', 'accounting.account-types')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
