-- =============================================================================
-- Gym accounting follow-ups: lot values in sen, cross-company transfers,
-- opening balances, admin adjustments, referral ARK Coin bonuses, payroll
-- recalculation flag
-- =============================================================================
--   1. gym.credit_lots.value_sen: the deferred revenue of a lot in sen. A
--      purchase lot derives it from the purchase; a lot received by transfer
--      stores the value that moved. gym.credit_lots.company_id: the company
--      whose deferred revenue holds the lot (set on transferred lots; a
--      purchase lot books to its purchase's company).
--   2. gym.credit_purchases.opening_batch_id: the opening-balance journal
--      (cmd/gym-opening-balance) that opened the purchase's unused value.
--   3. hris.payroll_runs.needs_recalculation: a payroll addition landed in a
--      draft run that was already calculated.
--   4. For every company with its own chart of accounts, the mappings
--      (module POS) this delta adds, lines filled where an account is found:
--        GYM_CREDIT_ADJUSTMENT   debit GYM_DEFERRED_REVENUE, credit GYM_CLASS_REVENUE
--        GYM_TRANSFER_OUT        debit GYM_DEFERRED_REVENUE, credit INTERCOMPANY_PAYABLE
--        GYM_TRANSFER_IN         debit INTERCOMPANY_RECEIVABLE, credit GYM_DEFERRED_REVENUE
--        GYM_OPENING_BALANCE     debit OPENING_BALANCE, credit GYM_DEFERRED_REVENUE
--        WALLET_REFERRAL_BONUS   debit PROMO_EXPENSE, credit WALLET
--      Deferred and class revenue come from the GYM_CREDIT_USAGE lines, the
--      ARK Coin liability from POS_SALE_ARK_COIN. The rest is picked by name
--      (case-insensitive, postable, active), else created at the next free
--      code under the nearest group:
--        promo expense            EXPENSE   "beban promosi referral", else one naming
--                                           referral; created next to a promotion or
--                                           marketing expense account
--        intercompany payable     LIABILITY "utang antar perusahaan", else one naming
--                                           antar perusahaan / intercompany; created
--                                           in the current liabilities group
--        intercompany receivable  ASSET     "piutang antar perusahaan", else one naming
--                                           antar perusahaan / intercompany; created
--                                           next to trade receivables
--        opening balance          EQUITY    "penyesuaian saldo awal", else one naming
--                                           saldo awal / opening balance; created in
--                                           the equity group
--      Staff change any of it on the journal mapping page. Re-running finds
--      the accounts it created by name and changes nothing.
-- Idempotent.
-- =============================================================================

-- 1. Lot value and company ----------------------------------------------------

ALTER TABLE gym.credit_lots
  ADD COLUMN IF NOT EXISTS value_sen bigint CHECK (value_sen IS NULL OR value_sen >= 0),
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES configuration.companies (id) ON DELETE SET NULL;

COMMENT ON COLUMN gym.credit_lots.value_sen IS
  'Nilai pendapatan diterima di muka lot ini dalam sen. NULL = turunan dari pembelian (total_idr x 100).';
COMMENT ON COLUMN gym.credit_lots.company_id IS
  'Perusahaan yang memegang pendapatan diterima di muka lot ini. NULL = perusahaan cabang pembelian.';

-- The ledger stays append-only, with one exception for cmd/gym-opening-balance:
-- inside a transaction that SET LOCAL gym.ledger_backfill = 'on', an entry
-- without a lot may be pinned to one, and its amount cut to the part that
-- lot takes (the rest is inserted as a copy). Nothing else may change.
CREATE OR REPLACE FUNCTION gym.fn_credit_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('gym.ledger_backfill', true) = 'on'
     AND OLD.lot_id IS NULL AND NEW.lot_id IS NOT NULL
     AND sign(NEW.amount) = sign(OLD.amount) AND abs(NEW.amount) <= abs(OLD.amount)
     AND NEW.id = OLD.id AND NEW.customer_id = OLD.customer_id AND NEW.type = OLD.type
     AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
     AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id AND NEW.note IS NOT DISTINCT FROM OLD.note
     AND NEW.idempotency_key IS NOT DISTINCT FROM OLD.idempotency_key AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
     AND NEW.created_at = OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'gym.credit_ledger bersifat append-only (% ditolak)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- 2. Opening balance marker --------------------------------------------------

ALTER TABLE gym.credit_purchases
  ADD COLUMN IF NOT EXISTS opening_batch_id uuid;

CREATE INDEX IF NOT EXISTS idx_gym_credit_purchases_opening ON gym.credit_purchases (opening_batch_id)
  WHERE opening_batch_id IS NOT NULL;

COMMENT ON COLUMN gym.credit_purchases.opening_batch_id IS
  'Batch jurnal saldo awal (GYM_OPENING_BALANCE) yang membuka sisa nilai pembelian ini.';

-- 3. Payroll recalculation flag ----------------------------------------------

ALTER TABLE hris.payroll_runs
  ADD COLUMN IF NOT EXISTS needs_recalculation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN hris.payroll_runs.needs_recalculation IS
  'Ada penambahan gaji yang masuk setelah run draft ini dihitung; hitung ulang sebelum diproses.';

-- 4. Mappings and accounts ---------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.gym_named_account(p_company uuid, p_types text[], p_exact text[], p_pattern text)
RETURNS uuid LANGUAGE sql AS $$
  SELECT a.id FROM accounting.chart_of_accounts a JOIN accounting.account_types t ON t.id = a.account_type_id
   WHERE a.company_id = p_company AND a.deleted_at IS NULL AND a.is_active AND a.is_postable AND t.code = ANY (p_types)
     AND lower(btrim(a.name)) ~ p_pattern
   ORDER BY lower(btrim(a.name)) = ANY (p_exact) DESC, a.code
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION pg_temp.gym_mapped_account(p_company uuid, p_event text, p_role text)
RETURNS uuid LANGUAGE sql AS $$
  SELECT l.account_id FROM accounting.journal_mappings m
    JOIN accounting.journal_mapping_lines l ON l.mapping_id = m.id
   WHERE m.company_id = p_company AND m.deleted_at IS NULL AND m.event_code = p_event
     AND l.line_role = p_role AND l.account_id IS NOT NULL
   ORDER BY l.sort_order
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION pg_temp.gym_parent(p_account uuid)
RETURNS uuid LANGUAGE sql AS $$
  SELECT p.id FROM accounting.chart_of_accounts a
    JOIN accounting.chart_of_accounts p ON p.id = a.parent_id AND p.deleted_at IS NULL
   WHERE a.id = p_account
$$;

CREATE OR REPLACE FUNCTION pg_temp.gym_group(p_company uuid, p_type text, p_pattern text)
RETURNS uuid LANGUAGE sql AS $$
  SELECT p.id FROM accounting.chart_of_accounts p JOIN accounting.account_types t ON t.id = p.account_type_id
   WHERE p.company_id = p_company AND p.deleted_at IS NULL AND NOT p.is_postable AND t.code = p_type
   ORDER BY lower(p.name) ~ p_pattern DESC, p.level DESC, p.code
   LIMIT 1
$$;

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
          LEAST(v_parent.level + 1, 4), true, false, p_description || ' Dibuat oleh migrasi 20261023110000.', true)
  RETURNING id INTO v_id;
  RAISE NOTICE 'gym accounts: company % gets % % under %', p_company, v_code, p_name, v_parent.code;
  RETURN v_id;
