-- ============================================================
-- Script: Mengosongkan Data BOM (Bill of Materials)
-- Dependencies: bom (referensi ke produk & bahan_baku)
-- ============================================================

BEGIN;

-- Truncate bom
TRUNCATE TABLE bom CASCADE;

COMMIT;

-- Verify
SELECT 'bom' AS table_name, COUNT(*) AS row_count FROM bom;
