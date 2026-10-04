-- ============================================================
-- Script: Mengosongkan Data Purchase Order
-- Dependencies:
--   - purchase_order_items (child)
--   - purchase_orders (parent)
-- ============================================================

BEGIN;

-- Truncate child tables dulu
TRUNCATE TABLE purchase_order_items CASCADE;

-- Truncate parent table
TRUNCATE TABLE purchase_orders CASCADE;

COMMIT;

-- Verify
SELECT 'purchase_orders' AS table_name, COUNT(*) AS row_count FROM purchase_orders
UNION ALL
SELECT 'purchase_order_items' AS table_name, COUNT(*) AS row_count FROM purchase_order_items;
