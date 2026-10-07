-- =============================================================================
-- Accounting AR documents + SALES journal mapping events
-- Spec: docs/superpowers/specs/2026-08-12-accounting-ap-ar-menu-design.md
-- =============================================================================

CREATE TABLE IF NOT EXISTS accounting.ar_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id) ON DELETE CASCADE,
  invoice_no varchar(40) NOT NULL,
  invoice_date date NOT NULL,
  due_date date,
  customer_name varchar(200),
  sales_invoice_id uuid REFERENCES crm.crm_sales_invoices(id) ON DELETE RESTRICT,
  deal_id uuid REFERENCES crm.crm_sales_deals(id) ON DELETE RESTRICT,
  currency varchar(3) NOT NULL DEFAULT 'IDR',
  subtotal numeric(18, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(18, 2) NOT NULL DEFAULT 0,
  total_amount numeric(18, 2) NOT NULL DEFAULT 0,
  status varchar(10) NOT NULL DEFAULT 'DRAFT',
  description text,
  posted_at timestamptz,
  posted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT ar_invoices_status_check CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
  CONSTRAINT ar_invoices_amount_check CHECK (
    subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_invoices_company_no
  ON accounting.ar_invoices (company_id, invoice_no)
  WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_invoices_global_no
  ON accounting.ar_invoices (invoice_no)
  WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_invoices_sales_invoice
  ON accounting.ar_invoices (sales_invoice_id)
  WHERE deleted_at IS NULL AND sales_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ar_invoices_status_date
  ON accounting.ar_invoices (status, invoice_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ar_invoices_due
  ON accounting.ar_invoices (due_date)
  WHERE deleted_at IS NULL AND status = 'POSTED';

CREATE TABLE IF NOT EXISTS accounting.ar_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id) ON DELETE CASCADE,
  receipt_no varchar(40) NOT NULL,
  receipt_date date NOT NULL,
  amount numeric(18, 2) NOT NULL,
  method varchar(20) NOT NULL DEFAULT 'transfer',
  reference_number text,
  notes text,
  status varchar(10) NOT NULL DEFAULT 'DRAFT',
  deal_payment_id uuid,
  posted_at timestamptz,
  posted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT ar_receipts_status_check CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
  CONSTRAINT ar_receipts_amount_check CHECK (amount > 0),
  CONSTRAINT ar_receipts_method_check CHECK (
    method = ANY (ARRAY['cash'::text, 'transfer'::text, 'qris'::text, 'edc'::text, 'lainnya'::text, 'bank_transfer'::text, 'other'::text])
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_receipts_company_no
  ON accounting.ar_receipts (company_id, receipt_no)
  WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_receipts_global_no
  ON accounting.ar_receipts (receipt_no)
  WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ar_receipts_status_date
  ON accounting.ar_receipts (status, receipt_date)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS accounting.ar_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL
    REFERENCES accounting.ar_receipts(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL
    REFERENCES accounting.ar_invoices(id) ON DELETE RESTRICT,
  amount numeric(18, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ar_receipt_allocations_amount_check CHECK (amount > 0),
  CONSTRAINT ar_receipt_allocations_unique UNIQUE (receipt_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_ar_receipt_allocations_invoice
  ON accounting.ar_receipt_allocations (invoice_id);

-- SALES module + AR events
ALTER TABLE accounting.journal_mappings
  DROP CONSTRAINT IF EXISTS journal_mappings_module_check;

ALTER TABLE accounting.journal_mappings
  ADD CONSTRAINT journal_mappings_module_check
  CHECK (module IN ('POS', 'PURCHASING', 'PAYROLL', 'PINJAMAN', 'SALES'));

INSERT INTO accounting.journal_mappings (
  company_id, event_code, name, description, module, is_active
)
SELECT NULL, v.event_code, v.name, v.description, v.module, true
FROM (
  VALUES
    ('SALE_AR_INVOICE', 'Sale AR Invoice',
     'Pengakuan piutang dari invoice B2B / sales', 'SALES'),
    ('SALE_AR_RECEIPT', 'Sale AR Receipt',
     'Penerimaan pembayaran piutang customer', 'SALES')
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
    ('SALE_AR_INVOICE', 'DEBIT', 'AR', 'TOTAL', 10),
    ('SALE_AR_INVOICE', 'CREDIT', 'REVENUE', 'TOTAL', 20),
    ('SALE_AR_RECEIPT', 'DEBIT', 'BANK', 'PAID', 10),
    ('SALE_AR_RECEIPT', 'CREDIT', 'AR', 'PAID', 20)
) AS v(event_code, entry_side, line_role, amount_source, sort_order)
  ON m.event_code = v.event_code
WHERE m.company_id IS NULL
  AND m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id
  );

-- Backfill COA for SALES AR mappings (global postable)
WITH coa AS (
  SELECT id, code
  FROM accounting.chart_of_accounts
  WHERE deleted_at IS NULL
    AND is_postable = true
    AND is_active = true
    AND company_id IS NULL
),
pick AS (
  SELECT
    (SELECT id FROM coa WHERE code = '1201001' LIMIT 1) AS ar_id,
    (SELECT id FROM coa WHERE code = '4101001' LIMIT 1) AS revenue_id,
    (SELECT id FROM coa WHERE code = '1102001' LIMIT 1) AS bank_id
)
UPDATE accounting.journal_mapping_lines l
SET account_id = CASE l.line_role
  WHEN 'AR' THEN pick.ar_id
  WHEN 'REVENUE' THEN pick.revenue_id
  WHEN 'BANK' THEN pick.bank_id
  ELSE l.account_id
END,
updated_at = now()
FROM accounting.journal_mappings m, pick
WHERE l.mapping_id = m.id
  AND m.event_code IN ('SALE_AR_INVOICE', 'SALE_AR_RECEIPT')
  AND m.company_id IS NULL
  AND m.deleted_at IS NULL
  AND l.account_id IS NULL;
