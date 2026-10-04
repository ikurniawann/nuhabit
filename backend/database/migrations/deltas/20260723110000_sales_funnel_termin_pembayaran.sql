-- EPIC-022 Fase G — termin pembayaran quotation + pencatatan pembayaran deal
-- (permintaan owner 2026-07-23): quotation bisa memuat jadwal termin
-- (persentase, Σ = 100%), pembayaran dicatat per DEAL sehingga progress
-- pelunasan terpantau (waterfall: pembayaran mengisi termin berurutan).

-- Termin per quotation — persentase dari total; nominal dialokasikan saat
-- baca dengan pembulatan kumulatif (Σ nominal = total persis, pola
-- allocateBundlePrice ticketing). Ikut terhapus bersama quotation (CASCADE).
CREATE TABLE IF NOT EXISTS crm.crm_sales_quotation_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL
    REFERENCES crm.crm_sales_quotations(id) ON DELETE CASCADE,
  label varchar(100) NOT NULL,
  percent numeric(5,2) NOT NULL CHECK (percent > 0 AND percent <= 100),
  due_date date,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_sales_quotation_terms_quotation
  ON crm.crm_sales_quotation_terms (quotation_id);

-- Pembayaran per deal — append-only + soft delete (koreksi salah catat).
CREATE TABLE IF NOT EXISTS crm.crm_sales_deal_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  deal_id uuid NOT NULL REFERENCES crm.crm_sales_deals(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method varchar(20) NOT NULL DEFAULT 'transfer'
    CHECK (method IN ('cash', 'transfer', 'qris', 'edc', 'lainnya')),
  paid_on date NOT NULL,
  note varchar(300),
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES configuration.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_sales_deal_payments_deal
  ON crm.crm_sales_deal_payments (deal_id) WHERE deleted_at IS NULL;
