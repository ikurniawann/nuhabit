-- =============================================================================
-- Production: return unused issued materials to stock
-- =============================================================================
-- While an order runs (and with its final receipt), staff can give issued
-- materials back to stock. A return values each line at that line's issued
-- average cost, puts the quantity back through the inventory ledger
-- (movement reference production_return) and lowers the order's WIP.
--
--   * manufacturing.production_returns / production_return_lines: one
--     return (<order>-R01, -R02, ...) and its lines, each pointing at the
--     inventory movement it wrote.
--   * production_order_materials.qty_returned / returned_cost: running
--     totals of the return lines, kept in the return transaction.
--   * Journal mapping PRODUCTION_MATERIAL_RETURN (debit inventory, credit
--     WIP) for every company with the production mappings; the inventory
--     account is copied from PURCHASE_GRN, WIP starts empty.
--
-- Idempotent: IF NOT EXISTS everywhere, NOT EXISTS guards on the seeds.
-- Every foreign key has its index here.
-- =============================================================================

CREATE TABLE IF NOT EXISTS manufacturing.production_returns (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    production_order_id uuid NOT NULL REFERENCES manufacturing.production_orders(id) ON DELETE RESTRICT,
    nomor_return        varchar(60) NOT NULL UNIQUE,
    total_cost          numeric(15,2) NOT NULL DEFAULT 0,
    catatan             text,
    created_by          uuid REFERENCES auth.users(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manufacturing.production_returns IS
  'Pengembalian bahan sisa dari produksi ke stok; nilainya keluar dari WIP order.';

CREATE INDEX IF NOT EXISTS idx_production_returns_order ON manufacturing.production_returns (production_order_id, created_at);
CREATE INDEX IF NOT EXISTS production_returns_created_by_fk_idx ON manufacturing.production_returns (created_by);

CREATE TABLE IF NOT EXISTS manufacturing.production_return_lines (
    id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id                    uuid NOT NULL REFERENCES manufacturing.production_returns(id) ON DELETE CASCADE,
    production_order_material_id uuid NOT NULL REFERENCES manufacturing.production_order_materials(id) ON DELETE RESTRICT,
    raw_material_id              uuid NOT NULL REFERENCES item.raw_materials(id) ON DELETE RESTRICT,
    qty                          numeric(15,4) NOT NULL CHECK (qty > 0),
    unit_cost                    numeric(15,2) NOT NULL DEFAULT 0,
    total_cost                   numeric(15,2) NOT NULL DEFAULT 0,
    inventory_movement_id        uuid REFERENCES inventory.inventory_movements(id) ON DELETE SET NULL,
    warehouse_id                 uuid REFERENCES configuration.warehouses(id) ON DELETE SET NULL,
    created_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_return_lines_return ON manufacturing.production_return_lines (return_id);
CREATE INDEX IF NOT EXISTS idx_production_return_lines_material ON manufacturing.production_return_lines (production_order_material_id);
CREATE INDEX IF NOT EXISTS production_return_lines_raw_material_id_fk_idx ON manufacturing.production_return_lines (raw_material_id);
CREATE INDEX IF NOT EXISTS production_return_lines_inventory_movement_id_fk_idx ON manufacturing.production_return_lines (inventory_movement_id);
CREATE INDEX IF NOT EXISTS production_return_lines_warehouse_id_fk_idx ON manufacturing.production_return_lines (warehouse_id);

ALTER TABLE manufacturing.production_order_materials
    ADD COLUMN IF NOT EXISTS qty_returned numeric(15,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS returned_cost numeric(15,2) NOT NULL DEFAULT 0;

-- ── Journal mapping ─────────────────────────────────────────────────────────

INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active)
SELECT src.company_id, 'PRODUCTION_MATERIAL_RETURN', 'Production Material Return',
       'Bahan sisa produksi dikembalikan ke persediaan dari WIP', 'INVENTORY', true
  FROM (SELECT DISTINCT m.company_id FROM accounting.journal_mappings m
         WHERE m.event_code = 'PRODUCTION_MATERIAL_ISSUE' AND m.deleted_at IS NULL) AS src
 WHERE NOT EXISTS (
   SELECT 1 FROM accounting.journal_mappings m
    WHERE m.event_code = 'PRODUCTION_MATERIAL_RETURN'
      AND m.company_id IS NOT DISTINCT FROM src.company_id
      AND m.deleted_at IS NULL);

INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
SELECT m.id, v.entry_side, v.line_role,
       CASE WHEN v.line_role = 'INVENTORY' THEN
         (SELECT l.account_id
            FROM accounting.journal_mappings sm
            JOIN accounting.journal_mapping_lines l ON l.mapping_id = sm.id
           WHERE sm.event_code = 'PURCHASE_GRN' AND sm.deleted_at IS NULL
             AND sm.company_id IS NOT DISTINCT FROM m.company_id
             AND l.line_role = 'INVENTORY' AND l.account_id IS NOT NULL
           ORDER BY l.sort_order LIMIT 1)
       END,
       'TOTAL', v.sort_order, true
  FROM accounting.journal_mappings m
 CROSS JOIN (VALUES ('DEBIT', 'INVENTORY', 10), ('CREDIT', 'WIP', 20)) AS v(entry_side, line_role, sort_order)
 WHERE m.event_code = 'PRODUCTION_MATERIAL_RETURN' AND m.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id);
