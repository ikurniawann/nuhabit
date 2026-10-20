-- =============================================================================
-- Gym package journals: deferred revenue for credits and passes
-- =============================================================================
-- Money paid for a gym package sits in deferred revenue until the member
-- uses it. gym-credits publishes gym.credits.journal and accounting posts the
-- GYM_* mappings: sale and refund per payment method, credits used or given
-- back at a class, credits expired (breakage), pass revenue released by day.
-- This file:
--
--   1. creates gym.pass_revenue_releases, the pass revenue released per day
--      (a refund takes it back, a re-run of the sweep releases nothing twice);
--   2. for every company with its own chart of accounts, creates the GYM_*
--      mappings it lacks (module POS), lines empty;
--   3. picks the accounts by name, case-insensitive, postable and active:
--        deferred revenue  LIABILITY: "pendapatan diterima di muka - kredit
--                          gym", else a deferred or unearned revenue account
--                          that names gym or kredit kelas
--        class revenue     REVENUE: "pendapatan kelas gym", "gym class
--                          revenue", else one containing "pendapatan kelas"
--                          or "class revenue"
--        breakage          REVENUE or OTHER_INCOME: "pendapatan kredit gym
--                          kedaluwarsa", "credit breakage", "breakage"
--        pass revenue      REVENUE: "pendapatan pass gym", "gym pass
--                          revenue"; else the class revenue account
--      An exact name wins over a name that contains the phrase, then the
--      lowest code. Cash, bank, QRIS clearing and the ARK Coin liability come
--      from the POS mappings: POS_SALE_CASH CASH, POS_MEMBER_DEPOSIT_CARD BANK
--      (else POS_SALE_DEBIT BANK), POS_SALE_QRIS BANK, POS_SALE_ARK_COIN WALLET;
--   4. creates the accounts no name matches, at the next free code under the
--      parent: "Pendapatan Diterima di Muka - Kredit Gym" (LIABILITY) next to a
--      deferred revenue account or the ARK Coin liability, else in the current
--      liabilities group; "Pendapatan Kelas Gym" (REVENUE) next to the POS
--      revenue account, else in a revenue group; "Pendapatan Kredit Gym
--      Kedaluwarsa" (REVENUE) next to the class revenue account. Without a
--      group to put one in, its lines stay empty and a NOTICE says so;
--   5. fills only the mapping lines that are still empty.
--
-- Staff change any of it on the journal mapping page. Re-running finds the
-- accounts it created by name and changes nothing.
-- =============================================================================

-- 1. Pass revenue released per day ---------------------------------------------

CREATE TABLE IF NOT EXISTS gym.pass_revenue_releases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id       uuid NOT NULL REFERENCES gym.member_passes (id) ON DELETE RESTRICT,
  -- Hari (WIB) yang pendapatannya diakui.
  release_date  date NOT NULL,
  amount_idr    numeric(14,2) NOT NULL CHECK (amount_idr > 0),
  -- Satu jurnal GYM_PASS_REVENUE per perusahaan per sapuan.
  batch_id      uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gym_pass_revenue_releases_day UNIQUE (pass_id, release_date)
);

CREATE INDEX IF NOT EXISTS idx_gym_pass_revenue_releases_batch ON gym.pass_revenue_releases (batch_id);

COMMENT ON TABLE gym.pass_revenue_releases IS
  'Pendapatan pass gym yang sudah diakui per hari (dari pendapatan diterima di muka). Refund pass membalik jumlahnya.';

-- 2-5. Mappings and accounts ---------------------------------------------------

