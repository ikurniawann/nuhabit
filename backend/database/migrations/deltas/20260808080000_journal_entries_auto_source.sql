-- =============================================================================
-- Accounting: AUTO journal entries + source document idempotency
-- =============================================================================

ALTER TABLE accounting.journal_entries
  ADD COLUMN IF NOT EXISTS source_module varchar(40);

ALTER TABLE accounting.journal_entries
  ADD COLUMN IF NOT EXISTS source_event_code varchar(60);

ALTER TABLE accounting.journal_entries
  ADD COLUMN IF NOT EXISTS source_document_type varchar(40);

ALTER TABLE accounting.journal_entries
  ADD COLUMN IF NOT EXISTS source_document_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'journal_entries_entry_type_check'
  ) THEN
    ALTER TABLE accounting.journal_entries
      DROP CONSTRAINT journal_entries_entry_type_check;
  END IF;

  ALTER TABLE accounting.journal_entries
    ADD CONSTRAINT journal_entries_entry_type_check
    CHECK (entry_type IN ('MANUAL', 'OPENING', 'AUTO'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_source_event_doc
  ON accounting.journal_entries (company_id, source_event_code, source_document_id)
  WHERE source_document_id IS NOT NULL
    AND source_event_code IS NOT NULL
    AND deleted_at IS NULL
    AND company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_source_event_doc_global
  ON accounting.journal_entries (source_event_code, source_document_id)
  WHERE source_document_id IS NOT NULL
    AND source_event_code IS NOT NULL
    AND deleted_at IS NULL
    AND company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_source_document
  ON accounting.journal_entries (source_document_type, source_document_id)
  WHERE source_document_id IS NOT NULL
    AND deleted_at IS NULL;

COMMENT ON COLUMN accounting.journal_entries.source_event_code IS
  'Journal mapping event code that generated this AUTO entry (e.g. PURCHASE_GRN)';
COMMENT ON COLUMN accounting.journal_entries.source_document_id IS
  'Source operational document id for idempotent AUTO posting';
