-- ============================================================
-- Script: Mengosongkan SEMUA Data Purchasing
-- Urutan berdasarkan dependencies (dari child ke parent)
-- ============================================================
-- 
-- WARNING: Script ini akan menghapus SEMUA data transaksi!
-- Pastikan backup sudah dilakukan sebelum menjalankan.
--
-- Usage:
--   psql -h <host> -U postgres -d <database> -f 00_truncate_all.sql
-- ============================================================

BEGIN;

-- 1. Returns (paling independen)
TRUNCATE TABLE purchase_return_items CASCADE;
TRUNCATE TABLE purchase_returns CASCADE;

-- 2. Inventory
TRUNCATE TABLE inventory_movements CASCADE;
TRUNCATE TABLE inventory CASCADE;

-- 3. QC
TRUNCATE TABLE qc_inspections CASCADE;

-- 4. GRN
TRUNCATE TABLE grn_items CASCADE;
TRUNCATE TABLE grn CASCADE;

-- 5. Delivery
TRUNCATE TABLE deliveries CASCADE;

-- 6. Purchase Order
TRUNCATE TABLE purchase_order_items CASCADE;
TRUNCATE TABLE purchase_orders CASCADE;

-- 7. Price List
TRUNCATE TABLE supplier_price_lists CASCADE;

-- 8. BOM
TRUNCATE TABLE bom CASCADE;

-- 9. Produk
TRUNCATE TABLE produk CASCADE;

-- 10. Bahan Baku
TRUNCATE TABLE bahan_baku CASCADE;

-- 11. Supplier
TRUNCATE TABLE suppliers CASCADE;

-- 12. Units (terakhir - paling independen)
-- Note: Tabel 'satuan' adalah legacy, aplikasi menggunakan 'units'
TRUNCATE TABLE units CASCADE;

COMMIT;

-- ============================================================
-- Verification: Tampilkan jumlah baris setelah truncate
-- ============================================================

SELECT 'units' AS table_name, COUNT(*) AS row_count FROM units
UNION ALL
SELECT 'suppliers' AS table_name, COUNT(*) AS row_count FROM suppliers
UNION ALL
SELECT 'bahan_baku' AS table_name, COUNT(*) AS row_count FROM bahan_baku
UNION ALL
SELECT 'produk' AS table_name, COUNT(*) AS row_count FROM produk
UNION ALL
SELECT 'bom' AS table_name, COUNT(*) AS row_count FROM bom
UNION ALL
SELECT 'supplier_price_lists' AS table_name, COUNT(*) AS row_count FROM supplier_price_lists
UNION ALL
SELECT 'purchase_orders' AS table_name, COUNT(*) AS row_count FROM purchase_orders
UNION ALL
SELECT 'purchase_order_items' AS table_name, COUNT(*) AS row_count FROM purchase_order_items
UNION ALL
SELECT 'deliveries' AS table_name, COUNT(*) AS row_count FROM deliveries
UNION ALL
SELECT 'grn' AS table_name, COUNT(*) AS row_count FROM grn
UNION ALL
SELECT 'grn_items' AS table_name, COUNT(*) AS row_count FROM grn_items
UNION ALL
SELECT 'qc_inspections' AS table_name, COUNT(*) AS row_count FROM qc_inspections
UNION ALL
SELECT 'inventory' AS table_name, COUNT(*) AS row_count FROM inventory
UNION ALL
SELECT 'inventory_movements' AS table_name, COUNT(*) AS row_count FROM inventory_movements
UNION ALL
SELECT 'purchase_returns' AS table_name, COUNT(*) AS row_count FROM purchase_returns
UNION ALL
SELECT 'purchase_return_items' AS table_name, COUNT(*) AS row_count FROM purchase_return_items
ORDER BY table_name;
