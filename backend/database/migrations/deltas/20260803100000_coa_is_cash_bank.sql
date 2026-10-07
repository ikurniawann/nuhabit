-- =============================================================================
-- Accounting COA: flag akun kas/bank (is_cash_bank)
-- =============================================================================

ALTER TABLE accounting.chart_of_accounts
  ADD COLUMN IF NOT EXISTS is_cash_bank boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_coa_is_cash_bank
  ON accounting.chart_of_accounts (is_cash_bank)
  WHERE deleted_at IS NULL AND is_cash_bank = true;

COMMENT ON COLUMN accounting.chart_of_accounts.is_cash_bank IS
  'True jika akun adalah kas atau bank (untuk cash position / reconciliation).';
