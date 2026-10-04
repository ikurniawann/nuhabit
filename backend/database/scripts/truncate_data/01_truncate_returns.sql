-- ============================================================
-- Script: Mengosongkan Data Purchase Returns
-- Dependencies: Tidak ada (tabel paling independen)
-- ============================================================

BEGIN;

-- Truncate purchase_return_items dulu (child table)
TRUNCATE TABLE purchase_return_items CASCADE;

-- Truncate purchase_returns (parent table)
TRUNCATE TABLE purchase_returns CASCADE;

COMMIT;

-- Verify
SELECT 'purchase_returns' AS table_name, COUNT(*) AS row_count FROM purchase_returns
UNION ALL
SELECT 'purchase_return_items' AS table_name, COUNT(*) AS row_count FROM purchase_return_items;
