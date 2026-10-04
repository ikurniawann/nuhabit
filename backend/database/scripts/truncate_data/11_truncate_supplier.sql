-- ============================================================
-- Script: Mengosongkan Data Supplier
-- Dependencies: suppliers (tidak ada FK ke tabel data lain)
-- ============================================================

BEGIN;

-- Truncate suppliers
TRUNCATE TABLE suppliers CASCADE;

COMMIT;

-- Verify
SELECT 'suppliers' AS table_name, COUNT(*) AS row_count FROM suppliers;
