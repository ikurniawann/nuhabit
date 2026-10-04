-- Accounting masters: fokus per company (Sulu Wonderland).
-- Remap referensi dari COA global → COA SULU, assign master global ke SULU,
-- lalu soft-delete COA global agar list tidak double.

DO $$
DECLARE
  v_sulu uuid;
BEGIN
  SELECT id INTO v_sulu
  FROM configuration.companies
  WHERE code = 'SULU'
  LIMIT 1;

  IF v_sulu IS NULL THEN
    RAISE EXCEPTION 'Company SULU tidak ditemukan';
  END IF;

  -- 1) Remap journal entry lines: global account_id → SULU by code
  UPDATE accounting.journal_entry_lines l
  SET account_id = s.id
  FROM accounting.chart_of_accounts g
  JOIN accounting.chart_of_accounts s
    ON s.code = g.code
   AND s.company_id = v_sulu
   AND s.deleted_at IS NULL
  WHERE l.account_id = g.id
    AND g.company_id IS NULL
    AND g.deleted_at IS NULL;

  -- 2) Remap journal mapping lines
  UPDATE accounting.journal_mapping_lines l
  SET account_id = s.id
  FROM accounting.chart_of_accounts g
  JOIN accounting.chart_of_accounts s
    ON s.code = g.code
   AND s.company_id = v_sulu
   AND s.deleted_at IS NULL
  WHERE l.account_id = g.id
    AND g.company_id IS NULL
    AND g.deleted_at IS NULL;

  -- 3) Assign journal mappings global → SULU
  UPDATE accounting.journal_mappings
  SET company_id = v_sulu,
      updated_at = now()
  WHERE company_id IS NULL
    AND deleted_at IS NULL;

  -- 4) Assign fiscal years global → SULU
  UPDATE accounting.fiscal_years
  SET company_id = v_sulu,
      updated_at = now()
  WHERE company_id IS NULL
    AND deleted_at IS NULL;

  -- 5) Assign journal entries global → SULU
  UPDATE accounting.journal_entries
  SET company_id = v_sulu,
      updated_at = now()
  WHERE company_id IS NULL
    AND deleted_at IS NULL;

  -- 6) Soft-delete COA global (SULU tree tetap)
  UPDATE accounting.chart_of_accounts
  SET deleted_at = now(),
      updated_at = now()
  WHERE company_id IS NULL
    AND deleted_at IS NULL;
END $$;
