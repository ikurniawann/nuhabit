-- EPIC-022 — Invoice per deal (permintaan owner 2026-07-23): struktur popup
-- deal menjadi Quotation → Invoice → Pembayaran. Invoice diterbitkan dari
-- kesepakatan termin quotation (atau nominal bebas), pembayaran dicatat
-- mengacu ke invoice. Status pelunasan invoice DITURUNKAN dari pembayaran
-- (belum/sebagian/lunas), bukan disimpan — kolom status hanya siklus
-- dokumen: draft → terkirim, atau batal.

CREATE SEQUENCE IF NOT EXISTS crm.crm_sales_invoice_number_seq;

CREATE TABLE IF NOT EXISTS crm.crm_sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  deal_id uuid NOT NULL REFERENCES crm.crm_sales_deals(id),
  quotation_id uuid REFERENCES crm.crm_sales_quotations(id),
  term_id uuid REFERENCES crm.crm_sales_quotation_terms(id) ON DELETE SET NULL,
  invoice_number varchar(30) NOT NULL UNIQUE,
  label varchar(150) NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  due_date date,
  status varchar(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'terkirim', 'batal')),
  sent_at timestamptz,
  note varchar(300),
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_sales_invoices_deal
  ON crm.crm_sales_invoices (deal_id) WHERE deleted_at IS NULL;

-- Satu termin quotation maksimal satu invoice aktif (batal/dihapus boleh
-- diterbitkan ulang)
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sales_invoices_term_active
  ON crm.crm_sales_invoices (term_id)
  WHERE term_id IS NOT NULL AND deleted_at IS NULL AND status <> 'batal';

-- Pembayaran mengacu ke invoice (nullable — catatan lama tetap sah)
ALTER TABLE crm.crm_sales_deal_payments
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES crm.crm_sales_invoices(id);

CREATE INDEX IF NOT EXISTS idx_crm_sales_deal_payments_invoice
  ON crm.crm_sales_deal_payments (invoice_id) WHERE deleted_at IS NULL;