-- An account picked by name among the postable, active accounts of the types.
CREATE OR REPLACE FUNCTION pg_temp.gym_named_account(p_company uuid, p_types text[], p_exact text[], p_pattern text)
RETURNS uuid LANGUAGE sql AS $$
  SELECT a.id FROM accounting.chart_of_accounts a JOIN accounting.account_types t ON t.id = a.account_type_id
   WHERE a.company_id = p_company AND a.deleted_at IS NULL AND a.is_active AND a.is_postable AND t.code = ANY (p_types)
     AND lower(btrim(a.name)) ~ p_pattern
   ORDER BY lower(btrim(a.name)) = ANY (p_exact) DESC, a.code
   LIMIT 1
$$;

-- The account on a company mapping line.
CREATE OR REPLACE FUNCTION pg_temp.gym_mapped_account(p_company uuid, p_event text, p_role text)
RETURNS uuid LANGUAGE sql AS $$
  SELECT l.account_id FROM accounting.journal_mappings m
    JOIN accounting.journal_mapping_lines l ON l.mapping_id = m.id
   WHERE m.company_id = p_company AND m.deleted_at IS NULL AND m.event_code = p_event
     AND l.line_role = p_role AND l.account_id IS NOT NULL
   ORDER BY l.sort_order
   LIMIT 1
$$;

-- The live parent of an account.
CREATE OR REPLACE FUNCTION pg_temp.gym_parent(p_account uuid)
RETURNS uuid LANGUAGE sql AS $$
  SELECT p.id FROM accounting.chart_of_accounts a
    JOIN accounting.chart_of_accounts p ON p.id = a.parent_id AND p.deleted_at IS NULL
   WHERE a.id = p_account
$$;

-- A group (non-postable) account of the type, the one whose name matches
-- first, then the deepest.
CREATE OR REPLACE FUNCTION pg_temp.gym_group(p_company uuid, p_type text, p_pattern text)
RETURNS uuid LANGUAGE sql AS $$
  SELECT p.id FROM accounting.chart_of_accounts p JOIN accounting.account_types t ON t.id = p.account_type_id
   WHERE p.company_id = p_company AND p.deleted_at IS NULL AND NOT p.is_postable AND t.code = p_type
   ORDER BY lower(p.name) ~ p_pattern DESC, p.level DESC, p.code
   LIMIT 1
$$;

