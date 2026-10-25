-- =============================================================================
-- Gym coach commission: revenue share, the second incentive scheme type
-- =============================================================================
-- Per branch per month a pool is X% of the class revenue plus Y% of the PT
-- revenue the books recognised (credits used at the lot unit price, pass
-- revenue released by day). Coaches who taught at the branch that month split
-- it by role share (head coach, coach, assistant, or a per-coach override),
-- each share scaled by the coach's sessions at the branch over all their
-- sessions that month. A share total under 100% leaves the rest of the pool
-- with the company; over 100% blocks approval. Discipline incidents cut a
-- coach's line by a percentage per incident type, capped per month.
--
--   1. gym.commission_schemes: one default (branch_id NULL) plus one per
--      branch, with the pool and share percentages, the deductions and the
--      payout channel (payroll addition or direct payment). The seeded
--      default is inactive, so no branch earns commission until staff turn
--      a scheme on.
--   2. gym.coach_commission_profiles: a coach's role and share override.
--   3. gym.commission_statements and gym.commission_lines: the monthly
--      statement per branch (draft, approved, paid) and one line per coach.
--   4. For every company with its own chart of accounts, the mappings
--      (module PAYROLL), lines filled where an account is found:
--        GYM_COMMISSION_ACCRUAL       debit GYM_COMMISSION_EXPENSE, credit GYM_COMMISSION_PAYABLE
--        GYM_COMMISSION_PAYROLL       debit GYM_COMMISSION_PAYABLE, credit GYM_COMMISSION_EXPENSE
--        GYM_COMMISSION_PAYMENT_CASH  debit GYM_COMMISSION_PAYABLE, credit CASH
--        GYM_COMMISSION_PAYMENT_BANK  debit GYM_COMMISSION_PAYABLE, credit BANK
--      GYM_COMMISSION_PAYROLL hands a line to payroll: the payroll run books
--      it again as salary expense, so this entry takes it out of commission
--      expense and clears the payable.
--      Accounts are picked by name (case-insensitive, postable, active):
--        expense  EXPENSE or OTHER_EXPENSE "beban komisi coach", "coach
--                 commission expense", else one naming komisi or commission;
--                 created next to the salary expense of PAYROLL_ACCRUAL,
--                 else in an expense group
--        payable  LIABILITY "utang komisi coach", "hutang komisi coach",
--                 "commission payable", else one naming utang komisi or
--                 commission payable; created next to the salary payable of
--                 PAYROLL_ACCRUAL, else in the current liabilities group
--      Cash and bank come from POS_SALE_CASH CASH and POS_MEMBER_DEPOSIT_CARD
--      BANK (else POS_SALE_DEBIT BANK, else PAYROLL_PAYMENT BANK).
--      Staff change any of it on the journal mapping page. Re-running finds
--      the accounts it created by name and changes nothing.
--   5. Grants: approving and paying commission are update and create on
--      gym.incentives, which the incentive roles already hold.
-- Idempotent.
-- =============================================================================

