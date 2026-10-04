-- =============================================================================
-- Accounting: Journal Mapping (event → COA debit/credit templates)
-- =============================================================================

CREATE TABLE IF NOT EXISTS accounting.journal_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id) ON DELETE CASCADE,
  event_code varchar(60) NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  module varchar(20) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT journal_mappings_module_check
    CHECK (module IN ('POS', 'PURCHASING'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_mappings_company_event
  ON accounting.journal_mappings (company_id, event_code)
  WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_mappings_global_event
  ON accounting.journal_mappings (event_code)
  WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_journal_mappings_module
  ON accounting.journal_mappings (module)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_journal_mappings_company
  ON accounting.journal_mappings (company_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS accounting.journal_mapping_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id uuid NOT NULL
    REFERENCES accounting.journal_mappings(id) ON DELETE CASCADE,
  entry_side varchar(10) NOT NULL,
  line_role varchar(40) NOT NULL,
  account_id uuid REFERENCES accounting.chart_of_accounts(id) ON DELETE RESTRICT,
  amount_source varchar(30) NOT NULL DEFAULT 'TOTAL',
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_mapping_lines_side_check
    CHECK (entry_side IN ('DEBIT', 'CREDIT')),
  CONSTRAINT journal_mapping_lines_amount_source_check
    CHECK (
      amount_source IN (
        'TOTAL', 'SUBTOTAL', 'TAX', 'COGS', 'PAID',
        'DISCOUNT', 'SERVICE_CHARGE'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_journal_mapping_lines_mapping
  ON accounting.journal_mapping_lines (mapping_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_journal_mapping_lines_account
  ON accounting.journal_mapping_lines (account_id)
  WHERE account_id IS NOT NULL;

-- ── Seed global templates (accounts left NULL for user to map) ─────────────
INSERT INTO accounting.journal_mappings (
  company_id, event_code, name, description, module, is_active
)
SELECT NULL, v.event_code, v.name, v.description, v.module, true
FROM (
  VALUES
    ('POS_SALE_CASH', 'POS Sale — Cash',
     'Penjualan POS dibayar tunai', 'POS'),
    ('POS_SALE_QRIS', 'POS Sale — QRIS',
     'Penjualan POS dibayar QRIS', 'POS'),
    ('POS_SALE_DEBIT', 'POS Sale — Debit',
     'Penjualan POS kartu debit', 'POS'),
    ('POS_SALE_CREDIT', 'POS Sale — Credit',
     'Penjualan POS kartu kredit', 'POS'),
    ('POS_SALE_ARK_COIN', 'POS Sale — ARK Coin',
     'Penjualan POS pakai ARK Coin', 'POS'),
    ('POS_SALE_GIFT_CARD', 'POS Sale — Gift Card',
     'Penjualan POS pakai gift card', 'POS'),
    ('POS_COGS_RELIEF', 'POS COGS Relief',
     'Pemakaian HPP / relief inventory saat penjualan', 'POS'),
    ('POS_REFUND', 'POS Refund',
     'Pengembalian penjualan POS', 'POS'),
    ('PURCHASE_GRN', 'Purchase GRN',
     'Penerimaan barang (GRN) ke inventory', 'PURCHASING'),
    ('PURCHASE_AP_INVOICE', 'Purchase AP Invoice',
     'Invoice hutang vendor', 'PURCHASING'),
    ('PURCHASE_PAYMENT', 'Purchase Payment',
     'Pembayaran hutang vendor', 'PURCHASING'),
    ('PURCHASE_RETURN', 'Purchase Return',
     'Retur pembelian ke vendor', 'PURCHASING')
) AS v(event_code, name, description, module)
WHERE NOT EXISTS (
  SELECT 1
  FROM accounting.journal_mappings m
  WHERE m.event_code = v.event_code
    AND m.company_id IS NULL
    AND m.deleted_at IS NULL
);

INSERT INTO accounting.journal_mapping_lines (
  mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required
)
SELECT m.id, v.entry_side, v.line_role, NULL, v.amount_source, v.sort_order, true
FROM accounting.journal_mappings m
JOIN (
  VALUES
    ('POS_SALE_CASH', 'DEBIT', 'CASH', 'TOTAL', 10),
    ('POS_SALE_CASH', 'CREDIT', 'REVENUE', 'SUBTOTAL', 20),
    ('POS_SALE_CASH', 'CREDIT', 'TAX', 'TAX', 30),
    ('POS_SALE_QRIS', 'DEBIT', 'BANK', 'TOTAL', 10),
    ('POS_SALE_QRIS', 'CREDIT', 'REVENUE', 'SUBTOTAL', 20),
    ('POS_SALE_QRIS', 'CREDIT', 'TAX', 'TAX', 30),
    ('POS_SALE_DEBIT', 'DEBIT', 'BANK', 'TOTAL', 10),
    ('POS_SALE_DEBIT', 'CREDIT', 'REVENUE', 'SUBTOTAL', 20),
    ('POS_SALE_DEBIT', 'CREDIT', 'TAX', 'TAX', 30),
    ('POS_SALE_CREDIT', 'DEBIT', 'BANK', 'TOTAL', 10),
    ('POS_SALE_CREDIT', 'CREDIT', 'REVENUE', 'SUBTOTAL', 20),
    ('POS_SALE_CREDIT', 'CREDIT', 'TAX', 'TAX', 30),
    ('POS_SALE_ARK_COIN', 'DEBIT', 'WALLET', 'TOTAL', 10),
    ('POS_SALE_ARK_COIN', 'CREDIT', 'REVENUE', 'SUBTOTAL', 20),
    ('POS_SALE_ARK_COIN', 'CREDIT', 'TAX', 'TAX', 30),
    ('POS_SALE_GIFT_CARD', 'DEBIT', 'GIFT_CARD_LIABILITY', 'TOTAL', 10),
    ('POS_SALE_GIFT_CARD', 'CREDIT', 'REVENUE', 'SUBTOTAL', 20),
    ('POS_SALE_GIFT_CARD', 'CREDIT', 'TAX', 'TAX', 30),
    ('POS_COGS_RELIEF', 'DEBIT', 'COGS', 'COGS', 10),
    ('POS_COGS_RELIEF', 'CREDIT', 'INVENTORY', 'COGS', 20),
    ('POS_REFUND', 'DEBIT', 'REVENUE', 'SUBTOTAL', 10),
    ('POS_REFUND', 'DEBIT', 'TAX', 'TAX', 20),
    ('POS_REFUND', 'CREDIT', 'CASH', 'TOTAL', 30),
    ('PURCHASE_GRN', 'DEBIT', 'INVENTORY', 'TOTAL', 10),
    ('PURCHASE_GRN', 'CREDIT', 'GRNI', 'TOTAL', 20),
    ('PURCHASE_AP_INVOICE', 'DEBIT', 'GRNI', 'TOTAL', 10),
    ('PURCHASE_AP_INVOICE', 'CREDIT', 'AP', 'TOTAL', 20),
    ('PURCHASE_PAYMENT', 'DEBIT', 'AP', 'PAID', 10),
    ('PURCHASE_PAYMENT', 'CREDIT', 'BANK', 'PAID', 20),
    ('PURCHASE_RETURN', 'DEBIT', 'AP', 'TOTAL', 10),
    ('PURCHASE_RETURN', 'CREDIT', 'INVENTORY', 'TOTAL', 20)
) AS v(event_code, entry_side, line_role, amount_source, sort_order)
  ON m.event_code = v.event_code
WHERE m.company_id IS NULL
  AND m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id
  );

-- ── IAM menu ───────────────────────────────────────────────────────────────
INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('accounting.journal-mappings', 'Journal Mapping',
   '/dashboard/accounting/journal-mappings', 'book-open', 'sidebar', 30,
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
WHERE child.code = 'accounting.journal-mappings'
  AND parent.code = 'accounting';

INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions, is_active)
SELECT r.id, m.id,
       '["read","create","update","delete","approve","export","import","execute"]'::jsonb,
       true
FROM iam.roles r
CROSS JOIN iam.menus m
WHERE r.code IN ('super_admin', 'admin')
  AND m.code = 'accounting.journal-mappings'
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
  AND m.code = 'accounting.journal-mappings'
ON CONFLICT (role_id, menu_id) DO UPDATE SET
  is_active       = true,
  granted_actions = EXCLUDED.granted_actions,
  updated_at      = now();
