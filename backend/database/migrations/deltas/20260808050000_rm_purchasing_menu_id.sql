-- =============================================================================
-- Label menu Pembelian bahan baku ke Bahasa Indonesia (id-ID)
--
-- Sidebar mengambil label dari iam.menus, jadi perubahan di items-nav.ts saja
-- tidak cukup. Istilah dokumen PR/PO/GRN/Invoice sengaja dipertahankan karena
-- sudah jadi istilah kerja tim. Hanya sisi raw-material yang dilokalkan.
-- Idempotent: aman dijalankan ulang.
-- =============================================================================

UPDATE iam.menus SET menu_name = 'Pembelian'        WHERE code = 'items.raw-material.purchasing';
UPDATE iam.menus SET menu_name = 'Lacak Pengiriman' WHERE code = 'items.raw-material.purchasing.delivery';
UPDATE iam.menus SET menu_name = 'Penerimaan (GRN)' WHERE code = 'items.raw-material.purchasing.grn';
UPDATE iam.menus SET menu_name = 'Retur'            WHERE code = 'items.raw-material.purchasing.returns';
