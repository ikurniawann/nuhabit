-- ============================================================
-- Script: Mengosongkan Data Satuan (Units)
-- Dependencies: satuan (tabel paling independen)
-- ============================================================

BEGIN;

-- Truncate satuan
TRUNCATE TABLE satuan CASCADE;

COMMIT;

-- Verify
SELECT 'satuan' AS table_name, COUNT(*) AS row_count FROM satuan;
