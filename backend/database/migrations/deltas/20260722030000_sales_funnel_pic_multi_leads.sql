-- EPIC-022: satu PIC boleh membawa BANYAK leads (masukan owner 2026-07-22:
-- PIC travel agent/EO kerap membawa beberapa instansi/acara sekaligus).
-- Dedup dilonggarkan: yang ditolak hanya duplikat sungguhan — kombinasi
-- instansi + no. WA PIC yang sama persis (case-insensitive).

DROP INDEX IF EXISTS crm.uq_crm_sales_leads_phone;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sales_leads_phone_org
  ON crm.crm_sales_leads (company_id, pic_phone, lower(org_name))
  WHERE deleted_at IS NULL;
