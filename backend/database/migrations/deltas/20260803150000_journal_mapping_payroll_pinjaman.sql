-- =============================================================================
-- Journal mapping: add PAYROLL + PINJAMAN events + COA backfill
-- =============================================================================

ALTER TABLE accounting.journal_mappings
  DROP CONSTRAINT IF EXISTS journal_mappings_module_check;

ALTER TABLE accounting.journal_mappings
  ADD CONSTRAINT journal_mappings_module_check
  CHECK (module IN ('POS', 'PURCHASING', 'PAYROLL', 'PINJAMAN'));

INSERT INTO accounting.journal_mappings (
  company_id, event_code, name, description, module, is_active
)
SELECT NULL, v.event_code, v.name, v.description, v.module, true
FROM (
  VALUES
    ('PAYROLL_ACCRUAL', 'Payroll Accrual',
     'Pengakuan beban gaji (expense) dan hutang gaji', 'PAYROLL'),
    ('PAYROLL_PAYMENT', 'Payroll Payment',
     'Pembayaran gaji bersih ke karyawan via bank/kas', 'PAYROLL'),
    ('PAYROLL_PPH21_WITHHOLDING', 'Payroll PPh 21 Withholding',
     'Potongan PPh 21 dari payroll', 'PAYROLL'),
    ('PAYROLL_LOAN_DEDUCTION', 'Payroll Loan Deduction',
     'Potongan cicilan pinjaman lewat payroll', 'PAYROLL'),
    ('PINJAMAN_DISBURSEMENT', 'Pinjaman — Pencairan',
     'Pencairan pinjaman karyawan ke rekening/kas', 'PINJAMAN'),
    ('PINJAMAN_REPAYMENT', 'Pinjaman — Pelunasan/Cicilan',
     'Cicilan atau pelunasan pinjaman di luar payroll', 'PINJAMAN')
) AS v(event_code, name, description, module)
WHERE NOT EXISTS (
  SELECT 1
  FROM accounting.journal_mappings m
  WHERE m.event_code = v.event_code
    AND m.company_id IS NULL
    AND m.deleted_at IS NULL
);

INSERT INTO accounting.journal_mapping_lines (
  mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required
)
SELECT m.id, v.entry_side, v.line_role, NULL, v.amount_source, v.sort_order, true
FROM accounting.journal_mappings m
JOIN (
  VALUES
    ('PAYROLL_ACCRUAL', 'DEBIT', 'SALARY_EXPENSE', 'TOTAL', 10),
    ('PAYROLL_ACCRUAL', 'CREDIT', 'SALARY_PAYABLE', 'TOTAL', 20),
    ('PAYROLL_PAYMENT', 'DEBIT', 'SALARY_PAYABLE', 'PAID', 10),
    ('PAYROLL_PAYMENT', 'CREDIT', 'BANK', 'PAID', 20),
    ('PAYROLL_PPH21_WITHHOLDING', 'DEBIT', 'SALARY_PAYABLE', 'TAX', 10),
    ('PAYROLL_PPH21_WITHHOLDING', 'CREDIT', 'TAX', 'TAX', 20),
    ('PAYROLL_LOAN_DEDUCTION', 'DEBIT', 'SALARY_PAYABLE', 'PAID', 10),
    ('PAYROLL_LOAN_DEDUCTION', 'CREDIT', 'LOAN_RECEIVABLE', 'PAID', 20),
    ('PINJAMAN_DISBURSEMENT', 'DEBIT', 'LOAN_RECEIVABLE', 'TOTAL', 10),
    ('PINJAMAN_DISBURSEMENT', 'CREDIT', 'BANK', 'TOTAL', 20),
    ('PINJAMAN_REPAYMENT', 'DEBIT', 'BANK', 'PAID', 10),
    ('PINJAMAN_REPAYMENT', 'CREDIT', 'LOAN_RECEIVABLE', 'PAID', 20)
) AS v(event_code, entry_side, line_role, amount_source, sort_order)
  ON m.event_code = v.event_code
WHERE m.company_id IS NULL
  AND m.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id
  );

-- Backfill COA (global postable accounts)
WITH coa AS (
  SELECT id, code
  FROM accounting.chart_of_accounts
  WHERE deleted_at IS NULL
    AND is_postable = true
    AND is_active = true
    AND company_id IS NULL
),
pick AS (
  SELECT
    (SELECT id FROM coa WHERE code = '6401012' LIMIT 1) AS salary_expense_id, -- Human Capital Expense
    (SELECT id FROM coa WHERE code = '2104001' LIMIT 1) AS salary_payable_id, -- A/E Payroll
    (SELECT id FROM coa WHERE code = '2102002' LIMIT 1) AS pph21_id,          -- Tax PPh 21
    (SELECT id FROM coa WHERE code = '1203001' LIMIT 1) AS loan_recv_id,      -- AR Employee Loan
    (SELECT id FROM coa WHERE code = '1102001' LIMIT 1) AS bank_id            -- BANK BCA
)
UPDATE accounting.journal_mapping_lines l
SET account_id = CASE
  WHEN l.line_role = 'SALARY_EXPENSE' THEN pick.salary_expense_id
  WHEN l.line_role = 'SALARY_PAYABLE' THEN pick.salary_payable_id
  WHEN l.line_role = 'TAX' AND m.event_code = 'PAYROLL_PPH21_WITHHOLDING'
    THEN pick.pph21_id
  WHEN l.line_role = 'LOAN_RECEIVABLE' THEN pick.loan_recv_id
  WHEN l.line_role = 'BANK'
    AND m.event_code IN (
      'PAYROLL_PAYMENT', 'PINJAMAN_DISBURSEMENT', 'PINJAMAN_REPAYMENT'
    )
    THEN pick.bank_id
  ELSE l.account_id
END,
updated_at = now()
FROM accounting.journal_mappings m, pick
WHERE l.mapping_id = m.id
  AND m.deleted_at IS NULL
  AND m.company_id IS NULL
  AND m.module IN ('PAYROLL', 'PINJAMAN')
  AND l.account_id IS NULL;
