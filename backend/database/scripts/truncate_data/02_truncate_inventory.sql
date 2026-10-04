-- ============================================================
-- Script: Mengosongkan Data Inventory
-- Dependencies: inventory_movements (child), inventory (parent)
-- ============================================================

BEGIN;

-- Truncate inventory_movements dulu (child table - memiliki FK ke inventory)
TRUNCATE TABLE inventory_movements CASCADE;

-- Truncate inventory (parent table)
TRUNCATE TABLE inventory CASCADE;

COMMIT;

-- Verify
SELECT 'inventory' AS table_name, COUNT(*) AS row_count FROM inventory
UNION ALL
SELECT 'inventory_movements' AS table_name, COUNT(*) AS row_count FROM inventory_movements;
