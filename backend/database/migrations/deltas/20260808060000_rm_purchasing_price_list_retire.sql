-- =============================================================================
-- Pensiunkan menu "Daftar Harga" pada Pembelian bahan baku
--
-- Harga beli sekarang diambil dari riwayat penerimaan (GRN), sehingga price list
-- supplier tidak lagi dipelihara manual dan halamannya dihapus. Baris menu
-- di-soft-delete (bukan DELETE) agar role_menu_permissions yang menunjuk ke
-- baris ini tetap utuh. Idempotent: aman dijalankan ulang.
-- =============================================================================

UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    deleted_at = now(),
    updated_at = now()
WHERE code = 'items.raw-material.purchasing.price-list'
  AND deleted_at IS NULL;
