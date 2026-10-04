-- =============================================================================
-- Backfill is_cash_bank for existing COA (leaf cash/bank under 1101 / 1102)
-- =============================================================================

-- True hanya untuk akun postable level-4 di grup CASH (1101xxx) & BANK (1102xxx).
-- Header (1101000/1102000), loan, bunga bank, AR transfer, dll. tetap false.
UPDATE accounting.chart_of_accounts
SET is_cash_bank = (
      is_postable = true
      AND level = 4
      AND (code LIKE '1101%' OR code LIKE '1102%')
    ),
    updated_at = now()
WHERE deleted_at IS NULL;
