-- =============================================================================
-- Payroll journals for the employee BPJS deductions and both Tapera shares
-- =============================================================================
-- A paid run left the employee BPJS deductions in the salary payable and
-- posted no Tapera at all. accounting.ensure_payroll_journal_mappings(company)
-- now also creates, with their template lines:
--   * PAYROLL_BPJS_TK_EMPLOYEE / PAYROLL_BPJS_KES_EMPLOYEE: debit the salary
--     payable, credit the BPJS Ketenagakerjaan / Kesehatan payable;
--   * PAYROLL_TAPERA_EMPLOYEE: debit the salary payable, credit the Tapera
--     payable;
--   * PAYROLL_TAPERA_EMPLOYER: debit the Tapera expense (an expense account
--     named Tapera, else 6401012 Human Capital Expense), credit the Tapera
--     payable (a liability account named Tapera).
-- Everything else is unchanged: missing mappings only, empty lines only, the
-- number of filled lines returned. It runs again for every company.
--
-- Proven by TestPayrollMappingsFromChartAndCompanySplit (accounting).
-- =============================================================================

CREATE OR REPLACE FUNCTION accounting.ensure_payroll_journal_mappings(p_company_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_filled integer;
BEGIN
  INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active)
  SELECT p_company_id, v.event_code, v.name, v.description, 'PAYROLL', true
    FROM (VALUES
      ('PAYROLL_ACCRUAL', 'Payroll Accrual', 'Pengakuan beban gaji (expense) dan hutang gaji'),
      ('PAYROLL_PAYMENT', 'Payroll Payment', 'Pembayaran gaji bersih ke karyawan via bank/kas'),
      ('PAYROLL_PPH21_WITHHOLDING', 'Payroll PPh 21 Withholding', 'Potongan PPh 21 dari payroll'),
      ('PAYROLL_LOAN_DEDUCTION', 'Payroll Loan Deduction', 'Potongan cicilan pinjaman lewat payroll'),
      ('PAYROLL_BPJS_TK_EMPLOYER', 'Payroll BPJS Ketenagakerjaan (Pemberi Kerja)',
       'Iuran BPJS Ketenagakerjaan bagian perusahaan (beban dan hutang BPJS)'),
      ('PAYROLL_BPJS_KES_EMPLOYER', 'Payroll BPJS Kesehatan (Pemberi Kerja)',
       'Iuran BPJS Kesehatan bagian perusahaan (beban dan hutang BPJS)'),
      ('PAYROLL_BPJS_TK_EMPLOYEE', 'Payroll BPJS Ketenagakerjaan (Karyawan)',
       'Potongan BPJS Ketenagakerjaan karyawan (hutang gaji ke hutang BPJS)'),
      ('PAYROLL_BPJS_KES_EMPLOYEE', 'Payroll BPJS Kesehatan (Karyawan)',
       'Potongan BPJS Kesehatan karyawan (hutang gaji ke hutang BPJS)'),
      ('PAYROLL_TAPERA_EMPLOYER', 'Payroll Tapera (Pemberi Kerja)',
       'Iuran Tapera bagian perusahaan (beban dan hutang Tapera)'),
      ('PAYROLL_TAPERA_EMPLOYEE', 'Payroll Tapera (Karyawan)',
       'Potongan Tapera karyawan (hutang gaji ke hutang Tapera)')
    ) AS v(event_code, name, description)
   WHERE NOT EXISTS (
     SELECT 1 FROM accounting.journal_mappings m
      WHERE m.event_code = v.event_code
        AND m.company_id IS NOT DISTINCT FROM p_company_id
        AND m.deleted_at IS NULL);

  INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
  SELECT m.id, v.entry_side, v.line_role, NULL, v.amount_source, v.sort_order, true
    FROM accounting.journal_mappings m
    JOIN (VALUES
      ('PAYROLL_ACCRUAL', 'DEBIT', 'SALARY_EXPENSE', 'TOTAL', 10),
      ('PAYROLL_ACCRUAL', 'CREDIT', 'SALARY_PAYABLE', 'TOTAL', 20),
      ('PAYROLL_PAYMENT', 'DEBIT', 'SALARY_PAYABLE', 'PAID', 10),
      ('PAYROLL_PAYMENT', 'CREDIT', 'BANK', 'PAID', 20),
      ('PAYROLL_PPH21_WITHHOLDING', 'DEBIT', 'SALARY_PAYABLE', 'TAX', 10),
      ('PAYROLL_PPH21_WITHHOLDING', 'CREDIT', 'TAX', 'TAX', 20),
      ('PAYROLL_LOAN_DEDUCTION', 'DEBIT', 'SALARY_PAYABLE', 'PAID', 10),
      ('PAYROLL_LOAN_DEDUCTION', 'CREDIT', 'LOAN_RECEIVABLE', 'PAID', 20),
      ('PAYROLL_BPJS_TK_EMPLOYER', 'DEBIT', 'BPJS_EXPENSE', 'TOTAL', 10),
      ('PAYROLL_BPJS_TK_EMPLOYER', 'CREDIT', 'BPJS_TK_PAYABLE', 'TOTAL', 20),
      ('PAYROLL_BPJS_KES_EMPLOYER', 'DEBIT', 'BPJS_EXPENSE', 'TOTAL', 10),
      ('PAYROLL_BPJS_KES_EMPLOYER', 'CREDIT', 'BPJS_KES_PAYABLE', 'TOTAL', 20),
      ('PAYROLL_BPJS_TK_EMPLOYEE', 'DEBIT', 'SALARY_PAYABLE', 'TOTAL', 10),
      ('PAYROLL_BPJS_TK_EMPLOYEE', 'CREDIT', 'BPJS_TK_PAYABLE', 'TOTAL', 20),
      ('PAYROLL_BPJS_KES_EMPLOYEE', 'DEBIT', 'SALARY_PAYABLE', 'TOTAL', 10),
      ('PAYROLL_BPJS_KES_EMPLOYEE', 'CREDIT', 'BPJS_KES_PAYABLE', 'TOTAL', 20),
      ('PAYROLL_TAPERA_EMPLOYER', 'DEBIT', 'TAPERA_EXPENSE', 'TOTAL', 10),
      ('PAYROLL_TAPERA_EMPLOYER', 'CREDIT', 'TAPERA_PAYABLE', 'TOTAL', 20),
      ('PAYROLL_TAPERA_EMPLOYEE', 'DEBIT', 'SALARY_PAYABLE', 'TOTAL', 10),
      ('PAYROLL_TAPERA_EMPLOYEE', 'CREDIT', 'TAPERA_PAYABLE', 'TOTAL', 20)
    ) AS v(event_code, entry_side, line_role, amount_source, sort_order) ON v.event_code = m.event_code
   WHERE m.company_id IS NOT DISTINCT FROM p_company_id
     AND m.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id);

  -- Candidates per line role, best rank first: the seeded code, then names.
  WITH rules(line_role, rank, code, name_like, code_like, cash_bank) AS (
    VALUES
      ('SALARY_EXPENSE', 1, '6401012', NULL, NULL, NULL),
      ('SALARY_EXPENSE', 2, NULL, '%human capital expense%', NULL, NULL),
      ('SALARY_EXPENSE', 3, NULL, '%beban gaji%', NULL, NULL),
      ('SALARY_EXPENSE', 4, NULL, '%salar%', '6%', NULL),
      ('SALARY_PAYABLE', 1, '2104001', NULL, NULL, NULL),
      ('SALARY_PAYABLE', 2, NULL, '%payroll%', '2%', NULL),
      ('SALARY_PAYABLE', 3, NULL, '%hutang gaji%', NULL, NULL),
      ('SALARY_PAYABLE', 4, NULL, '%utang gaji%', NULL, NULL),
      ('TAX', 1, '2102002', NULL, NULL, NULL),
      ('TAX', 2, NULL, '%pph%21%', '2%', NULL),
      ('LOAN_RECEIVABLE', 1, '1203001', NULL, NULL, NULL),
      ('LOAN_RECEIVABLE', 2, NULL, '%employe%loan%', NULL, NULL),
      ('LOAN_RECEIVABLE', 3, NULL, '%piutang karyawan%', NULL, NULL),
      ('BANK', 1, '1102001', NULL, NULL, NULL),
      ('BANK', 2, NULL, '%bank%', NULL, true),
      ('BANK', 3, NULL, NULL, NULL, true),
      ('BPJS_EXPENSE', 1, NULL, '%bpjs%', '6%', NULL),
      ('BPJS_EXPENSE', 2, '6401012', NULL, NULL, NULL),
      ('BPJS_EXPENSE', 3, NULL, '%human capital expense%', NULL, NULL),
      ('BPJS_TK_PAYABLE', 1, '2103002', NULL, NULL, NULL),
      ('BPJS_TK_PAYABLE', 2, NULL, '%bpjs%ketenagakerjaan%', NULL, NULL),
      ('BPJS_KES_PAYABLE', 1, '2103003', NULL, NULL, NULL),
      ('BPJS_KES_PAYABLE', 2, NULL, '%bpjs%kesehatan%', NULL, NULL),
      ('TAPERA_EXPENSE', 1, NULL, '%tapera%', '6%', NULL),
      ('TAPERA_EXPENSE', 2, '6401012', NULL, NULL, NULL),
      ('TAPERA_EXPENSE', 3, NULL, '%human capital expense%', NULL, NULL),
      ('TAPERA_PAYABLE', 1, NULL, '%tapera%', '2%', NULL)
  ),
  picks AS (
    SELECT l.id AS line_id,
           (SELECT c.id
              FROM rules r
              JOIN accounting.chart_of_accounts c
                ON c.company_id IS NOT DISTINCT FROM m.company_id
               AND c.deleted_at IS NULL AND c.is_active AND c.is_postable
               AND c.name NOT ILIKE '%kas negara%'
               AND (r.code IS NULL OR c.code = r.code)
               AND (r.name_like IS NULL OR c.name ILIKE r.name_like)
               AND (r.code_like IS NULL OR c.code LIKE r.code_like)
               AND (r.cash_bank IS NULL OR c.is_cash_bank = r.cash_bank)
             WHERE r.line_role = l.line_role
             ORDER BY r.rank, c.code
             LIMIT 1) AS account_id
      FROM accounting.journal_mapping_lines l
      JOIN accounting.journal_mappings m ON m.id = l.mapping_id
     WHERE m.module = 'PAYROLL'
       AND m.deleted_at IS NULL
       AND m.company_id IS NOT DISTINCT FROM p_company_id
       AND l.account_id IS NULL
  )
  UPDATE accounting.journal_mapping_lines l
     SET account_id = p.account_id, updated_at = now()
    FROM picks p
   WHERE l.id = p.line_id AND p.account_id IS NOT NULL;
  GET DIAGNOSTICS v_filled = ROW_COUNT;
  RETURN v_filled;
END;
$function$;

SELECT accounting.ensure_payroll_journal_mappings(c.company_id)
  FROM (
    SELECT DISTINCT company_id FROM accounting.journal_mappings WHERE module = 'PAYROLL' AND deleted_at IS NULL
    UNION
    SELECT DISTINCT company_id FROM accounting.chart_of_accounts WHERE deleted_at IS NULL AND company_id IS NOT NULL
  ) AS c;
