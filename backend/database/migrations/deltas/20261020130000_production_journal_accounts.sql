-- =============================================================================
-- Production journals: map the WIP, applied overhead and production loss
-- accounts
-- =============================================================================
-- The production deltas created the journal mappings with the WIP, applied
-- overhead and production loss lines empty, so those journals did not post.
-- For every company that has its own chart of accounts this file:
--
--   1. creates the six production mappings it lacks (PRODUCTION_MATERIAL_ISSUE,
--      _CONVERSION_COST, _OUTPUT_RECEIPT, _SCRAP, _ABNORMAL_SCRAP,
--      _MATERIAL_RETURN), lines empty;
--   2. picks the accounts by name, case-insensitive, postable and active:
--        WIP              ASSET: "barang dalam proses", "work in process", "wip"
--        applied overhead COGS or EXPENSE: "overhead pabrik dibebankan",
--                         "applied overhead"
--        production loss  COGS, EXPENSE or OTHER_EXPENSE: "kerugian produksi",
--                         "production loss"; else the company's COGS account
--      An exact name wins over a name that contains the phrase, then the
--      lowest code. Inventory comes from PURCHASE_GRN, COGS from
--      POS_COGS_RELIEF (else the first postable COGS account);
--   3. creates the WIP account ("Barang Dalam Proses", ASSET, next to the
--      inventory account: same parent, next free code) and the applied
--      overhead account ("Overhead Pabrik Dibebankan", COGS, contra, next to
--      the COGS account) when no account matches. Without an inventory or
--      COGS group to put them in, the line stays empty and a NOTICE says so;
--   4. fills only the mapping lines that are still empty.
--
-- Staff change any of it on the journal mapping page. Re-running finds the
-- accounts it created by name and changes nothing.
-- =============================================================================

DO $$
DECLARE
  c          record;
  v_parent   record;
  v_inv      uuid;
  v_cogs     uuid;
  v_wip      uuid;
  v_applied  uuid;
  v_loss     uuid;
  v_code     text;
  v_next     bigint;
  v_type     uuid;
