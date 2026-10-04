-- =============================================================================
-- Accounting: Fiscal Years/Periods + Journal Entries (manual)
-- =============================================================================

CREATE TABLE IF NOT EXISTS accounting.fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id) ON DELETE CASCADE,
  code varchar(30) NOT NULL,
  name varchar(120) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT fiscal_years_dates_check CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_years_company_code
  ON accounting.fiscal_years (company_id, code)
  WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_years_global_code
  ON accounting.fiscal_years (code)
  WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_fiscal_years_active_dates
  ON accounting.fiscal_years (is_active, start_date, end_date)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS accounting.fiscal_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year_id uuid NOT NULL
    REFERENCES accounting.fiscal_years(id) ON DELETE CASCADE,
  period_no integer NOT NULL,
  name varchar(60) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_periods_no_check CHECK (period_no BETWEEN 1 AND 12),
  CONSTRAINT fiscal_periods_dates_check CHECK (end_date >= start_date),
  CONSTRAINT fiscal_periods_status_check CHECK (status IN ('OPEN', 'CLOSED')),
  CONSTRAINT fiscal_periods_year_no_unique UNIQUE (fiscal_year_id, period_no)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_periods_dates_status
  ON accounting.fiscal_periods (start_date, end_date, status);

CREATE TABLE IF NOT EXISTS accounting.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id) ON DELETE CASCADE,
  entry_no varchar(40) NOT NULL,
  entry_date date NOT NULL,
  description text,
  fiscal_period_id uuid NOT NULL
    REFERENCES accounting.fiscal_periods(id) ON DELETE RESTRICT,
  status varchar(10) NOT NULL DEFAULT 'DRAFT',
  is_recon boolean NOT NULL DEFAULT false,
  posted_at timestamptz,
  posted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT journal_entries_status_check CHECK (status IN ('DRAFT', 'POSTED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_company_no
  ON accounting.journal_entries (company_id, entry_no)
  WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_global_no
  ON accounting.journal_entries (entry_no)
  WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_date_status
  ON accounting.journal_entries (entry_date, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_period
  ON accounting.journal_entries (fiscal_period_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS accounting.journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL
    REFERENCES accounting.journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL
    REFERENCES accounting.chart_of_accounts(id) ON DELETE RESTRICT,
  entry_side varchar(10) NOT NULL,
  amount numeric(18, 2) NOT NULL,
  memo text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_entry_lines_side_check CHECK (entry_side IN ('DEBIT', 'CREDIT')),
  CONSTRAINT journal_entry_lines_amount_check CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry
  ON accounting.journal_entry_lines (entry_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account
  ON accounting.journal_entry_lines (account_id);

-- ── IAM menus ───────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('accounting.journal-entries', 'Journal Entries',
   '/dashboard/accounting/journal-entries', 'file-text', 'sidebar', 35,
   '{"actions":["read","create","update","delete","approve"]}'::jsonb),
  ('accounting.fiscal-years', 'Fiscal Years',
   '/dashboard/accounting/fiscal-years', 'calendar', 'sidebar', 40,
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

UPDATE iam.menus child
SET module = 'accounting',
    level = 2,
    parent_id = parent.id,
    is_active = true,
    is_visible = true,
    deleted_at = NULL
FROM iam.menus parent
WHERE child.code IN ('accounting.journal-entries', 'accounting.fiscal-years')
  AND parent.code = 'accounting';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       '["read","create","update","delete","approve","export","import","execute"]'::jsonb,
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code IN ('accounting.journal-entries', 'accounting.fiscal-years')
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
  AND m.code IN ('accounting.journal-entries', 'accounting.fiscal-years')
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
