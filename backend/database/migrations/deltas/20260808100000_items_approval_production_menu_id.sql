-- =============================================================================
-- Localize RM/Product Approval + Production sidebar labels (id-ID)
-- =============================================================================

UPDATE iam.menus SET menu_name = 'Persetujuan', updated_at = now()
WHERE code IN ('items.raw-material.approval', 'items.product.approval');

UPDATE iam.menus SET menu_name = 'Persetujuan PR', updated_at = now()
WHERE code IN ('items.raw-material.approval.pr', 'items.product.approval.pr');

UPDATE iam.menus SET menu_name = 'Persetujuan PO', updated_at = now()
WHERE code IN ('items.raw-material.approval.po', 'items.product.approval.po');

UPDATE iam.menus SET menu_name = 'Produksi', updated_at = now()
WHERE code IN ('items.raw-material.production', 'items.product.production');

UPDATE iam.menus SET menu_name = 'Resep (BOM)', updated_at = now()
WHERE code IN ('items.raw-material.production.bom', 'items.product.production.bom');

UPDATE iam.menus SET menu_name = 'Produksi Internal', updated_at = now()
WHERE code IN (
  'items.raw-material.production.hub',
  'items.product.production.hub',
  'items.reports.production-in-house'
);
