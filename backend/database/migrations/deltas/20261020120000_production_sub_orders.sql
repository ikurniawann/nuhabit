-- =============================================================================
-- Production: sub-orders for short intermediates
-- =============================================================================
-- An order whose materials include intermediates (a raw material with its
-- own recipe, or the WIP mirror of a product) shows their shortage in the
-- production flow. "Buat Sub-order" creates DRAFT orders for the short
-- ones, linked to the order that needs them. Nothing is created
-- automatically.
--
--   * production_orders.parent_order_id: the order a sub-order feeds.
--   * recipe_settings.batch_size: the batch an intermediate's recipe makes;
--     a sub-order's quantity rounds the shortage up to a multiple of it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- constraint guarded by pg_constraint.
-- =============================================================================

ALTER TABLE manufacturing.production_orders
    ADD COLUMN IF NOT EXISTS parent_order_id uuid REFERENCES manufacturing.production_orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN manufacturing.production_orders.parent_order_id IS
  'Order induk yang kekurangan bahan setengah jadinya ditutup oleh sub-order ini.';

CREATE INDEX IF NOT EXISTS production_orders_parent_order_id_fk_idx
    ON manufacturing.production_orders (parent_order_id);

ALTER TABLE manufacturing.recipe_settings
    ADD COLUMN IF NOT EXISTS batch_size numeric(15,3);

COMMENT ON COLUMN manufacturing.recipe_settings.batch_size IS
  'Ukuran batch resep; qty sub-order dibulatkan ke atas ke kelipatannya. NULL = tanpa pembulatan.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_settings_batch_size_check') THEN
    ALTER TABLE manufacturing.recipe_settings
      ADD CONSTRAINT recipe_settings_batch_size_check CHECK (batch_size IS NULL OR batch_size > 0);
  END IF;
END $$;
