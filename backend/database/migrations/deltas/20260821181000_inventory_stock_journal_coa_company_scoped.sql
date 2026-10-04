-- Backfill STOCK_* journal mapping accounts using company-scoped COA
-- (SULU seed tidak menyimpan template global company_id IS NULL).

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
  AND (l.account_id IS NULL OR l.account_id IS DISTINCT FROM CASE
    WHEN m.event_code LIKE 'STOCK_%' AND l.line_role = 'COGS' THEN pick.spoil_id
    WHEN m.event_code LIKE 'STOCK_%' AND l.line_role = 'INVENTORY' THEN pick.inventory_id
    WHEN m.event_code = 'STOCK_TRANSFER' AND l.line_role = 'OTHER' THEN pick.inventory_id
    ELSE l.account_id
  END);
