-- EPIC-022 Fase F1: Quotation Builder — penawaran per deal berisi baris
-- item bebas + produk katalog (pos_products) per pax, opsi PPN (default
-- 11% preseden purchasing). Keputusan owner 2026-07-21: realisasi stok
-- manual (F3), output PDF + WA (F2), gudang venue branch deal.

CREATE SEQUENCE IF NOT EXISTS crm.crm_sales_quotation_number_seq;

CREATE TABLE IF NOT EXISTS crm.crm_sales_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES configuration.companies(id),
  branch_id uuid NOT NULL REFERENCES configuration.branches(id),
  deal_id uuid NOT NULL REFERENCES crm.crm_sales_deals(id),
  quote_number varchar(40) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'terkirim', 'diterima', 'ditolak')),
  use_ppn boolean NOT NULL DEFAULT true,
  ppn_persen numeric(5,2) NOT NULL DEFAULT 11
    CHECK (ppn_persen >= 0 AND ppn_persen <= 100),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  ppn_nominal numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  valid_until date,
  -- diisi F3 saat ops menekan "Realisasi" — idempotensi pengurangan stok
  stock_deducted_at timestamptz,
  created_by uuid REFERENCES configuration.users(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_sales_quotations_deal
  ON crm.crm_sales_quotations (deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_quotations_branch
  ON crm.crm_sales_quotations (branch_id);

CREATE TABLE IF NOT EXISTS crm.crm_sales_quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL
    REFERENCES crm.crm_sales_quotations(id) ON DELETE CASCADE,
  item_type varchar(10) NOT NULL DEFAULT 'bebas'
    CHECK (item_type IN ('produk', 'bebas')),
  product_id uuid REFERENCES pos.pos_products(id),
  description varchar(300) NOT NULL,
  qty numeric(12,2) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(14,2) NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- baris produk wajib menunjuk produk katalog (bahan realisasi F3)
  CHECK (item_type <> 'produk' OR product_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_crm_sales_quotation_items_quotation
  ON crm.crm_sales_quotation_items (quotation_id);
