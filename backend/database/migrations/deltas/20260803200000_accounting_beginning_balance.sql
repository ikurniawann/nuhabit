-- =============================================================================
-- Accounting: Beginning Balance (OPENING journal entry)
-- =============================================================================

ALTER TABLE accounting.journal_entries
  ADD COLUMN IF NOT EXISTS entry_type varchar(20) NOT NULL DEFAULT 'MANUAL';

ALTER TABLE accounting.journal_entries
  ADD COLUMN IF NOT EXISTS source_fiscal_year_id uuid
    REFERENCES accounting.fiscal_years(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'journal_entries_entry_type_check'
  ) THEN
    ALTER TABLE accounting.journal_entries
      ADD CONSTRAINT journal_entries_entry_type_check
      CHECK (entry_type IN ('MANUAL', 'OPENING'));
  END IF;
END $$;

-- Satu beginning balance (OPENING) per fiscal year
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_opening_fiscal_year
  ON accounting.journal_entries (source_fiscal_year_id)
  WHERE entry_type = 'OPENING'
    AND deleted_at IS NULL
    AND source_fiscal_year_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_type
  ON accounting.journal_entries (entry_type)
  WHERE deleted_at IS NULL;
