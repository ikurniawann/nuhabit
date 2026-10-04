-- ============================================================
-- Script: Mengosongkan Data QC (Quality Control)
-- Dependencies: qc_inspections (child dari grn_items)
-- ============================================================

BEGIN;

-- Truncate qc_inspections
TRUNCATE TABLE qc_inspections CASCADE;

COMMIT;

-- Verify
SELECT 'qc_inspections' AS table_name, COUNT(*) AS row_count FROM qc_inspections;
