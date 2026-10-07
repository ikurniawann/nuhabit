-- =============================================================================
-- Inventory stock events → Journal Mapping (opname / adjustment / transfer)
-- Module INVENTORY + seed templates + backfill COA SULU
-- =============================================================================

ALTER TABLE accounting.journal_mappings
  DROP CONSTRAINT IF EXISTS journal_mappings_module_check;

ALTER TABLE accounting.journal_mappings
  ADD CONSTRAINT journal_mappings_module_check
  CHECK (module IN ('POS', 'PURCHASING', 'PAYROLL', 'PINJAMAN', 'SALES', 'INVENTORY'));

-- ── Event templates (accounts filled by backfill below) ─────────────────────
INSERT INTO accounting.journal_mappings (
  company_id, event_code, name, description, module, is_active
)
SELECT NULL, v.event_code, v.name, v.description, v.module, true
FROM (
  VALUES
    ('STOCK_OPNAME_SHORTAGE', 'Stock Opname — Shortage',
     'Selisih opname kurang: beban spoil/waste, kredit inventori', 'INVENTORY'),
    ('STOCK_OPNAME_SURPLUS', 'Stock Opname — Surplus',
     'Selisih opname lebih: debit inventori, kredit spoil/waste (koreksi)', 'INVENTORY'),
    ('STOCK_ADJUSTMENT_SHORTAGE', 'Stock Adjustment — Shortage',
     'Penyesuaian stok kurang: beban spoil/waste, kredit inventori', 'INVENTORY'),
    ('STOCK_ADJUSTMENT_SURPLUS', 'Stock Adjustment — Surplus',
     'Penyesuaian stok lebih: debit inventori, kredit spoil/waste (koreksi)', 'INVENTORY'),
    ('STOCK_TRANSFER', 'Stock Transfer',
     'Transfer antar gudang (audit nilai; Dr/Cr inventori netral)', 'INVENTORY')
) AS v(event_code, name, description, module)
WHERE NOT EXISTS (
  SELECT 1
  FROM accounting.journal_mappings m
  WHERE m.event_code = v.event_code
    AND m.company_id IS NULL
    AND m.deleted_at IS NULL
);

INSERT INTO accounting.journal_mapping_lines (
  mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required
)
SELECT m.id, v.entry_side, v.line_role, NULL, v.amount_source, v.sort_order, true
FROM accounting.journal_mappings m
JOIN (
  VALUES
    -- Shortage: Dr COGS spoil / Cr Inventory
    ('STOCK_OPNAME_SHORTAGE', 'DEBIT', 'COGS', 'TOTAL', 10),
    ('STOCK_OPNAME_SHORTAGE', 'CREDIT', 'INVENTORY', 'TOTAL', 20),
    ('STOCK_OPNAME_SURPLUS', 'DEBIT', 'INVENTORY', 'TOTAL', 10),
    ('STOCK_OPNAME_SURPLUS', 'CREDIT', 'COGS', 'TOTAL', 20),
    ('STOCK_ADJUSTMENT_SHORTAGE', 'DEBIT', 'COGS', 'TOTAL', 10),
    ('STOCK_ADJUSTMENT_SHORTAGE', 'CREDIT', 'INVENTORY', 'TOTAL', 20),
    ('STOCK_ADJUSTMENT_SURPLUS', 'DEBIT', 'INVENTORY', 'TOTAL', 10),
    ('STOCK_ADJUSTMENT_SURPLUS', 'CREDIT', 'COGS', 'TOTAL', 20),
    -- Transfer: Dr Inventory / Cr Inventory (akun diisi sama saat backfill;
    -- runtime boleh override ke coa_asset bahan)
    ('STOCK_TRANSFER', 'DEBIT', 'INVENTORY', 'TOTAL', 10),
    ('STOCK_TRANSFER', 'CREDIT', 'OTHER', 'TOTAL', 20)
) AS v(event_code, entry_side, line_role, amount_source, sort_order)
  ON m.event_code = v.event_code
WHERE m.company_id IS NULL
  AND m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id
  );

-- ── Backfill COA (global template; prefer company-scoped later via UI) ───────
-- Spoil/Waste Food 5101002; Inventory Dry Goods 1301001 as default inventory
WITH coa AS (
  SELECT id, code
  FROM accounting.chart_of_accounts
  WHERE deleted_at IS NULL
    AND is_postable = true
    AND is_active = true
    AND company_id IS NULL
),
pick AS (
  SELECT
    (SELECT id FROM coa WHERE code = '5101002' LIMIT 1) AS spoil_id,
    (SELECT id FROM coa WHERE code = '1301001' LIMIT 1) AS inventory_id
)
UPDATE accounting.journal_mapping_lines l
SET account_id = CASE
  WHEN m.event_code LIKE 'STOCK_%' AND l.line_role = 'COGS' THEN pick.spoil_id
  WHEN m.event_code LIKE 'STOCK_%' AND l.line_role = 'INVENTORY' THEN pick.inventory_id
  WHEN m.event_code = 'STOCK_TRANSFER' AND l.line_role = 'OTHER' THEN pick.inventory_id
  ELSE l.account_id
END,
updated_at = now()
FROM accounting.journal_mappings m, pick
WHERE l.mapping_id = m.id
  AND m.deleted_at IS NULL
  AND m.company_id IS NULL
  AND m.module = 'INVENTORY'
  AND l.account_id IS NULL
  AND pick.spoil_id IS NOT NULL
  AND pick.inventory_id IS NOT NULL;

-- Fallback: bila tidak ada COA global, pakai akun company-scoped pertama per code
WITH coa AS (
  SELECT DISTINCT ON (code) id, code
  FROM accounting.chart_of_accounts
  WHERE deleted_at IS NULL
    AND is_postable = true
    AND is_active = true
  ORDER BY code, CASE WHEN company_id IS NULL THEN 0 ELSE 1 END, created_at
),
pick AS (
  SELECT
    (SELECT id FROM coa WHERE code = '5101002' LIMIT 1) AS spoil_id,
    (SELECT id FROM coa WHERE code = '1301001' LIMIT 1) AS inventory_id
)
UPDATE accounting.journal_mapping_lines l
SET account_id = CASE
  WHEN m.event_code LIKE 'STOCK_%' AND l.line_role = 'COGS' THEN pick.spoil_id
  WHEN m.event_code LIKE 'STOCK_%' AND l.line_role = 'INVENTORY' THEN pick.inventory_id
  WHEN m.event_code = 'STOCK_TRANSFER' AND l.line_role = 'OTHER' THEN pick.inventory_id
  ELSE l.account_id
END,
updated_at = now()
FROM accounting.journal_mappings m, pick
WHERE l.mapping_id = m.id
  AND m.deleted_at IS NULL
  AND m.company_id IS NULL
  AND m.module = 'INVENTORY'
  AND l.account_id IS NULL;
