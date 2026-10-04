-- Isi COA baris DISCOUNT / SERVICE_CHARGE di mapping POS_SALE_*
-- yang masih NULL. Tanpa ini, penjualan berdiskon debit-nya terlewat
-- → "Jurnal tidak balance: Debit TOTAL ≠ Credit SUBTOTAL".

WITH discount_coa AS (
  SELECT DISTINCT ON (company_id)
    company_id,
    id AS account_id
  FROM accounting.chart_of_accounts
  WHERE deleted_at IS NULL
    AND is_active = true
    AND is_postable = true
    AND code IN ('4103002', '4103008', '4103004', '4103005')
  ORDER BY
    company_id NULLS LAST,
    CASE code
      WHEN '4103002' THEN 1
      WHEN '4103008' THEN 2
      WHEN '4103004' THEN 3
      ELSE 4
    END
),
sc_coa AS (
  SELECT DISTINCT ON (company_id)
    company_id,
    id AS account_id
  FROM accounting.chart_of_accounts
  WHERE deleted_at IS NULL
    AND is_active = true
    AND is_postable = true
    AND code IN ('4103006', '4102004')
  ORDER BY
    company_id NULLS LAST,
    CASE code WHEN '4103006' THEN 1 ELSE 2 END
)
UPDATE accounting.journal_mapping_lines l
SET account_id = COALESCE(
      (
        SELECT d.account_id
        FROM discount_coa d
        WHERE d.company_id IS NOT DISTINCT FROM m.company_id
        LIMIT 1
      ),
      (SELECT d.account_id FROM discount_coa d WHERE d.company_id IS NULL LIMIT 1)
    ),
    updated_at = now()
FROM accounting.journal_mappings m
WHERE l.mapping_id = m.id
  AND m.deleted_at IS NULL
  AND m.event_code LIKE 'POS_SALE_%'
  AND l.line_role = 'DISCOUNT'
  AND l.amount_source = 'DISCOUNT'
  AND l.account_id IS NULL;

WITH sc_coa AS (
  SELECT DISTINCT ON (company_id)
    company_id,
    id AS account_id
  FROM accounting.chart_of_accounts
  WHERE deleted_at IS NULL
    AND is_active = true
    AND is_postable = true
    AND code IN ('4103006', '4102004')
  ORDER BY
    company_id NULLS LAST,
    CASE code WHEN '4103006' THEN 1 ELSE 2 END
)
UPDATE accounting.journal_mapping_lines l
SET account_id = COALESCE(
      (
        SELECT s.account_id
        FROM sc_coa s
        WHERE s.company_id IS NOT DISTINCT FROM m.company_id
        LIMIT 1
      ),
      (SELECT s.account_id FROM sc_coa s WHERE s.company_id IS NULL LIMIT 1)
    ),
    updated_at = now()
FROM accounting.journal_mappings m
WHERE l.mapping_id = m.id
  AND m.deleted_at IS NULL
  AND m.event_code LIKE 'POS_SALE_%'
  AND l.line_role = 'OTHER'
  AND l.amount_source = 'SERVICE_CHARGE'
  AND l.account_id IS NULL;
