-- ============================================================
-- Script: Mengosongkan Data Delivery
-- Dependencies: deliveries (referensi ke purchase_orders)
-- ============================================================

BEGIN;

-- Truncate deliveries
TRUNCATE TABLE deliveries CASCADE;

COMMIT;

-- Verify
SELECT 'deliveries' AS table_name, COUNT(*) AS row_count FROM deliveries;
