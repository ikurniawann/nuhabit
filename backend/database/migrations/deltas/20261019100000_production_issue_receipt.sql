-- =============================================================================
-- Production: material issue, WIP and batch receipts with scrap
-- =============================================================================
-- The production module (backend/internal/modules/production) runs an order
-- in steps: staff issue materials in one or more issues, the issued value
-- sits in WIP, and output comes in as batches with good and scrap
-- quantities. The final batch completes the order.
--
--   * manufacturing.production_issues / production_issue_lines: one issue and
--     its lines, each pointing at the inventory movement it wrote.
--   * production_order_materials.qty_issued / issued_cost: running totals of
--     the issue lines, kept in the issue transaction.
--   * production_batches gains the cost split of a receipt: material_cost +
--     conversion_cost = total_cost; scrap_cost is WIP written off when a
--     final batch has no good units. qty_produced stays the good quantity.
--   * Journal mappings PRODUCTION_MATERIAL_ISSUE, PRODUCTION_CONVERSION_COST,
--     PRODUCTION_OUTPUT_RECEIPT and PRODUCTION_SCRAP for every company that
--     maps PURCHASE_GRN. Inventory and COGS accounts are copied from the
--     existing mappings; WIP and applied overhead stay empty until an
--     accountant picks them, so those journals stay unposted until then.
--   * Menus WIP Produksi and Biaya Batch under both production groups.
--
-- Idempotent: IF NOT EXISTS everywhere, NOT EXISTS guards on the seeds.
-- =============================================================================

