-- Allow QC inspection lines for product GRNs (receive+QC combined flow).
-- Mirrors grn_items item_target pattern: exactly one of raw_material_id / product_id.

ALTER TABLE purchasing.grn_qc_inspection_items
  ADD COLUMN IF NOT EXISTS product_id uuid;

ALTER TABLE purchasing.grn_qc_inspection_items
  ALTER COLUMN raw_material_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'grn_qc_inspection_items_product_id_fkey'
  ) THEN
    ALTER TABLE purchasing.grn_qc_inspection_items
      ADD CONSTRAINT grn_qc_inspection_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'grn_qc_inspection_items_item_target_check'
  ) THEN
    ALTER TABLE purchasing.grn_qc_inspection_items
      DROP CONSTRAINT grn_qc_inspection_items_item_target_check;
  END IF;

  ALTER TABLE purchasing.grn_qc_inspection_items
    ADD CONSTRAINT grn_qc_inspection_items_item_target_check
    CHECK (
      (raw_material_id IS NOT NULL AND product_id IS NULL)
      OR (product_id IS NOT NULL AND raw_material_id IS NULL)
    );
END $$;

CREATE INDEX IF NOT EXISTS idx_grn_qc_inspection_items_product_id
  ON purchasing.grn_qc_inspection_items (product_id);
