-- =============================================================================
-- Localize Product Master Data + Inventory sidebar labels (id-ID)
-- =============================================================================

UPDATE iam.menus SET menu_name = 'Produk', updated_at = now()
WHERE code = 'items.product';

UPDATE iam.menus SET menu_name = 'Data Master', updated_at = now()
WHERE code = 'items.product.master';

UPDATE iam.menus SET menu_name = 'Satuan', updated_at = now()
WHERE code = 'items.product.master.units';

UPDATE iam.menus SET menu_name = 'Kategori', updated_at = now()
WHERE code = 'items.product.master.categories';

UPDATE iam.menus SET menu_name = 'Produk', updated_at = now()
WHERE code = 'items.product.master.products';

UPDATE iam.menus SET menu_name = 'Persediaan', updated_at = now()
WHERE code = 'items.product.inventory';

UPDATE iam.menus SET menu_name = 'Stok', updated_at = now()
WHERE code = 'items.product.inventory.stock';

UPDATE iam.menus SET menu_name = 'Stok Opname', updated_at = now()
WHERE code = 'items.product.inventory.opname';

UPDATE iam.menus SET menu_name = 'Penyesuaian Stok', updated_at = now()
WHERE code = 'items.product.inventory.adjustment';

UPDATE iam.menus SET menu_name = 'Transfer Stok', updated_at = now()
WHERE code = 'items.product.inventory.transfer';
