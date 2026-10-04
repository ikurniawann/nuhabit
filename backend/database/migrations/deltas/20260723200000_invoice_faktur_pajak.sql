-- EPIC-025 — lampiran Faktur Pajak per invoice (permintaan owner 2026-07-23):
-- Finance mengunggah dokumen faktur pajak (PDF/scan) sebagai bukti pajak
-- resmi terpisah dari invoice internal. Path relatif storage/private —
-- pola signed_document_url di hris.employment_contracts (EPIC-006).
ALTER TABLE crm.crm_sales_invoices
  ADD COLUMN IF NOT EXISTS faktur_pajak_url text;
