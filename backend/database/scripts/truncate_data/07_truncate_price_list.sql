-- ============================================================
-- Script: Mengosongkan Data Supplier Price List
-- Dependencies: supplier_price_lists (referensi ke suppliers & bahan_baku)
-- ============================================================

BEGIN;

-- Truncate supplier_price_lists
TRUNCATE TABLE supplier_price_lists CASCADE;

COMMIT;

-- Verify
SELECT 'supplier_price_lists' AS table_name, COUNT(*) AS row_count FROM supplier_price_lists;
