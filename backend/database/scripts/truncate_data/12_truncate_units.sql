-- ============================================================
-- Script: Mengosongkan Data Units (Satuan)
-- Dependencies: units (tabel paling independen)
-- Note: Tabel 'satuan' adalah legacy, aplikasi menggunakan 'units'
-- ============================================================

BEGIN;

-- Truncate units
TRUNCATE TABLE units CASCADE;

COMMIT;

-- Verify
SELECT 'units' AS table_name, COUNT(*) AS row_count FROM units;