-- 1. Schemes -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.commission_schemes (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = the default for branches without their own scheme.
  branch_id                 uuid REFERENCES configuration.branches (id) ON DELETE CASCADE,
  name                      text NOT NULL,
  class_pool_percent        numeric(5,2) NOT NULL DEFAULT 10 CHECK (class_pool_percent BETWEEN 0 AND 100),
  pt_pool_percent           numeric(5,2) NOT NULL DEFAULT 40 CHECK (pt_pool_percent BETWEEN 0 AND 100),
  share_head_coach_percent  numeric(5,2) NOT NULL DEFAULT 20 CHECK (share_head_coach_percent BETWEEN 0 AND 100),
  share_coach_percent       numeric(5,2) NOT NULL DEFAULT 16 CHECK (share_coach_percent BETWEEN 0 AND 100),
  share_assistant_percent   numeric(5,2) NOT NULL DEFAULT 8 CHECK (share_assistant_percent BETWEEN 0 AND 100),
  -- Commission cut per incident, by incident type: {"no_show": 15, ...}.
  deduction_percents        jsonb NOT NULL DEFAULT '{"no_show": 15, "short_notice_leave": 5, "late": 5}'::jsonb,
  max_deduction_percent     numeric(5,2) NOT NULL DEFAULT 50 CHECK (max_deduction_percent BETWEEN 0 AND 100),
  -- payroll: a paid line becomes a payroll addition; direct: paid in cash or by transfer outside payroll.
  payout_channel            text NOT NULL DEFAULT 'payroll' CHECK (payout_channel IN ('payroll', 'direct')),
  is_active                 boolean NOT NULL DEFAULT true,
  created_by                uuid,
  updated_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_commission_schemes_branch
  ON gym.commission_schemes (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

INSERT INTO gym.commission_schemes (name, is_active)
SELECT 'Bagi hasil default', false
 WHERE NOT EXISTS (SELECT 1 FROM gym.commission_schemes WHERE branch_id IS NULL);

-- 2. Coach role and share override --------------------------------------------

CREATE TABLE IF NOT EXISTS gym.coach_commission_profiles (
  coach_id       uuid PRIMARY KEY REFERENCES gym.coaches (id) ON DELETE CASCADE,
  role           text NOT NULL DEFAULT 'coach' CHECK (role IN ('head_coach', 'coach', 'assistant')),
  -- NULL = the role share of the scheme.
  share_percent  numeric(5,2) CHECK (share_percent IS NULL OR share_percent BETWEEN 0 AND 100),
  updated_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 3. Monthly statements -------------------------------------------------------

CREATE TABLE IF NOT EXISTS gym.commission_statements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id           uuid NOT NULL REFERENCES configuration.branches (id) ON DELETE RESTRICT,
  period_month        text NOT NULL CHECK (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  scheme_id           uuid REFERENCES gym.commission_schemes (id) ON DELETE SET NULL,
  scheme_name         text NOT NULL,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  payout_channel      text NOT NULL CHECK (payout_channel IN ('payroll', 'direct')),
  class_revenue_idr   numeric(14,2) NOT NULL DEFAULT 0,
  pt_revenue_idr      numeric(14,2) NOT NULL DEFAULT 0,
  class_pool_percent  numeric(5,2) NOT NULL,
  pt_pool_percent     numeric(5,2) NOT NULL,
  class_pool_idr      numeric(14,2) NOT NULL DEFAULT 0,
  pt_pool_idr         numeric(14,2) NOT NULL DEFAULT 0,
  total_pool_idr      numeric(14,2) NOT NULL DEFAULT 0,
  allocated_percent   numeric(7,2) NOT NULL DEFAULT 0,
  allocated_idr       numeric(14,2) NOT NULL DEFAULT 0,
  retained_idr        numeric(14,2) NOT NULL DEFAULT 0,
  -- The scheme as it was when the statement was computed.
  settings            jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  approved_at         timestamptz,
  approved_by         uuid,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gym_commission_statements_period UNIQUE (branch_id, period_month)
);

CREATE TABLE IF NOT EXISTS gym.commission_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id          uuid NOT NULL REFERENCES gym.commission_statements (id) ON DELETE CASCADE,
  coach_id              uuid NOT NULL REFERENCES gym.coaches (id) ON DELETE RESTRICT,
  coach_name            text NOT NULL,
  role                  text NOT NULL,
  share_percent         numeric(5,2) NOT NULL,
  class_sessions        integer NOT NULL DEFAULT 0,
  pt_sessions           integer NOT NULL DEFAULT 0,
  attendees             integer NOT NULL DEFAULT 0,
  -- Classes and PT sessions the coach taught at every branch that month.
  all_sessions          integer NOT NULL DEFAULT 0,
  attribution_percent   numeric(6,2) NOT NULL DEFAULT 100,
  gross_idr             numeric(14,2) NOT NULL DEFAULT 0,
  deduction_percent     numeric(5,2) NOT NULL DEFAULT 0,
  deduction_idr         numeric(14,2) NOT NULL DEFAULT 0,
  amount_idr            numeric(14,2) NOT NULL DEFAULT 0,
  -- [{id, kind, occurredOn, percent}] behind deduction_percent.
  incidents             jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  payment_method        text CHECK (payment_method IS NULL OR payment_method IN ('payroll', 'cash', 'transfer')),
  payment_reference     text,
  -- The payroll period (YYYY-MM) a line paid through payroll landed in.
  payroll_period        text,
  paid_at               timestamptz,
  paid_by               uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gym_commission_lines_coach UNIQUE (statement_id, coach_id)
);

CREATE INDEX IF NOT EXISTS idx_gym_commission_lines_coach ON gym.commission_lines (coach_id, status);

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
          LEAST(v_parent.level + 1, 4), true, false, p_description || ' Dibuat oleh migrasi 20261028140000.', true)
  RETURNING id INTO v_id;
  RAISE NOTICE 'gym accounts: company % gets % % under %', p_company, v_code, p_name, v_parent.code;
  RETURN v_id;
END;
$$;

DO $$
DECLARE
  c          record;
  v_expense  uuid;
  v_payable  uuid;
  v_cash     uuid;
  v_bank     uuid;
BEGIN
  FOR c IN
    SELECT DISTINCT a.company_id FROM accounting.chart_of_accounts a
     WHERE a.company_id IS NOT NULL AND a.deleted_at IS NULL
  LOOP
    INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active)
    SELECT c.company_id, v.event_code, v.name, v.description, 'PAYROLL', true
      FROM (VALUES
        ('GYM_COMMISSION_ACCRUAL', 'Gym Coach Commission Accrual', 'Statement komisi coach disetujui: beban komisi ke utang komisi'),
        ('GYM_COMMISSION_PAYROLL', 'Gym Coach Commission to Payroll', 'Komisi coach dibayar lewat payroll: payroll membukukannya sebagai beban gaji, jadi utang komisi ditutup ke beban komisi'),
        ('GYM_COMMISSION_PAYMENT_CASH', 'Gym Coach Commission Payment (Cash)', 'Komisi coach dibayar tunai di luar payroll: utang komisi ke kas'),
        ('GYM_COMMISSION_PAYMENT_BANK', 'Gym Coach Commission Payment (Bank)', 'Komisi coach dibayar transfer di luar payroll: utang komisi ke bank')
      ) AS v(event_code, name, description)
     WHERE NOT EXISTS (
       SELECT 1 FROM accounting.journal_mappings m
        WHERE m.company_id = c.company_id AND m.event_code = v.event_code AND m.deleted_at IS NULL);

    INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
    SELECT m.id, v.entry_side, v.line_role, NULL, 'TOTAL', v.sort_order, true
      FROM accounting.journal_mappings m
      JOIN (VALUES
        ('GYM_COMMISSION_ACCRUAL', 'DEBIT', 'GYM_COMMISSION_EXPENSE', 10), ('GYM_COMMISSION_ACCRUAL', 'CREDIT', 'GYM_COMMISSION_PAYABLE', 20),
        ('GYM_COMMISSION_PAYROLL', 'DEBIT', 'GYM_COMMISSION_PAYABLE', 10), ('GYM_COMMISSION_PAYROLL', 'CREDIT', 'GYM_COMMISSION_EXPENSE', 20),
        ('GYM_COMMISSION_PAYMENT_CASH', 'DEBIT', 'GYM_COMMISSION_PAYABLE', 10), ('GYM_COMMISSION_PAYMENT_CASH', 'CREDIT', 'CASH', 20),
        ('GYM_COMMISSION_PAYMENT_BANK', 'DEBIT', 'GYM_COMMISSION_PAYABLE', 10), ('GYM_COMMISSION_PAYMENT_BANK', 'CREDIT', 'BANK', 20)
      ) AS v(event_code, entry_side, line_role, sort_order) ON v.event_code = m.event_code
     WHERE m.company_id = c.company_id AND m.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id);

    v_expense := pg_temp.gym_named_account(c.company_id, ARRAY['EXPENSE', 'OTHER_EXPENSE'],
      ARRAY['beban komisi coach', 'coach commission expense'], '(komisi|commission)');
    v_payable := pg_temp.gym_named_account(c.company_id, ARRAY['LIABILITY'],
      ARRAY['utang komisi coach', 'hutang komisi coach', 'commission payable'], '(utang komisi|hutang komisi|commission payable)');
    v_cash := pg_temp.gym_mapped_account(c.company_id, 'POS_SALE_CASH', 'CASH');
    v_bank := COALESCE(pg_temp.gym_mapped_account(c.company_id, 'POS_MEMBER_DEPOSIT_CARD', 'BANK'),
                       pg_temp.gym_mapped_account(c.company_id, 'POS_SALE_DEBIT', 'BANK'),
                       pg_temp.gym_mapped_account(c.company_id, 'PAYROLL_PAYMENT', 'BANK'));

    IF v_expense IS NULL THEN
      v_expense := pg_temp.gym_new_account(c.company_id,
        COALESCE(pg_temp.gym_parent(pg_temp.gym_mapped_account(c.company_id, 'PAYROLL_ACCRUAL', 'SALARY_EXPENSE')),
                 pg_temp.gym_group(c.company_id, 'EXPENSE',
                   '(beban gaji|beban karyawan|beban pegawai|salar|beban operasional|beban usaha|operating expense|beban|expense)')),
        'Beban Komisi Coach', 'EXPENSE', 'GYMCOM', 'Komisi bagi hasil coach gym.');
      IF v_expense IS NULL THEN
        RAISE NOTICE 'gym accounts: company % has no expense group; commission expense lines stay empty', c.company_id;
      END IF;
    END IF;
    IF v_payable IS NULL THEN
      v_payable := pg_temp.gym_new_account(c.company_id,
        COALESCE(pg_temp.gym_parent(pg_temp.gym_mapped_account(c.company_id, 'PAYROLL_ACCRUAL', 'SALARY_PAYABLE')),
                 pg_temp.gym_group(c.company_id, 'LIABILITY',
                   '(kewajiban lancar|liabilitas jangka pendek|utang lancar|hutang lancar|current liabilit)')),
        'Utang Komisi Coach', 'LIABILITY', 'GYMCOMPAY', 'Komisi bagi hasil coach gym yang belum dibayar.');
      IF v_payable IS NULL THEN
        RAISE NOTICE 'gym accounts: company % has no liability group; commission payable lines stay empty', c.company_id;
      END IF;
    END IF;

    UPDATE accounting.journal_mapping_lines l
       SET account_id = v.account_id, updated_at = now()
      FROM accounting.journal_mappings m
      JOIN (VALUES
        ('GYM_COMMISSION_EXPENSE', v_expense), ('GYM_COMMISSION_PAYABLE', v_payable), ('CASH', v_cash), ('BANK', v_bank)
      ) AS v(line_role, account_id) ON true
     WHERE l.mapping_id = m.id AND l.line_role = v.line_role AND m.company_id = c.company_id AND m.deleted_at IS NULL
       AND m.event_code LIKE 'GYM\_COMMISSION\_%'
       AND l.account_id IS NULL AND v.account_id IS NOT NULL;
  END LOOP;
END $$;
