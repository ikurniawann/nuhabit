-- =============================================================================
-- Accounting AP documents (native SoT for Accounts Payable)
-- Spec: docs/superpowers/specs/2026-08-12-accounting-ap-ar-menu-design.md
-- Plan: docs/superpowers/plans/2026-08-12-accounting-ap-native-phase1.md
-- =============================================================================

CREATE TABLE IF NOT EXISTS accounting.ap_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id) ON DELETE CASCADE,
  invoice_no varchar(40) NOT NULL,
  invoice_date date NOT NULL,
  due_date date,
  vendor_id uuid REFERENCES purchasing.vendors(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES purchasing.suppliers(id) ON DELETE RESTRICT,
  purchase_order_id uuid REFERENCES purchasing.purchase_orders(id) ON DELETE RESTRICT,
  grn_id uuid REFERENCES purchasing.grn(id) ON DELETE RESTRICT,
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
  CONSTRAINT ap_invoices_status_check CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
  CONSTRAINT ap_invoices_amount_check CHECK (
    subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0
  ),
  CONSTRAINT ap_invoices_party_check CHECK (
    vendor_id IS NOT NULL OR supplier_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_invoices_company_no
  ON accounting.ap_invoices (company_id, invoice_no)
  WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_invoices_global_no
  ON accounting.ap_invoices (invoice_no)
  WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_invoices_grn
  ON accounting.ap_invoices (grn_id)
  WHERE deleted_at IS NULL AND grn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ap_invoices_status_date
  ON accounting.ap_invoices (status, invoice_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ap_invoices_po
  ON accounting.ap_invoices (purchase_order_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ap_invoices_due
  ON accounting.ap_invoices (due_date)
  WHERE deleted_at IS NULL AND status = 'POSTED';

CREATE TABLE IF NOT EXISTS accounting.ap_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES configuration.companies(id) ON DELETE CASCADE,
  payment_no varchar(40) NOT NULL,
  payment_date date NOT NULL,
  amount numeric(18, 2) NOT NULL,
  method varchar(20) NOT NULL DEFAULT 'bank_transfer',
  reference_number text,
  notes text,
  status varchar(10) NOT NULL DEFAULT 'DRAFT',
  vendor_id uuid REFERENCES purchasing.vendors(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES purchasing.suppliers(id) ON DELETE RESTRICT,
  purchase_order_id uuid REFERENCES purchasing.purchase_orders(id) ON DELETE RESTRICT,
  vendor_payment_id uuid REFERENCES purchasing.vendor_payments(id) ON DELETE SET NULL,
  posted_at timestamptz,
  posted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CONSTRAINT ap_payments_status_check CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
  CONSTRAINT ap_payments_amount_check CHECK (amount > 0),
  CONSTRAINT ap_payments_method_check CHECK (
    method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'giro'::text, 'qris'::text, 'other'::text])
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_payments_company_no
  ON accounting.ap_payments (company_id, payment_no)
  WHERE deleted_at IS NULL AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_payments_global_no
  ON accounting.ap_payments (payment_no)
  WHERE deleted_at IS NULL AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ap_payments_status_date
  ON accounting.ap_payments (status, payment_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ap_payments_vendor_payment
  ON accounting.ap_payments (vendor_payment_id)
  WHERE deleted_at IS NULL AND vendor_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS accounting.ap_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL
    REFERENCES accounting.ap_payments(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL
    REFERENCES accounting.ap_invoices(id) ON DELETE RESTRICT,
  amount numeric(18, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap_payment_allocations_amount_check CHECK (amount > 0),
  CONSTRAINT ap_payment_allocations_unique UNIQUE (payment_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_ap_payment_allocations_invoice
  ON accounting.ap_payment_allocations (invoice_id);
