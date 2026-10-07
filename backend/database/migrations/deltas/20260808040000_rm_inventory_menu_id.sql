-- =============================================================================
-- Label menu Persediaan bahan baku ke Bahasa Indonesia (id-ID)
--
-- Sidebar mengambil label dari iam.menus, jadi perubahan di items-nav.ts saja
-- tidak cukup. Hanya sisi raw-material yang dilokalkan, mengikuti Data Master RM.
-- Idempotent: aman dijalankan ulang.
-- =============================================================================

UPDATE iam.menus SET menu_name = 'Persediaan'      WHERE code = 'items.raw-material.inventory';
UPDATE iam.menus SET menu_name = 'Stok'            WHERE code = 'items.raw-material.inventory.stock';
UPDATE iam.menus SET menu_name = 'Stok Opname'     WHERE code = 'items.raw-material.inventory.opname';
UPDATE iam.menus SET menu_name = 'Penyesuaian Stok' WHERE code = 'items.raw-material.inventory.adjustment';
UPDATE iam.menus SET menu_name = 'Transfer Stok'   WHERE code = 'items.raw-material.inventory.transfer';
