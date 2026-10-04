-- ============================================================
-- Script: Mengosongkan Data GRN (Goods Received Note)
-- Dependencies: 
--   - grn_items (child)
--   - grn (parent)
--   - deliveries (parent - grn referensi ke delivery)
-- ============================================================

BEGIN;

-- Truncate grn_items dulu (child table)
TRUNCATE TABLE grn_items CASCADE;

-- Truncate grn (parent table)
TRUNCATE TABLE grn CASCADE;

COMMIT;

-- Verify
SELECT 'grn' AS table_name, COUNT(*) AS row_count FROM grn
UNION ALL
SELECT 'grn_items' AS table_name, COUNT(*) AS row_count FROM grn_items;