END;
$$;

DO $$
DECLARE
  c            record;
  v_deferred   uuid;
  v_class      uuid;
  v_wallet     uuid;
  v_promo      uuid;
  v_ic_payable uuid;
  v_ic_recv    uuid;
  v_opening    uuid;
BEGIN
  FOR c IN
    SELECT DISTINCT a.company_id FROM accounting.chart_of_accounts a
     WHERE a.company_id IS NOT NULL AND a.deleted_at IS NULL
  LOOP
    INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active)
    SELECT c.company_id, v.event_code, v.name, v.description, 'POS', true
      FROM (VALUES
        ('GYM_CREDIT_ADJUSTMENT', 'Gym Credit Adjustment', 'Kredit gym dikurangi admin: pendapatan diterima di muka ke pendapatan kelas, senilai harga per kredit lot'),
        ('GYM_TRANSFER_OUT', 'Gym Credit Transfer Out', 'Kredit gym pindah ke member di perusahaan lain: pendapatan diterima di muka ke utang antar perusahaan'),
        ('GYM_TRANSFER_IN', 'Gym Credit Transfer In', 'Kredit gym diterima dari member di perusahaan lain: piutang antar perusahaan ke pendapatan diterima di muka'),
        ('GYM_OPENING_BALANCE', 'Gym Deferred Revenue Opening Balance', 'Saldo awal pendapatan diterima di muka paket gym yang dijual sebelum jurnal gym ada (cmd/gym-opening-balance)'),
        ('WALLET_REFERRAL_BONUS', 'ARK Coin Referral Bonus', 'Bonus ARK Coin referral: beban promosi ke kewajiban ARK Coin')
      ) AS v(event_code, name, description)
     WHERE NOT EXISTS (
       SELECT 1 FROM accounting.journal_mappings m
        WHERE m.company_id = c.company_id AND m.event_code = v.event_code AND m.deleted_at IS NULL);

    INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
    SELECT m.id, v.entry_side, v.line_role, NULL, 'TOTAL', v.sort_order, true
      FROM accounting.journal_mappings m
      JOIN (VALUES
        ('GYM_CREDIT_ADJUSTMENT', 'DEBIT', 'GYM_DEFERRED_REVENUE', 10), ('GYM_CREDIT_ADJUSTMENT', 'CREDIT', 'GYM_CLASS_REVENUE', 20),
        ('GYM_TRANSFER_OUT', 'DEBIT', 'GYM_DEFERRED_REVENUE', 10), ('GYM_TRANSFER_OUT', 'CREDIT', 'INTERCOMPANY_PAYABLE', 20),
        ('GYM_TRANSFER_IN', 'DEBIT', 'INTERCOMPANY_RECEIVABLE', 10), ('GYM_TRANSFER_IN', 'CREDIT', 'GYM_DEFERRED_REVENUE', 20),
        ('GYM_OPENING_BALANCE', 'DEBIT', 'OPENING_BALANCE', 10), ('GYM_OPENING_BALANCE', 'CREDIT', 'GYM_DEFERRED_REVENUE', 20),
        ('WALLET_REFERRAL_BONUS', 'DEBIT', 'PROMO_EXPENSE', 10), ('WALLET_REFERRAL_BONUS', 'CREDIT', 'WALLET', 20)
      ) AS v(event_code, entry_side, line_role, sort_order) ON v.event_code = m.event_code
     WHERE m.company_id = c.company_id AND m.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id);

    v_deferred := COALESCE(pg_temp.gym_mapped_account(c.company_id, 'GYM_CREDIT_USAGE', 'GYM_DEFERRED_REVENUE'),
      pg_temp.gym_named_account(c.company_id, ARRAY['LIABILITY'], ARRAY['pendapatan diterima di muka - kredit gym'],
        '(diterima di muka|unearned|deferred).*(gym|kredit kelas|class credit)'));
    v_class := COALESCE(pg_temp.gym_mapped_account(c.company_id, 'GYM_CREDIT_USAGE', 'GYM_CLASS_REVENUE'),
      pg_temp.gym_named_account(c.company_id, ARRAY['REVENUE'], ARRAY['pendapatan kelas gym', 'gym class revenue'],
        '(pendapatan kelas|class revenue)'));
    v_wallet := pg_temp.gym_mapped_account(c.company_id, 'POS_SALE_ARK_COIN', 'WALLET');
    v_promo := pg_temp.gym_named_account(c.company_id, ARRAY['EXPENSE', 'OTHER_EXPENSE'],
      ARRAY['beban promosi referral', 'referral promotion expense'], '(promosi referral|referral)');
    v_ic_payable := pg_temp.gym_named_account(c.company_id, ARRAY['LIABILITY'],
      ARRAY['utang antar perusahaan', 'hutang antar perusahaan', 'intercompany payable'], '(antar perusahaan|intercompany|interco|afiliasi)');
    v_ic_recv := pg_temp.gym_named_account(c.company_id, ARRAY['ASSET'],
      ARRAY['piutang antar perusahaan', 'intercompany receivable'], '(antar perusahaan|intercompany|interco|afiliasi)');
    v_opening := pg_temp.gym_named_account(c.company_id, ARRAY['EQUITY'],
      ARRAY['penyesuaian saldo awal', 'saldo awal', 'opening balance'], '(saldo awal|opening balance|penyesuaian saldo)');

    IF v_promo IS NULL THEN
      v_promo := pg_temp.gym_new_account(c.company_id,
        COALESCE(pg_temp.gym_parent(pg_temp.gym_named_account(c.company_id, ARRAY['EXPENSE'],
                   ARRAY['beban promosi', 'beban pemasaran', 'beban iklan dan promosi'],
                   '(promosi|pemasaran|marketing|promotion|advertis)')),
                 pg_temp.gym_group(c.company_id, 'EXPENSE', '(beban operasional|beban usaha|operating expense|beban|expense)')),
        'Beban Promosi Referral', 'EXPENSE', 'REFPROMO', 'Bonus ARK Coin program referral member.');
      IF v_promo IS NULL THEN
        RAISE NOTICE 'gym accounts: company % has no expense group; referral bonus lines stay empty', c.company_id;
      END IF;
    END IF;
    IF v_ic_payable IS NULL THEN
      v_ic_payable := pg_temp.gym_new_account(c.company_id,
        COALESCE(pg_temp.gym_group(c.company_id, 'LIABILITY',
                   '(kewajiban lancar|liabilitas jangka pendek|utang lancar|hutang lancar|current liabilit)'),
                 pg_temp.gym_parent(v_deferred)),
        'Utang Antar Perusahaan', 'LIABILITY', 'ICPAY', 'Nilai kredit gym yang pindah ke member perusahaan lain.');
      IF v_ic_payable IS NULL THEN
        RAISE NOTICE 'gym accounts: company % has no liability group; transfer out lines stay empty', c.company_id;
      END IF;
    END IF;
    IF v_ic_recv IS NULL THEN
      v_ic_recv := pg_temp.gym_new_account(c.company_id,
        COALESCE(pg_temp.gym_parent(pg_temp.gym_named_account(c.company_id, ARRAY['ASSET'],
                   ARRAY['piutang usaha', 'accounts receivable', 'piutang dagang'], '(piutang usaha|piutang dagang|accounts receivable|trade receivable)')),
                 pg_temp.gym_group(c.company_id, 'ASSET', '(piutang|receivable|aset lancar|aktiva lancar|current asset)')),
        'Piutang Antar Perusahaan', 'ASSET', 'ICRECV', 'Nilai kredit gym yang diterima dari member perusahaan lain.');
      IF v_ic_recv IS NULL THEN
        RAISE NOTICE 'gym accounts: company % has no asset group; transfer in lines stay empty', c.company_id;
      END IF;
    END IF;
    IF v_opening IS NULL THEN
      v_opening := pg_temp.gym_new_account(c.company_id,
        COALESCE(pg_temp.gym_group(c.company_id, 'EQUITY', '(ekuitas|equity|modal)'),
                 pg_temp.gym_parent(pg_temp.gym_named_account(c.company_id, ARRAY['EQUITY'],
                   ARRAY['laba ditahan', 'retained earnings'], '(laba ditahan|retained)'))),
        'Penyesuaian Saldo Awal', 'EQUITY', 'OPENING', 'Saldo awal pendapatan diterima di muka paket gym.');
      IF v_opening IS NULL THEN
        RAISE NOTICE 'gym accounts: company % has no equity group; opening balance lines stay empty', c.company_id;
      END IF;
    END IF;

    UPDATE accounting.journal_mapping_lines l
       SET account_id = v.account_id, updated_at = now()
      FROM accounting.journal_mappings m
      JOIN (VALUES
        ('GYM_DEFERRED_REVENUE', v_deferred), ('GYM_CLASS_REVENUE', v_class), ('WALLET', v_wallet),
        ('PROMO_EXPENSE', v_promo), ('INTERCOMPANY_PAYABLE', v_ic_payable), ('INTERCOMPANY_RECEIVABLE', v_ic_recv),
        ('OPENING_BALANCE', v_opening)
      ) AS v(line_role, account_id) ON true
     WHERE l.mapping_id = m.id AND l.line_role = v.line_role AND m.company_id = c.company_id AND m.deleted_at IS NULL
       AND m.event_code IN ('GYM_CREDIT_ADJUSTMENT', 'GYM_TRANSFER_OUT', 'GYM_TRANSFER_IN', 'GYM_OPENING_BALANCE', 'WALLET_REFERRAL_BONUS')
       AND l.account_id IS NULL AND v.account_id IS NOT NULL;
  END LOOP;
END $$;
