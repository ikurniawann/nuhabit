-- =============================================================================
-- EPIC-039 — rename menu induk sidebar "Toko Online" → "Ecommerce".
-- =============================================================================
-- Permintaan owner 2 Agu: menu-menu baru (Pesanan, Marketplace) tampil di
-- bawah grup bernama "Ecommerce". Kode menu tetap 'shop' (route & permission
-- tidak berubah, anak otomatis ikut karena parent_id sama).
-- Idempoten, dev.
-- =============================================================================

UPDATE iam.menus
SET menu_name = 'Ecommerce', updated_at = now()
WHERE code = 'shop' AND menu_name <> 'Ecommerce';
