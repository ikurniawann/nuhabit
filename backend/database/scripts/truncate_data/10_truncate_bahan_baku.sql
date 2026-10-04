-- ============================================================
-- Script: Mengosongkan Data Bahan Baku
-- Dependencies: bahan_baku (referensi ke satuan)
-- ============================================================

BEGIN;

-- Truncate bahan_baku
TRUNCATE TABLE bahan_baku CASCADE;

COMMIT;

-- Verify
SELECT 'bahan_baku' AS table_name, COUNT(*) AS row_count FROM bahan_baku;
