-- =============================================================================
-- Production orders count materials in the stock unit
-- =============================================================================
-- A BOM line holds qty_required in its own unit (bom_items.satuan_id). From
-- now on a production order converts that quantity into the material's stock
-- unit (the unit inventory.qty_available and unit_cost count in) with the
-- conversion v_products_cogs uses: a line in the satuan besar is
-- konversi_factor small units, a line in the satuan kecil or without a unit is
-- one, and a pack in item.raw_material_unit_conversions overrides both.
--
--   * qty_planned / qty_actual / satuan_id: the stock quantity and unit.
--   * recipe_qty / recipe_satuan_id: the same line in the BOM unit.
--   * unit_factor: stock units per BOM unit.
--
-- Orders created before this file keep their stored quantities; their
-- recipe columns stay NULL. Nothing is backfilled.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- =============================================================================

ALTER TABLE manufacturing.production_order_materials
    ADD COLUMN IF NOT EXISTS recipe_qty numeric(15,4),
    ADD COLUMN IF NOT EXISTS recipe_satuan_id uuid REFERENCES item.units(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS unit_factor numeric(15,6);

COMMENT ON COLUMN manufacturing.production_order_materials.recipe_qty IS
  'Kebutuhan dalam satuan resep (BOM); qty_planned adalah jumlah yang sama dalam satuan stok.';
COMMENT ON COLUMN manufacturing.production_order_materials.unit_factor IS
  'Satuan stok per satuan resep; NULL untuk order lama yang qty-nya tersimpan apa adanya.';

CREATE INDEX IF NOT EXISTS production_order_materials_recipe_satuan_id_fk_idx
    ON manufacturing.production_order_materials (recipe_satuan_id);
