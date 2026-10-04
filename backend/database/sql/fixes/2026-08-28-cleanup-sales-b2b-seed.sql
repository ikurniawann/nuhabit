-- Pembersihan data seed/testing Sales B2B (permintaan owner 2026-08-28):
-- HAPUS SEMUA data transaksi sales funnel — leads, deals, aktivitas,
-- quotation, invoice, pembayaran termin — beserta turunannya di
-- accounting (AR invoice, alokasi pembayaran, jurnal ber-source SALES).
--
-- TIDAK dihapus (referensi/konfigurasi modul, bukan data uji):
--   crm.crm_sales_stages, crm.crm_sales_lost_reasons,
--   crm.crm_sales_wa_templates
--
-- Jalankan: psql -d arkiv -f 2026-08-28-cleanup-sales-b2b-seed.sql
-- Aman diulang (idempoten). Semua dalam satu transaksi — kalau angka
-- pratinjau di bawah terlihat salah, batalkan dengan Ctrl+C sebelum
-- COMMIT atau ganti COMMIT menjadi ROLLBACK.

BEGIN;

-- ── Pratinjau: berapa baris yang akan terhapus ───────────────────────
SELECT 'crm_sales_leads'              AS tabel, count(*) FROM crm.crm_sales_leads
UNION ALL SELECT 'crm_sales_deals',              count(*) FROM crm.crm_sales_deals
UNION ALL SELECT 'crm_sales_activities',         count(*) FROM crm.crm_sales_activities
UNION ALL SELECT 'crm_sales_deal_stage_history', count(*) FROM crm.crm_sales_deal_stage_history
UNION ALL SELECT 'crm_sales_quotations',         count(*) FROM crm.crm_sales_quotations
UNION ALL SELECT 'crm_sales_quotation_items',    count(*) FROM crm.crm_sales_quotation_items
UNION ALL SELECT 'crm_sales_quotation_terms',    count(*) FROM crm.crm_sales_quotation_terms
UNION ALL SELECT 'crm_sales_invoices',           count(*) FROM crm.crm_sales_invoices
UNION ALL SELECT 'crm_sales_deal_payments',      count(*) FROM crm.crm_sales_deal_payments
UNION ALL SELECT 'ar_invoices (dari sales)',     count(*) FROM accounting.ar_invoices
          WHERE sales_invoice_id IS NOT NULL OR deal_id IS NOT NULL
UNION ALL SELECT 'journal_entries (SALES)',      count(*) FROM accounting.journal_entries
          WHERE source_module = 'SALES'
ORDER BY 1;

-- Contoh data yang akan hilang — pastikan memang data uji, bukan asli.
SELECT 'CONTOH LEAD' AS jenis, org_name AS nama, pic_name, created_at
FROM crm.crm_sales_leads ORDER BY created_at DESC LIMIT 10;

-- ── 1. Turunan accounting dari sales ─────────────────────────────────
-- Alokasi pembayaran AR yang menempel ke AR invoice hasil sales.
DELETE FROM accounting.ar_receipt_allocations
WHERE invoice_id IN (
  SELECT id FROM accounting.ar_invoices
  WHERE sales_invoice_id IS NOT NULL OR deal_id IS NOT NULL
);

-- Jurnal ber-source SALES (baris jurnalnya ikut via FK CASCADE).
DELETE FROM accounting.journal_entries WHERE source_module = 'SALES';

-- AR invoice yang lahir dari sales invoice / deal.
DELETE FROM accounting.ar_invoices
WHERE sales_invoice_id IS NOT NULL OR deal_id IS NOT NULL;

-- ── 2. Rantai transaksi sales (anak dulu, induk belakangan) ──────────
DELETE FROM crm.crm_sales_deal_payments;
DELETE FROM crm.crm_sales_invoices;
-- quotation_items & quotation_terms ikut terhapus via FK CASCADE.
DELETE FROM crm.crm_sales_quotations;
DELETE FROM crm.crm_sales_deal_stage_history;
DELETE FROM crm.crm_sales_activities;
DELETE FROM crm.crm_sales_deals;
DELETE FROM crm.crm_sales_leads;

-- ── Verifikasi akhir: semuanya harus 0 ───────────────────────────────
SELECT 'SISA leads'      AS cek, count(*) FROM crm.crm_sales_leads
UNION ALL SELECT 'SISA deals',      count(*) FROM crm.crm_sales_deals
UNION ALL SELECT 'SISA quotations', count(*) FROM crm.crm_sales_quotations
UNION ALL SELECT 'SISA invoices',   count(*) FROM crm.crm_sales_invoices
UNION ALL SELECT 'SISA ar (sales)', count(*) FROM accounting.ar_invoices
          WHERE sales_invoice_id IS NOT NULL OR deal_id IS NOT NULL
UNION ALL SELECT 'SISA jurnal SALES', count(*) FROM accounting.journal_entries
          WHERE source_module = 'SALES';

-- Referensi modul tetap utuh (stages/lost reasons/template WA):
SELECT 'TETAP stages' AS cek, count(*) FROM crm.crm_sales_stages
UNION ALL SELECT 'TETAP lost_reasons', count(*) FROM crm.crm_sales_lost_reasons
UNION ALL SELECT 'TETAP wa_templates', count(*) FROM crm.crm_sales_wa_templates;

COMMIT;