-- A new postable account under p_parent at the next free code (the
-- production delta's numbering); NULL without a parent.
CREATE OR REPLACE FUNCTION pg_temp.gym_new_account(p_company uuid, p_parent uuid, p_name text, p_type text,
                                                   p_suffix text, p_description text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_parent record;
  v_next   bigint;
  v_code   text;
  v_id     uuid;
BEGIN
  SELECT * INTO v_parent FROM accounting.chart_of_accounts WHERE id = p_parent;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_next := COALESCE(
    (SELECT max(s.code::bigint) + 1 FROM accounting.chart_of_accounts s
      WHERE s.parent_id = v_parent.id AND s.deleted_at IS NULL AND s.code ~ '^\d+$' AND length(s.code) = length(v_parent.code)),
    CASE WHEN v_parent.code ~ '^\d+$' THEN v_parent.code::bigint + 1 END);
  LOOP
    v_code := COALESCE(lpad(v_next::text, length(v_parent.code), '0'), v_parent.code || '-' || p_suffix);
    EXIT WHEN v_next IS NULL OR NOT EXISTS (SELECT 1 FROM accounting.chart_of_accounts x
      WHERE x.company_id = p_company AND x.code = v_code AND x.deleted_at IS NULL);
    v_next := v_next + 1;
  END LOOP;
  INSERT INTO accounting.chart_of_accounts (company_id, code, name, parent_id, account_type_id, level, is_postable, is_contra,
                                            description, is_active)
  VALUES (p_company, v_code, p_name, v_parent.id, (SELECT id FROM accounting.account_types WHERE code = p_type),
          LEAST(v_parent.level + 1, 4), true, false, p_description || ' Dibuat oleh migrasi 20261021110000.', true)
  RETURNING id INTO v_id;
  RAISE NOTICE 'gym accounts: company % gets % % under %', p_company, v_code, p_name, v_parent.code;
  RETURN v_id;
END;
$$;

DO $$
DECLARE
  c          record;
  v_cash     uuid;
  v_bank     uuid;
  v_qris     uuid;
  v_wallet   uuid;
  v_deferred uuid;
  v_class    uuid;
  v_breakage uuid;
  v_pass     uuid;
BEGIN
  FOR c IN
    SELECT DISTINCT a.company_id FROM accounting.chart_of_accounts a
     WHERE a.company_id IS NOT NULL AND a.deleted_at IS NULL
  LOOP
    -- 2. Mappings and their (empty) lines.
    INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active)
    SELECT c.company_id, v.event_code, v.name, v.description, 'POS', true
      FROM (VALUES
        ('GYM_SALE_CASH', 'Gym Package Sale (Cash)', 'Paket gym dibayar tunai: kas ke pendapatan diterima di muka'),
        ('GYM_SALE_BANK', 'Gym Package Sale (Bank)', 'Paket gym dibayar kartu atau transfer: bank ke pendapatan diterima di muka'),
        ('GYM_SALE_QRIS', 'Gym Package Sale (QRIS)', 'Paket gym dibayar QRIS atau invoice online: kliring QRIS ke pendapatan diterima di muka'),
        ('GYM_SALE_ARK_COIN', 'Gym Package Sale (ARK Coin)', 'Paket gym dibayar ARK Coin: kewajiban ARK Coin ke pendapatan diterima di muka'),
        ('GYM_REFUND_CASH', 'Gym Package Refund (Cash)', 'Refund paket gym tunai: pendapatan diterima di muka ke kas'),
        ('GYM_REFUND_BANK', 'Gym Package Refund (Bank)', 'Refund paket gym kartu atau transfer: pendapatan diterima di muka ke bank'),
        ('GYM_REFUND_QRIS', 'Gym Package Refund (QRIS)', 'Refund paket gym QRIS atau invoice online: pendapatan diterima di muka ke kliring QRIS'),
        ('GYM_REFUND_ARK_COIN', 'Gym Package Refund (ARK Coin)', 'Refund paket gym ke ARK Coin: pendapatan diterima di muka ke kewajiban ARK Coin'),
        ('GYM_CREDIT_USAGE', 'Gym Credit Usage', 'Kredit gym terpakai (check-in, no-show, batal telat): pendapatan diterima di muka ke pendapatan kelas'),
        ('GYM_CREDIT_USAGE_REVERSAL', 'Gym Credit Usage Reversal', 'Kredit gym dikembalikan ke member: pendapatan kelas ke pendapatan diterima di muka'),
        ('GYM_CREDIT_BREAKAGE', 'Gym Credit Breakage', 'Kredit gym kedaluwarsa: pendapatan diterima di muka ke pendapatan kredit kedaluwarsa'),
        ('GYM_PASS_REVENUE', 'Gym Pass Revenue', 'Pengakuan harian pendapatan pass gym dari pendapatan diterima di muka'),
        ('GYM_PASS_REVENUE_REVERSAL', 'Gym Pass Revenue Reversal', 'Pass gym direfund: pendapatan pass yang sudah diakui kembali ke pendapatan diterima di muka')
      ) AS v(event_code, name, description)
     WHERE NOT EXISTS (
       SELECT 1 FROM accounting.journal_mappings m
        WHERE m.company_id = c.company_id AND m.event_code = v.event_code AND m.deleted_at IS NULL);

    INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
    SELECT m.id, v.entry_side, v.line_role, NULL, 'TOTAL', v.sort_order, true
      FROM accounting.journal_mappings m
      JOIN (VALUES
        ('GYM_SALE_CASH', 'DEBIT', 'CASH', 10), ('GYM_SALE_CASH', 'CREDIT', 'GYM_DEFERRED_REVENUE', 20),
        ('GYM_SALE_BANK', 'DEBIT', 'BANK', 10), ('GYM_SALE_BANK', 'CREDIT', 'GYM_DEFERRED_REVENUE', 20),
        ('GYM_SALE_QRIS', 'DEBIT', 'BANK', 10), ('GYM_SALE_QRIS', 'CREDIT', 'GYM_DEFERRED_REVENUE', 20),
        ('GYM_SALE_ARK_COIN', 'DEBIT', 'WALLET', 10), ('GYM_SALE_ARK_COIN', 'CREDIT', 'GYM_DEFERRED_REVENUE', 20),
        ('GYM_REFUND_CASH', 'DEBIT', 'GYM_DEFERRED_REVENUE', 10), ('GYM_REFUND_CASH', 'CREDIT', 'CASH', 20),
        ('GYM_REFUND_BANK', 'DEBIT', 'GYM_DEFERRED_REVENUE', 10), ('GYM_REFUND_BANK', 'CREDIT', 'BANK', 20),
        ('GYM_REFUND_QRIS', 'DEBIT', 'GYM_DEFERRED_REVENUE', 10), ('GYM_REFUND_QRIS', 'CREDIT', 'BANK', 20),
        ('GYM_REFUND_ARK_COIN', 'DEBIT', 'GYM_DEFERRED_REVENUE', 10), ('GYM_REFUND_ARK_COIN', 'CREDIT', 'WALLET', 20),
        ('GYM_CREDIT_USAGE', 'DEBIT', 'GYM_DEFERRED_REVENUE', 10), ('GYM_CREDIT_USAGE', 'CREDIT', 'GYM_CLASS_REVENUE', 20),
        ('GYM_CREDIT_USAGE_REVERSAL', 'DEBIT', 'GYM_CLASS_REVENUE', 10), ('GYM_CREDIT_USAGE_REVERSAL', 'CREDIT', 'GYM_DEFERRED_REVENUE', 20),
        ('GYM_CREDIT_BREAKAGE', 'DEBIT', 'GYM_DEFERRED_REVENUE', 10), ('GYM_CREDIT_BREAKAGE', 'CREDIT', 'GYM_BREAKAGE_REVENUE', 20),
        ('GYM_PASS_REVENUE', 'DEBIT', 'GYM_DEFERRED_REVENUE', 10), ('GYM_PASS_REVENUE', 'CREDIT', 'GYM_PASS_REVENUE', 20),
        ('GYM_PASS_REVENUE_REVERSAL', 'DEBIT', 'GYM_PASS_REVENUE', 10), ('GYM_PASS_REVENUE_REVERSAL', 'CREDIT', 'GYM_DEFERRED_REVENUE', 20)
      ) AS v(event_code, entry_side, line_role, sort_order) ON v.event_code = m.event_code
     WHERE m.company_id = c.company_id AND m.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id);

    -- 3. Accounts that already exist.
    v_cash := pg_temp.gym_mapped_account(c.company_id, 'POS_SALE_CASH', 'CASH');
    v_bank := COALESCE(pg_temp.gym_mapped_account(c.company_id, 'POS_MEMBER_DEPOSIT_CARD', 'BANK'),
                       pg_temp.gym_mapped_account(c.company_id, 'POS_SALE_DEBIT', 'BANK'));
    v_qris := pg_temp.gym_mapped_account(c.company_id, 'POS_SALE_QRIS', 'BANK');
    v_wallet := pg_temp.gym_mapped_account(c.company_id, 'POS_SALE_ARK_COIN', 'WALLET');
    v_deferred := pg_temp.gym_named_account(c.company_id, ARRAY['LIABILITY'], ARRAY['pendapatan diterima di muka - kredit gym'],
      '(diterima di muka|unearned|deferred).*(gym|kredit kelas|class credit)');
    v_class := pg_temp.gym_named_account(c.company_id, ARRAY['REVENUE'], ARRAY['pendapatan kelas gym', 'gym class revenue'],
      '(pendapatan kelas|class revenue)');
    v_breakage := pg_temp.gym_named_account(c.company_id, ARRAY['REVENUE', 'OTHER_INCOME'],
      ARRAY['pendapatan kredit gym kedaluwarsa', 'credit breakage', 'breakage'], '(kredit gym kedaluwarsa|breakage)');
    v_pass := pg_temp.gym_named_account(c.company_id, ARRAY['REVENUE'], ARRAY['pendapatan pass gym', 'gym pass revenue'],
      '(pendapatan pass|pass revenue)');

    -- 4. The accounts no name matches.
    IF v_deferred IS NULL THEN
      v_deferred := pg_temp.gym_new_account(c.company_id,
        COALESCE(pg_temp.gym_parent(pg_temp.gym_named_account(c.company_id, ARRAY['LIABILITY'],
                   ARRAY['pendapatan diterima di muka', 'unearned revenue', 'deferred revenue'],
                   '(pendapatan diterima di muka|unearned revenue|deferred revenue)')),
                 pg_temp.gym_parent(v_wallet),
                 pg_temp.gym_group(c.company_id, 'LIABILITY',
                   '(kewajiban lancar|liabilitas jangka pendek|utang lancar|hutang lancar|current liabilit)')),
        'Pendapatan Diterima di Muka - Kredit Gym', 'LIABILITY', 'GYMDEF',
        'Uang paket kredit dan pass gym yang belum dipakai member.');
      IF v_deferred IS NULL THEN
        RAISE NOTICE 'gym accounts: company % has no liability group; deferred revenue lines stay empty', c.company_id;
      END IF;
    END IF;
    IF v_class IS NULL THEN
      v_class := pg_temp.gym_new_account(c.company_id,
        COALESCE(pg_temp.gym_parent(pg_temp.gym_mapped_account(c.company_id, 'POS_SALE_CASH', 'REVENUE')),
                 pg_temp.gym_group(c.company_id, 'REVENUE', '(pendapatan usaha|operating revenue|pendapatan|revenue)')),
        'Pendapatan Kelas Gym', 'REVENUE', 'GYMREV', 'Pendapatan kelas gym dari kredit yang terpakai dan pass.');
      IF v_class IS NULL THEN
        RAISE NOTICE 'gym accounts: company % has no revenue group; class revenue lines stay empty', c.company_id;
      END IF;
    END IF;
    IF v_breakage IS NULL THEN
      v_breakage := pg_temp.gym_new_account(c.company_id, pg_temp.gym_parent(v_class),
        'Pendapatan Kredit Gym Kedaluwarsa', 'REVENUE', 'GYMEXP', 'Kredit gym yang kedaluwarsa tanpa dipakai.');
    END IF;
    v_pass := COALESCE(v_pass, v_class);

    -- 5. Fill the empty lines of the gym mappings.
    UPDATE accounting.journal_mapping_lines l
       SET account_id = v.account_id, updated_at = now()
      FROM accounting.journal_mappings m
      JOIN (VALUES
        ('CASH', false, v_cash), ('BANK', false, v_bank), ('BANK', true, v_qris), ('WALLET', false, v_wallet),
        ('GYM_DEFERRED_REVENUE', false, v_deferred), ('GYM_CLASS_REVENUE', false, v_class),
        ('GYM_BREAKAGE_REVENUE', false, v_breakage), ('GYM_PASS_REVENUE', false, v_pass)
      ) AS v(line_role, qris, account_id) ON v.qris = (m.event_code LIKE '%\_QRIS' AND v.line_role = 'BANK')
     WHERE l.mapping_id = m.id AND l.line_role = v.line_role AND m.company_id = c.company_id AND m.deleted_at IS NULL
       AND m.event_code LIKE 'GYM\_%' AND l.account_id IS NULL AND v.account_id IS NOT NULL;
  END LOOP;
END $$;
