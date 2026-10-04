-- ============================================================
-- Script: Mengosongkan Data Produk
-- Dependencies: produk (referensi ke satuan)
-- ============================================================

BEGIN;

-- Truncate produk
TRUNCATE TABLE produk CASCADE;

COMMIT;

-- Verify
SELECT 'produk' AS table_name, COUNT(*) AS row_count FROM produk;
