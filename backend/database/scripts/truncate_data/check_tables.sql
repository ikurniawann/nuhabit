-- Quick check: Tampilkan jumlah data di setiap tabel
SELECT 'satuan' AS table_name, COUNT(*) AS row_count FROM satuan
UNION ALL
SELECT 'suppliers' AS table_name, COUNT(*) AS row_count FROM suppliers
UNION ALL
SELECT 'bahan_baku' AS table_name, COUNT(*) AS row_count FROM bahan_baku
UNION ALL
SELECT 'produk' AS table_name, COUNT(*) AS row_count FROM produk
UNION ALL
SELECT 'purchase_orders' AS table_name, COUNT(*) AS row_count FROM purchase_orders
UNION ALL
SELECT 'purchase_order_items' AS table_name, COUNT(*) AS row_count FROM purchase_order_items
ORDER BY table_name;
