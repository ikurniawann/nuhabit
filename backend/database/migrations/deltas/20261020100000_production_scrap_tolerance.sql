-- =============================================================================
-- Production: scrap tolerance and abnormal scrap
-- =============================================================================
-- Scrap within a tolerance of the order's planned quantity is normal and
-- raises the HPP of the good units. Scrap above it is abnormal: it is costed
-- like a good unit of the batch and expensed (journal
-- PRODUCTION_ABNORMAL_SCRAP: debit production loss, credit WIP).
--
--   * manufacturing.recipe_settings: per product or raw material recipe,
--     scrap_tolerance_pct (NULL = the default 5%). Production owns recipes
--     (bom_items, raw_material_bom_items), so their settings live here too.
--   * production_batches: qty_scrap_abnormal (part of qty_scrap),
--     abnormal_material_cost, abnormal_conversion_cost and the
--     scrap_tolerance_pct the batch was costed with.
--   * Journal mapping PRODUCTION_ABNORMAL_SCRAP for every company that has
--     the production mappings; its accounts start empty (see the account
--     delta that follows).
--
-- Idempotent: IF NOT EXISTS everywhere, NOT EXISTS guards on the seeds.
-- =============================================================================

CREATE TABLE IF NOT EXISTS manufacturing.recipe_settings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id          uuid UNIQUE REFERENCES item.products(id) ON DELETE CASCADE,
    raw_material_id     uuid UNIQUE REFERENCES item.raw_materials(id) ON DELETE CASCADE,
    scrap_tolerance_pct numeric(5,2) CHECK (scrap_tolerance_pct IS NULL OR scrap_tolerance_pct BETWEEN 0 AND 100),
    updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recipe_settings_one_owner CHECK ((product_id IS NULL) <> (raw_material_id IS NULL))
);

COMMENT ON TABLE manufacturing.recipe_settings IS
  'Pengaturan resep per produk atau bahan baku olahan (toleransi scrap).';
COMMENT ON COLUMN manufacturing.recipe_settings.scrap_tolerance_pct IS
  'Scrap normal dalam persen dari qty rencana order; NULL = default 5%.';

CREATE INDEX IF NOT EXISTS recipe_settings_updated_by_fk_idx ON manufacturing.recipe_settings (updated_by);

ALTER TABLE manufacturing.production_batches
    ADD COLUMN IF NOT EXISTS qty_scrap_abnormal numeric(15,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS abnormal_material_cost numeric(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS abnormal_conversion_cost numeric(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS scrap_tolerance_pct numeric(5,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_batches_qty_scrap_abnormal_check') THEN
    ALTER TABLE manufacturing.production_batches
      ADD CONSTRAINT production_batches_qty_scrap_abnormal_check CHECK (qty_scrap_abnormal >= 0 AND qty_scrap_abnormal <= qty_scrap);
  END IF;
END $$;

-- ── Journal mapping ─────────────────────────────────────────────────────────

INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active)
SELECT src.company_id, 'PRODUCTION_ABNORMAL_SCRAP', 'Production Abnormal Scrap',
       'Scrap di atas toleransi dibebankan sebagai kerugian produksi dari WIP', 'INVENTORY', true
  FROM (SELECT DISTINCT m.company_id FROM accounting.journal_mappings m
         WHERE m.event_code = 'PRODUCTION_MATERIAL_ISSUE' AND m.deleted_at IS NULL) AS src
 WHERE NOT EXISTS (
   SELECT 1 FROM accounting.journal_mappings m
    WHERE m.event_code = 'PRODUCTION_ABNORMAL_SCRAP'
      AND m.company_id IS NOT DISTINCT FROM src.company_id
      AND m.deleted_at IS NULL);

INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
SELECT m.id, v.entry_side, v.line_role, NULL, 'TOTAL', v.sort_order, true
  FROM accounting.journal_mappings m
 CROSS JOIN (VALUES ('DEBIT', 'PRODUCTION_LOSS', 10), ('CREDIT', 'WIP', 20)) AS v(entry_side, line_role, sort_order)
 WHERE m.event_code = 'PRODUCTION_ABNORMAL_SCRAP' AND m.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id);