BEGIN
  FOR c IN
    SELECT DISTINCT a.company_id FROM accounting.chart_of_accounts a
     WHERE a.company_id IS NOT NULL AND a.deleted_at IS NULL
  LOOP
    -- 1. Mappings and their (empty) lines.
    INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active)
    SELECT c.company_id, v.event_code, v.name, v.description, 'INVENTORY', true
      FROM (VALUES
        ('PRODUCTION_MATERIAL_ISSUE', 'Production Material Issue',
         'Bahan baku dikeluarkan ke produksi: persediaan pindah ke barang dalam proses (WIP)'),
        ('PRODUCTION_CONVERSION_COST', 'Production Conversion Cost',
         'Biaya overhead, tenaga kerja, kemasan dan susut dibebankan ke WIP saat hasil produksi diterima'),
        ('PRODUCTION_OUTPUT_RECEIPT', 'Production Output Receipt',
         'Hasil produksi diterima ke persediaan dari WIP sebesar HPP batch'),
        ('PRODUCTION_SCRAP', 'Production Scrap',
         'Sisa WIP tanpa hasil baik dibebankan sebagai kerugian produksi'),
        ('PRODUCTION_ABNORMAL_SCRAP', 'Production Abnormal Scrap',
         'Scrap di atas toleransi dibebankan sebagai kerugian produksi dari WIP'),
        ('PRODUCTION_MATERIAL_RETURN', 'Production Material Return',
         'Bahan sisa produksi dikembalikan ke persediaan dari WIP')
      ) AS v(event_code, name, description)
     WHERE NOT EXISTS (
       SELECT 1 FROM accounting.journal_mappings m
        WHERE m.company_id = c.company_id AND m.event_code = v.event_code AND m.deleted_at IS NULL);

    INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
    SELECT m.id, v.entry_side, v.line_role, NULL, 'TOTAL', v.sort_order, true
      FROM accounting.journal_mappings m
      JOIN (VALUES
        ('PRODUCTION_MATERIAL_ISSUE', 'DEBIT', 'WIP', 10), ('PRODUCTION_MATERIAL_ISSUE', 'CREDIT', 'INVENTORY', 20),
        ('PRODUCTION_CONVERSION_COST', 'DEBIT', 'WIP', 10), ('PRODUCTION_CONVERSION_COST', 'CREDIT', 'OVERHEAD_APPLIED', 20),
        ('PRODUCTION_OUTPUT_RECEIPT', 'DEBIT', 'INVENTORY', 10), ('PRODUCTION_OUTPUT_RECEIPT', 'CREDIT', 'WIP', 20),
        ('PRODUCTION_SCRAP', 'DEBIT', 'COGS', 10), ('PRODUCTION_SCRAP', 'CREDIT', 'WIP', 20),
        ('PRODUCTION_ABNORMAL_SCRAP', 'DEBIT', 'PRODUCTION_LOSS', 10), ('PRODUCTION_ABNORMAL_SCRAP', 'CREDIT', 'WIP', 20),
        ('PRODUCTION_MATERIAL_RETURN', 'DEBIT', 'INVENTORY', 10), ('PRODUCTION_MATERIAL_RETURN', 'CREDIT', 'WIP', 20)
      ) AS v(event_code, entry_side, line_role, sort_order) ON v.event_code = m.event_code
     WHERE m.company_id = c.company_id AND m.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id);

    -- 2. Accounts that already exist.
    v_inv := (SELECT l.account_id FROM accounting.journal_mappings m
                JOIN accounting.journal_mapping_lines l ON l.mapping_id = m.id
               WHERE m.company_id = c.company_id AND m.deleted_at IS NULL AND m.event_code = 'PURCHASE_GRN'
                 AND l.line_role = 'INVENTORY' AND l.account_id IS NOT NULL
               ORDER BY l.sort_order LIMIT 1);
    v_cogs := COALESCE(
      (SELECT l.account_id FROM accounting.journal_mappings m
         JOIN accounting.journal_mapping_lines l ON l.mapping_id = m.id
        WHERE m.company_id = c.company_id AND m.deleted_at IS NULL AND m.event_code = 'POS_COGS_RELIEF'
          AND l.line_role = 'COGS' AND l.account_id IS NOT NULL
        ORDER BY l.sort_order LIMIT 1),
      (SELECT a.id FROM accounting.chart_of_accounts a JOIN accounting.account_types t ON t.id = a.account_type_id
        WHERE a.company_id = c.company_id AND a.deleted_at IS NULL AND a.is_active AND a.is_postable AND t.code = 'COGS'
        ORDER BY a.code LIMIT 1));

    v_wip := (SELECT a.id FROM accounting.chart_of_accounts a JOIN accounting.account_types t ON t.id = a.account_type_id
               WHERE a.company_id = c.company_id AND a.deleted_at IS NULL AND a.is_active AND a.is_postable AND t.code = 'ASSET'
                 AND lower(btrim(a.name)) ~ '\m(barang dalam proses|work in process|wip)\M'
               ORDER BY lower(btrim(a.name)) IN ('barang dalam proses', 'work in process', 'wip') DESC, a.code LIMIT 1);
    v_applied := (SELECT a.id FROM accounting.chart_of_accounts a JOIN accounting.account_types t ON t.id = a.account_type_id
                   WHERE a.company_id = c.company_id AND a.deleted_at IS NULL AND a.is_active AND a.is_postable
                     AND t.code IN ('COGS', 'EXPENSE')
                     AND lower(btrim(a.name)) ~ '(overhead pabrik dibebankan|applied overhead)'
                   ORDER BY lower(btrim(a.name)) IN ('overhead pabrik dibebankan', 'applied overhead') DESC, a.code LIMIT 1);
    v_loss := COALESCE(
      (SELECT a.id FROM accounting.chart_of_accounts a JOIN accounting.account_types t ON t.id = a.account_type_id
        WHERE a.company_id = c.company_id AND a.deleted_at IS NULL AND a.is_active AND a.is_postable
          AND t.code IN ('COGS', 'EXPENSE', 'OTHER_EXPENSE')
          AND lower(btrim(a.name)) ~ '(kerugian produksi|production loss)'
        ORDER BY lower(btrim(a.name)) IN ('kerugian produksi', 'production loss') DESC, a.code LIMIT 1),
      v_cogs);

    -- 3a. A WIP account next to the inventory account.
    IF v_wip IS NULL THEN
      SELECT p.* INTO v_parent FROM accounting.chart_of_accounts p
       WHERE p.id = (SELECT a.parent_id FROM accounting.chart_of_accounts a WHERE a.id = v_inv) AND p.deleted_at IS NULL;
      IF NOT FOUND THEN
        SELECT p.* INTO v_parent FROM accounting.chart_of_accounts p JOIN accounting.account_types t ON t.id = p.account_type_id
         WHERE p.company_id = c.company_id AND p.deleted_at IS NULL AND NOT p.is_postable AND t.code = 'ASSET'
           AND lower(p.name) ~ '(persediaan|inventor)'
         ORDER BY p.level DESC, p.code LIMIT 1;
      END IF;
      IF FOUND THEN
        v_next := COALESCE(
          (SELECT max(s.code::bigint) + 1 FROM accounting.chart_of_accounts s
            WHERE s.parent_id = v_parent.id AND s.deleted_at IS NULL AND s.code ~ '^\d+$' AND length(s.code) = length(v_parent.code)),
          CASE WHEN v_parent.code ~ '^\d+$' THEN v_parent.code::bigint + 1 END);
        LOOP
          v_code := COALESCE(lpad(v_next::text, length(v_parent.code), '0'), v_parent.code || '-WIP');
          EXIT WHEN v_next IS NULL OR NOT EXISTS (SELECT 1 FROM accounting.chart_of_accounts x
            WHERE x.company_id = c.company_id AND x.code = v_code AND x.deleted_at IS NULL);
          v_next := v_next + 1;
        END LOOP;
        v_type := (SELECT id FROM accounting.account_types WHERE code = 'ASSET');
        INSERT INTO accounting.chart_of_accounts (company_id, code, name, parent_id, account_type_id, level, is_postable, is_contra,
                                                  description, is_active)
        VALUES (c.company_id, v_code, 'Barang Dalam Proses', v_parent.id, v_type, LEAST(v_parent.level + 1, 4), true, false,
                'Persediaan barang dalam proses (WIP) produksi. Dibuat oleh migrasi 20261020130000.', true)
        RETURNING id INTO v_wip;
        RAISE NOTICE 'production accounts: company % gets WIP account % Barang Dalam Proses under %', c.company_id, v_code, v_parent.code;
      ELSE
        RAISE NOTICE 'production accounts: company % has no inventory group; WIP lines stay empty', c.company_id;
      END IF;
    END IF;

    -- 3b. An applied overhead account next to the COGS account.
    IF v_applied IS NULL THEN
      SELECT p.* INTO v_parent FROM accounting.chart_of_accounts p
       WHERE p.id = (SELECT a.parent_id FROM accounting.chart_of_accounts a WHERE a.id = v_cogs) AND p.deleted_at IS NULL;
      IF NOT FOUND THEN
        SELECT p.* INTO v_parent FROM accounting.chart_of_accounts p JOIN accounting.account_types t ON t.id = p.account_type_id
         WHERE p.company_id = c.company_id AND p.deleted_at IS NULL AND NOT p.is_postable AND t.code = 'COGS'
         ORDER BY lower(p.name) ~ '(harga pokok|hpp|cost of goods)' DESC, p.level DESC, p.code LIMIT 1;
      END IF;
      IF FOUND THEN
        v_next := COALESCE(
          (SELECT max(s.code::bigint) + 1 FROM accounting.chart_of_accounts s
            WHERE s.parent_id = v_parent.id AND s.deleted_at IS NULL AND s.code ~ '^\d+$' AND length(s.code) = length(v_parent.code)),
          CASE WHEN v_parent.code ~ '^\d+$' THEN v_parent.code::bigint + 1 END);
        LOOP
          v_code := COALESCE(lpad(v_next::text, length(v_parent.code), '0'), v_parent.code || '-OHD');
          EXIT WHEN v_next IS NULL OR NOT EXISTS (SELECT 1 FROM accounting.chart_of_accounts x
            WHERE x.company_id = c.company_id AND x.code = v_code AND x.deleted_at IS NULL);
          v_next := v_next + 1;
        END LOOP;
        v_type := (SELECT id FROM accounting.account_types WHERE code = 'COGS');
        INSERT INTO accounting.chart_of_accounts (company_id, code, name, parent_id, account_type_id, level, is_postable, is_contra,
                                                  description, is_active)
        VALUES (c.company_id, v_code, 'Overhead Pabrik Dibebankan', v_parent.id, v_type, LEAST(v_parent.level + 1, 4), true, true,
                'Overhead produksi yang dibebankan ke WIP (lawan biaya overhead aktual). Dibuat oleh migrasi 20261020130000.', true)
        RETURNING id INTO v_applied;
        RAISE NOTICE 'production accounts: company % gets applied overhead account % Overhead Pabrik Dibebankan under %',
          c.company_id, v_code, v_parent.code;
      ELSE
        RAISE NOTICE 'production accounts: company % has no COGS group; applied overhead lines stay empty', c.company_id;
      END IF;
    END IF;

    -- 4. Fill the empty lines of the production mappings.
    UPDATE accounting.journal_mapping_lines l
       SET account_id = CASE l.line_role
             WHEN 'WIP' THEN v_wip WHEN 'OVERHEAD_APPLIED' THEN v_applied WHEN 'PRODUCTION_LOSS' THEN v_loss
             WHEN 'COGS' THEN v_cogs WHEN 'INVENTORY' THEN v_inv END,
           updated_at = now()
      FROM accounting.journal_mappings m
     WHERE l.mapping_id = m.id AND m.company_id = c.company_id AND m.deleted_at IS NULL
       AND m.event_code IN ('PRODUCTION_MATERIAL_ISSUE', 'PRODUCTION_CONVERSION_COST', 'PRODUCTION_OUTPUT_RECEIPT',
                            'PRODUCTION_SCRAP', 'PRODUCTION_ABNORMAL_SCRAP', 'PRODUCTION_MATERIAL_RETURN')
       AND l.account_id IS NULL
       AND CASE l.line_role
             WHEN 'WIP' THEN v_wip WHEN 'OVERHEAD_APPLIED' THEN v_applied WHEN 'PRODUCTION_LOSS' THEN v_loss
             WHEN 'COGS' THEN v_cogs WHEN 'INVENTORY' THEN v_inv END IS NOT NULL;
  END LOOP;
END $$;
