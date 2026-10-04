-- =============================================================================
-- Align Product purchasing sidebar with RM schema:
-- retire Price List; localize GRN + pengiriman (+ retur) labels.
-- =============================================================================

UPDATE iam.menus
SET is_active = false,
    is_visible = false,
    deleted_at = COALESCE(deleted_at, now()),
    updated_at = now()
WHERE code = 'items.product.purchasing.price-list';

UPDATE iam.menus
SET menu_name = 'Pembelian', updated_at = now()
WHERE code = 'items.product.purchasing'
  AND (menu_name IS DISTINCT FROM 'Pembelian');

UPDATE iam.menus
SET menu_name = 'Lacak Pengiriman', updated_at = now()
WHERE code = 'items.product.purchasing.delivery';

UPDATE iam.menus
SET menu_name = 'Penerimaan (GRN)', updated_at = now()
WHERE code = 'items.product.purchasing.grn';

UPDATE iam.menus
SET menu_name = 'Retur', updated_at = now()
WHERE code = 'items.product.purchasing.returns';
