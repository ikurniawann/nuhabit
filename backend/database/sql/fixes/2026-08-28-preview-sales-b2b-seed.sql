-- PRATINJAU data Sales B2B di production — HANYA MEMBACA, tidak mengubah
-- apa pun. Jalankan dulu skrip ini untuk melihat data apa saja yang ada,
-- sebelum memutuskan pembersihan.
--
-- Jalankan: psql -d arkiv -f 2026-08-28-preview-sales-b2b-seed.sql

-- ── Ringkasan jumlah baris per tabel ─────────────────────────────────
SELECT 'crm_sales_leads'              AS tabel, count(*) AS baris FROM crm.crm_sales_leads
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

-- ── Seluruh LEADS: siapa saja organisasinya ──────────────────────────
SELECT org_name, org_type, pic_name, pic_phone, city, source,
       status, created_at::date AS dibuat
FROM crm.crm_sales_leads
ORDER BY created_at;

-- ── Seluruh DEALS: judul, nilai, tahap ───────────────────────────────
SELECT d.title, l.org_name, d.event_type, d.event_date,
       d.value_estimate, d.value_final, s.name AS tahap,
       d.created_at::date AS dibuat
FROM crm.crm_sales_deals d
LEFT JOIN crm.crm_sales_leads  l ON l.id = d.lead_id
LEFT JOIN crm.crm_sales_stages s ON s.id = d.stage_id
ORDER BY d.created_at;

-- ── Seluruh INVOICE sales + status ───────────────────────────────────
SELECT i.invoice_number, i.label, i.amount, i.status, i.due_date,
       d.title AS deal, i.created_at::date AS dibuat
FROM crm.crm_sales_invoices i
LEFT JOIN crm.crm_sales_deals d ON d.id = i.deal_id
ORDER BY i.created_at;

-- ── Pembayaran termin yang tercatat ──────────────────────────────────
SELECT p.*, i.invoice_number
FROM crm.crm_sales_deal_payments p
LEFT JOIN crm.crm_sales_invoices i ON i.id = p.invoice_id
ORDER BY p.created_at
LIMIT 50;

-- ── Turunan di accounting (ikut terpengaruh bila dibersihkan) ───────
SELECT invoice_no, customer_name, total_amount, status, created_at::date AS dibuat
FROM accounting.ar_invoices
WHERE sales_invoice_id IS NOT NULL OR deal_id IS NOT NULL
ORDER BY created_at;

SELECT entry_no, entry_date, description, source_document_type
FROM accounting.journal_entries
WHERE source_module = 'SALES'
ORDER BY entry_date
LIMIT 50;
