-- =============================================================================
-- Backfill journal_mapping_lines.account_id from existing global COA
-- Prefer company_id IS NULL (template) accounts by compact code.
-- =============================================================================

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
    (SELECT id FROM coa WHERE code = '1101001' LIMIT 1) AS cash_id,          -- House Bank / Cashier
    (SELECT id FROM coa WHERE code = '1102001' LIMIT 1) AS bank_id,          -- BANK BCA
    (SELECT id FROM coa WHERE code = '1202002' LIMIT 1) AS qris_id,          -- AR QR BCA
    (SELECT id FROM coa WHERE code = '1202005' LIMIT 1) AS edc_id,           -- AR EDC BCA
    (SELECT id FROM coa WHERE code = '4101001' LIMIT 1) AS revenue_id,       -- Food Revenue
    (SELECT id FROM coa WHERE code = '2102001' LIMIT 1) AS tax_id,           -- Tax PB1 / Pembangunan
    (SELECT id FROM coa WHERE code = '5101001' LIMIT 1) AS cogs_id,          -- COGS Food
    (SELECT id FROM coa WHERE code = '1301001' LIMIT 1) AS inventory_id,     -- Inventory Dry Goods
    (SELECT id FROM coa WHERE code = '2101001' LIMIT 1) AS ap_id,            -- AP Raw Material
    (SELECT id FROM coa WHERE code = '2101003' LIMIT 1) AS grni_id,          -- AP Suspense (proxy GRNI)
    (SELECT id FROM coa WHERE code = '2103006' LIMIT 1) AS wallet_gift_id    -- Trade Other (wallet/gift proxy)
)
UPDATE accounting.journal_mapping_lines l
SET account_id = CASE
  -- Event-specific bank clearing
  WHEN m.event_code = 'POS_SALE_QRIS' AND l.line_role = 'BANK'
    THEN pick.qris_id
  WHEN m.event_code IN ('POS_SALE_DEBIT', 'POS_SALE_CREDIT') AND l.line_role = 'BANK'
    THEN pick.edc_id
  WHEN l.line_role = 'CASH' THEN pick.cash_id
  WHEN l.line_role = 'BANK' THEN pick.bank_id
  WHEN l.line_role = 'REVENUE' THEN pick.revenue_id
  WHEN l.line_role = 'TAX' THEN pick.tax_id
  WHEN l.line_role = 'COGS' THEN pick.cogs_id
  WHEN l.line_role = 'INVENTORY' THEN pick.inventory_id
  WHEN l.line_role = 'AP' THEN pick.ap_id
  WHEN l.line_role = 'GRNI' THEN pick.grni_id
  WHEN l.line_role IN ('WALLET', 'GIFT_CARD_LIABILITY') THEN pick.wallet_gift_id
  ELSE l.account_id
END,
updated_at = now()
FROM accounting.journal_mappings m, pick
WHERE l.mapping_id = m.id
  AND m.deleted_at IS NULL
  AND m.company_id IS NULL
  AND l.account_id IS NULL;