CREATE TABLE IF NOT EXISTS manufacturing.production_issues (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    production_order_id uuid NOT NULL REFERENCES manufacturing.production_orders(id) ON DELETE RESTRICT,
    nomor_issue         varchar(60) NOT NULL UNIQUE,
    total_cost          numeric(15,2) NOT NULL DEFAULT 0,
    catatan             text,
    created_by          uuid REFERENCES auth.users(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE manufacturing.production_issues IS
  'Pengeluaran bahan ke produksi (satu dokumen per pengeluaran); nilainya masuk WIP order.';

CREATE INDEX IF NOT EXISTS idx_production_issues_order ON manufacturing.production_issues (production_order_id, created_at);

CREATE TABLE IF NOT EXISTS manufacturing.production_issue_lines (
    id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id                     uuid NOT NULL REFERENCES manufacturing.production_issues(id) ON DELETE CASCADE,
    production_order_material_id uuid NOT NULL REFERENCES manufacturing.production_order_materials(id) ON DELETE RESTRICT,
    raw_material_id              uuid NOT NULL REFERENCES item.raw_materials(id) ON DELETE RESTRICT,
    qty                          numeric(15,4) NOT NULL CHECK (qty > 0),
    unit_cost                    numeric(15,2) NOT NULL DEFAULT 0,
    total_cost                   numeric(15,2) NOT NULL DEFAULT 0,
    inventory_movement_id        uuid REFERENCES inventory.inventory_movements(id) ON DELETE SET NULL,
    warehouse_id                 uuid REFERENCES configuration.warehouses(id) ON DELETE SET NULL,
    created_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_issue_lines_issue ON manufacturing.production_issue_lines (issue_id);
CREATE INDEX IF NOT EXISTS idx_production_issue_lines_material ON manufacturing.production_issue_lines (production_order_material_id);

ALTER TABLE manufacturing.production_order_materials
    ADD COLUMN IF NOT EXISTS qty_issued numeric(15,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS issued_cost numeric(15,2) NOT NULL DEFAULT 0;

ALTER TABLE manufacturing.production_batches
    ADD COLUMN IF NOT EXISTS qty_scrap numeric(15,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS material_cost numeric(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS conversion_cost numeric(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS scrap_cost numeric(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_final boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS catatan text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_batches_qty_scrap_check') THEN
    ALTER TABLE manufacturing.production_batches
      ADD CONSTRAINT production_batches_qty_scrap_check CHECK (qty_scrap >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_production_batches_created ON manufacturing.production_batches (created_at DESC);

-- ── Journal mappings ────────────────────────────────────────────────────────

INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active)
SELECT src.company_id, v.event_code, v.name, v.description, 'INVENTORY', true
  FROM (SELECT DISTINCT m.company_id FROM accounting.journal_mappings m
         WHERE m.event_code = 'PURCHASE_GRN' AND m.deleted_at IS NULL) AS src
 CROSS JOIN (VALUES
   ('PRODUCTION_MATERIAL_ISSUE', 'Production Material Issue',
    'Bahan baku dikeluarkan ke produksi: persediaan pindah ke barang dalam proses (WIP)'),
   ('PRODUCTION_CONVERSION_COST', 'Production Conversion Cost',
    'Biaya overhead, tenaga kerja, kemasan dan susut dibebankan ke WIP saat hasil produksi diterima'),
   ('PRODUCTION_OUTPUT_RECEIPT', 'Production Output Receipt',
    'Hasil produksi diterima ke persediaan dari WIP sebesar HPP batch'),
   ('PRODUCTION_SCRAP', 'Production Scrap',
    'Sisa WIP tanpa hasil baik dibebankan sebagai kerugian produksi')
 ) AS v(event_code, name, description)
 WHERE NOT EXISTS (
   SELECT 1 FROM accounting.journal_mappings m
    WHERE m.event_code = v.event_code
      AND m.company_id IS NOT DISTINCT FROM src.company_id
      AND m.deleted_at IS NULL);

INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
SELECT m.id, v.entry_side, v.line_role,
       (SELECT l.account_id
          FROM accounting.journal_mappings sm
          JOIN accounting.journal_mapping_lines l ON l.mapping_id = sm.id
         WHERE sm.event_code = v.source_event AND sm.deleted_at IS NULL
           AND sm.company_id IS NOT DISTINCT FROM m.company_id
           AND l.line_role = v.source_role AND l.account_id IS NOT NULL
         ORDER BY l.sort_order LIMIT 1),
       'TOTAL', v.sort_order, true
  FROM accounting.journal_mappings m
  JOIN (VALUES
    ('PRODUCTION_MATERIAL_ISSUE', 'DEBIT', 'WIP', 10, NULL, NULL),
    ('PRODUCTION_MATERIAL_ISSUE', 'CREDIT', 'INVENTORY', 20, 'PURCHASE_GRN', 'INVENTORY'),
    ('PRODUCTION_CONVERSION_COST', 'DEBIT', 'WIP', 10, NULL, NULL),
    ('PRODUCTION_CONVERSION_COST', 'CREDIT', 'OVERHEAD_APPLIED', 20, NULL, NULL),
    ('PRODUCTION_OUTPUT_RECEIPT', 'DEBIT', 'INVENTORY', 10, 'PURCHASE_GRN', 'INVENTORY'),
    ('PRODUCTION_OUTPUT_RECEIPT', 'CREDIT', 'WIP', 20, NULL, NULL),
    ('PRODUCTION_SCRAP', 'DEBIT', 'COGS', 10, 'POS_COGS_RELIEF', 'COGS'),
    ('PRODUCTION_SCRAP', 'CREDIT', 'WIP', 20, NULL, NULL)
  ) AS v(event_code, entry_side, line_role, sort_order, source_event, source_role)
    ON v.event_code = m.event_code
 WHERE m.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id);

-- ── Menus ───────────────────────────────────────────────────────────────────
-- New codes are also in the keep list of database/seeders/iam-menus.sql.

INSERT INTO iam.menus (code, menu_name, route_path, icon, menu_type, order_number, permission_context)
VALUES
  ('items.product.production.wip', 'WIP Produksi', '/dashboard/product/production/wip', 'clock', 'sidebar', 30, '{"actions":["read"]}'::jsonb),
  ('items.product.production.batches', 'Biaya Batch', '/dashboard/product/production/batches', 'reports', 'sidebar', 40, '{"actions":["read"]}'::jsonb),
  ('items.raw-material.production.wip', 'WIP Produksi', '/dashboard/raw-material/production/wip', 'clock', 'sidebar', 30, '{"actions":["read"]}'::jsonb),
  ('items.raw-material.production.batches', 'Biaya Batch', '/dashboard/raw-material/production/batches', 'reports', 'sidebar', 40, '{"actions":["read"]}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  menu_name = EXCLUDED.menu_name, route_path = EXCLUDED.route_path,
  icon = EXCLUDED.icon, menu_type = EXCLUDED.menu_type,
  order_number = EXCLUDED.order_number, is_active = true, is_visible = true,
  deleted_at = NULL, updated_at = now();

UPDATE iam.menus SET module = 'items', level = 4
 WHERE code IN ('items.product.production.wip', 'items.product.production.batches',
                'items.raw-material.production.wip', 'items.raw-material.production.batches');

UPDATE iam.menus child SET parent_id = parent.id
  FROM iam.menus parent
 WHERE child.code IN ('items.product.production.wip', 'items.product.production.batches',
                      'items.raw-material.production.wip', 'items.raw-material.production.batches')
   AND parent.code = left(child.code, length(child.code) - position('.' in reverse(child.code)));

-- Every role that runs production (holds the hub menu) reads the new pages.
INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
SELECT rmp.role_id, m.id, '["read"]'::jsonb
  FROM iam.menus m
  JOIN iam.menus hub ON hub.code = replace(replace(m.code, '.wip', '.hub'), '.batches', '.hub')
  JOIN iam.role_menu_permissions rmp ON rmp.menu_id = hub.id AND rmp.is_active
 WHERE m.code IN ('items.product.production.wip', 'items.product.production.batches',
                  'items.raw-material.production.wip', 'items.raw-material.production.batches')
ON CONFLICT (role_id, menu_id) DO NOTHING;
