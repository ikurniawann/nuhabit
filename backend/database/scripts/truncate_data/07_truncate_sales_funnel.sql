-- Clear semua data transaksi modul Sales Funneling (schema crm)
-- Scope: SEMUA company/branch. Master/config data (crm_sales_stages,
-- crm_sales_lost_reasons, crm_sales_wa_templates) SENGAJA tidak dihapus.
--
-- Urutan DELETE mengikuti dependency FK (anak dulu baru induk):
--   deal_payments -> quotation_items -> quotation_terms -> deal_stage_history
--   -> activities -> invoices -> quotations -> deals -> leads
--
-- PERINGATAN: hard delete, tidak bisa di-rollback setelah COMMIT.
-- Jalankan: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/truncate_data/07_truncate_sales_funnel.sql

BEGIN;

DELETE FROM crm.crm_sales_deal_payments;
DELETE FROM crm.crm_sales_quotation_items;
DELETE FROM crm.crm_sales_quotation_terms;
DELETE FROM crm.crm_sales_deal_stage_history;
DELETE FROM crm.crm_sales_activities;
DELETE FROM crm.crm_sales_invoices;
DELETE FROM crm.crm_sales_quotations;
DELETE FROM crm.crm_sales_deals;
DELETE FROM crm.crm_sales_leads;

-- Reset nomor urut quotation & invoice supaya penomoran mulai dari awal lagi
ALTER SEQUENCE crm.crm_sales_quotation_number_seq RESTART WITH 1;
ALTER SEQUENCE crm.crm_sales_invoice_number_seq RESTART WITH 1;

COMMIT;

-- Verifikasi: semua harus 0, kecuali 3 tabel master (stages/lost_reasons/wa_templates)
SELECT 'crm_sales_deal_payments' AS tbl, COUNT(*) FROM crm.crm_sales_deal_payments
UNION ALL SELECT 'crm_sales_quotation_items', COUNT(*) FROM crm.crm_sales_quotation_items
UNION ALL SELECT 'crm_sales_quotation_terms', COUNT(*) FROM crm.crm_sales_quotation_terms
UNION ALL SELECT 'crm_sales_deal_stage_history', COUNT(*) FROM crm.crm_sales_deal_stage_history
UNION ALL SELECT 'crm_sales_activities', COUNT(*) FROM crm.crm_sales_activities
UNION ALL SELECT 'crm_sales_invoices', COUNT(*) FROM crm.crm_sales_invoices
UNION ALL SELECT 'crm_sales_quotations', COUNT(*) FROM crm.crm_sales_quotations
UNION ALL SELECT 'crm_sales_deals', COUNT(*) FROM crm.crm_sales_deals
UNION ALL SELECT 'crm_sales_leads', COUNT(*) FROM crm.crm_sales_leads
UNION ALL SELECT 'crm_sales_stages (master, dipertahankan)', COUNT(*) FROM crm.crm_sales_stages
UNION ALL SELECT 'crm_sales_lost_reasons (master, dipertahankan)', COUNT(*) FROM crm.crm_sales_lost_reasons
UNION ALL SELECT 'crm_sales_wa_templates (master, dipertahankan)', COUNT(*) FROM crm.crm_sales_wa_templates;
