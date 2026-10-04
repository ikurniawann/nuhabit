package payroll

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/database"
)

// hris.payroll_runs, hris.payroll_details, hris.payroll_settings,
// hris.payroll_tax_config, hris.employee_salary and hris.loans belong to
// this module.

// runDetailsJSON is the o2m embed of getRun (natural order, as json_agg).
const runDetailsJSON = `COALESCE((SELECT json_agg(e) FROM (
     SELECT id, employee_id, net_salary, gross_salary, total_deductions, pph21_deduction,
            status, payslip_sent, payslip_sent_at
       FROM hris.payroll_details WHERE payroll_run_id = r.id) e), '[]'::json) AS payroll_details`

func listRunRows(ctx context.Context, q database.Querier, year *int, status *string) ([]*obj, error) {
	where, args := []string{}, []any{}
	if year != nil && *year != 0 {
		args = append(args, *year)
		where = append(where, "period_year = $1")
	}
	if status != nil {
		args = append(args, *status)
		where = append(where, "status = $"+itoa(len(args)))
	}
	sql := `SELECT * FROM hris.payroll_runs`
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}
	return queryObjs(ctx, q, sql+` ORDER BY period_year DESC, period_month DESC`, args...)
}

// runByID is SELECT * plus, when withDetails, the payroll_details embed.
func runByID(ctx context.Context, q database.Querier, id string, withDetails bool) (*obj, error) {
	cols := "r.*"
	if withDetails {
		cols += ", " + runDetailsJSON
	}
	return queryObj(ctx, q, `SELECT `+cols+` FROM hris.payroll_runs r WHERE r.id = $1`, id)
}

// runLookup is the TS "existing" read: id/status/period, nil on any error
// (the query-builder result's error is ignored there).
type runHead struct {
	ID          string
	Status      string
	PeriodMonth int
	PeriodYear  int
}

func runHeadByID(ctx context.Context, q database.Querier, id string) *runHead {
	var h runHead
	err := q.QueryRow(ctx, `SELECT id::text, status, period_month, period_year FROM hris.payroll_runs WHERE id::text = $1`, id).
		Scan(&h.ID, &h.Status, &h.PeriodMonth, &h.PeriodYear)
	if err != nil {
		return nil
	}
	return &h
}

func runExistsForPeriod(ctx context.Context, q database.Querier, month, year int) bool {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM hris.payroll_runs WHERE period_month = $1 AND period_year = $2 LIMIT 1`, month, year).Scan(&id)
	return err == nil
}

func insertRun(ctx context.Context, q database.Querier, name string, month, year int, processedBy *string) (*obj, error) {
	return queryObj(ctx, q, `INSERT INTO hris.payroll_runs (run_name, period_month, period_year, status, processed_by)
		VALUES ($1, $2, $3, 'draft', $4) RETURNING *`, name, month, year, processedBy)
}

// runPatch is the column set of updateRun (only the keys that are set).
type runPatch struct {
	cols []string
	args []any
}

func (p *runPatch) set(col string, v any) {
	p.cols = append(p.cols, col)
	p.args = append(p.args, v)
}

func updateRunRow(ctx context.Context, q database.Querier, id string, p runPatch) (*obj, error) {
	sets := make([]string, len(p.cols))
	for i, c := range p.cols {
		sets[i] = c + " = $" + itoa(i+1)
	}
	args := append(p.args, id)
	return queryObj(ctx, q, `UPDATE hris.payroll_runs SET `+strings.Join(sets, ", ")+
		` WHERE id = $`+itoa(len(args))+` RETURNING *`, args...)
}

// markPaid flips a completed run to paid; false when it was not completed.
func markPaid(ctx context.Context, q database.Querier, id string, notes *string) (*paidRun, error) {
	var p paidRun
	err := q.QueryRow(ctx, `UPDATE hris.payroll_runs
		SET status = 'paid', paid_at = now(), updated_at = now(), notes = COALESCE($2, notes)
		WHERE id = $1 AND status = 'completed'
		RETURNING id::text, period_month, period_year, paid_at, total_employees,
		          total_gross::text, total_deductions::text, total_net::text, total_pph21::text,
		          total_bjtk_employee::text, total_bjtk_employer::text`, id, notes).
		Scan(&p.ID, &p.PeriodMonth, &p.PeriodYear, &p.PaidAt, &p.TotalEmployees,
			&p.TotalGross, &p.TotalDeductions, &p.TotalNet, &p.TotalPph21, &p.TotalBjtkEmployee, &p.TotalBjtkEmployer)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &p, err
}

type paidRun struct {
	ID                                   string
	PeriodMonth, PeriodYear              int
	PaidAt                               time.Time
	TotalEmployees                       *int
	TotalGross, TotalDeductions          *string
	TotalNet, TotalPph21                 *string
	TotalBjtkEmployee, TotalBjtkEmployer *string
}

type loanDeduction struct {
	EmployeeID string
	Amount     string
}

func runLoanDeductions(ctx context.Context, q database.Querier, runID string) ([]loanDeduction, error) {
	rows, err := q.Query(ctx, `SELECT employee_id::text, loan_deduction::text FROM hris.payroll_details
		WHERE payroll_run_id = $1 AND loan_deduction > 0`, runID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (loanDeduction, error) {
		var d loanDeduction
		return d, r.Scan(&d.EmployeeID, &d.Amount)
	})
}

const loanColumns = `id::text, loan_type, principal_amount::text, tenor_months, monthly_installment::text,
	remaining_balance::text, first_installment_month, first_installment_year, COALESCE(status, ''), COALESCE(is_active, false)`

func scanLoan(r pgx.CollectableRow) (domain.LoanRow, error) {
	var l domain.LoanRow
	var principal, installment, remaining *string
	err := r.Scan(&l.ID, &l.LoanType, &principal, &l.TenorMonths, &installment, &remaining,
		&l.FirstInstallmentMonth, &l.FirstInstallmentYear, &l.Status, &l.IsActive)
	l.PrincipalAmount, l.MonthlyInstallment, l.RemainingBalance = textOrNil(principal), textOrNil(installment), textOrNil(remaining)
	return l, err
}

func textOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

// lockDueLoans locks the employee's open approved loans, oldest first.
func lockDueLoans(ctx context.Context, q database.Querier, employeeID string) ([]domain.LoanRow, error) {
	rows, err := q.Query(ctx, `SELECT `+loanColumns+` FROM hris.loans
		WHERE employee_id = $1 AND status = 'approved' AND is_active = true AND remaining_balance > 0
		ORDER BY approved_at ASC NULLS LAST, created_at ASC
		FOR UPDATE`, employeeID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanLoan)
}

// openLoans are the loans a payroll calculation deducts from.
func openLoans(ctx context.Context, q database.Querier, employeeID string) ([]domain.LoanRow, error) {
	rows, err := q.Query(ctx, `SELECT `+loanColumns+` FROM hris.loans
		WHERE employee_id = $1 AND status = 'approved' AND is_active = true AND remaining_balance > 0`, employeeID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanLoan)
}

func applyLoanAllocation(ctx context.Context, q database.Querier, a domain.LoanAllocation) error {
	_, err := q.Exec(ctx, `UPDATE hris.loans
		SET remaining_balance = $2::numeric,
		    paid_amount = COALESCE(paid_amount, 0) + $3::numeric,
		    is_active = CASE WHEN $2::numeric <= 0 THEN false ELSE is_active END,
		    status = CASE WHEN $2::numeric <= 0 THEN 'paid_off' ELSE status END,
		    updated_at = now()
		WHERE id = $1`, a.LoanID, numParam(a.NewRemaining), numParam(a.Amount))
	return err
}

func deleteRunRow(ctx context.Context, q database.Querier, id string) error {
	_, err := q.Exec(ctx, `DELETE FROM hris.payroll_runs WHERE id = $1`, id)
	return err
}

/* ── calculation ────────────────────────────────────────────────────── */

// payrollConfigRows reads the first payroll_settings row and the active
// tax config of the year (nil when absent).
func payrollConfigRows(ctx context.Context, q database.Querier, taxYear int) (domain.Row, domain.Row, error) {
	settings, err := queryObj(ctx, q, `SELECT * FROM hris.payroll_settings ORDER BY created_at ASC LIMIT 1`)
	if err != nil {
		return nil, nil, err
	}
	tax, err := queryObj(ctx, q, `SELECT * FROM hris.payroll_tax_config WHERE tax_year = $1 AND is_active = true`, taxYear)
	if err != nil {
		return nil, nil, err
	}
	return settings.Row(), tax.Row(), nil
}

func deleteRunDetails(ctx context.Context, q database.Querier, runID string) error {
	_, err := q.Exec(ctx, `DELETE FROM hris.payroll_details WHERE payroll_run_id = $1`, runID)
	return err
}

// activeSalary is the newest active salary version, nil when none.
func activeSalary(ctx context.Context, q database.Querier, employeeID string) (*domain.Salary, error) {
	var s domain.Salary
	var base, fixed, variable, transport, meal, housing *string
	err := q.QueryRow(ctx, `SELECT base_salary::text, fixed_allowance::text, variable_allowance::text,
		       transport_allowance::text, meal_allowance::text, housing_allowance::text,
		       ptkp_status, is_taxable, bpjs_tk_enrolled, bpjs_kes_enrolled, tapera_enrolled
		  FROM hris.employee_salary WHERE employee_id = $1 AND is_active = true
		 ORDER BY effective_date DESC LIMIT 1`, employeeID).
		Scan(&base, &fixed, &variable, &transport, &meal, &housing,
			&s.PTKPStatus, &s.IsTaxable, &s.BpjsTkEnrolled, &s.BpjsKesEnrolled, &s.TaperaEnrl)
	if database.IsNoRows(err) {
		return nil, nil
	}
	s.BaseSalary, s.FixedAllowance, s.VariableAllowance = textOrNil(base), textOrNil(fixed), textOrNil(variable)
	s.TransportAllowance, s.MealAllowance, s.HousingAllowance = textOrNil(transport), textOrNil(meal), textOrNil(housing)
	return &s, err
}

// insertDetail stores one calculated payslip and returns the stored row.
func insertDetail(ctx context.Context, q database.Querier, runID, employeeID string, r domain.Result, in domain.Input) (*obj, error) {
	breakdown := in.LoanBreakdown
	if breakdown == nil {
		breakdown = []domain.LoanInstallmentDetail{}
	}
	loanDetails, err := json.Marshal(breakdown)
	if err != nil {
		return nil, err
	}
	factor := 1.0
	if in.ProrateFactor != nil {
		factor = *in.ProrateFactor
	}
	n := numParam
	return queryObj(ctx, q, `INSERT INTO hris.payroll_details (
		payroll_run_id, employee_id, base_salary, fixed_allowance, variable_allowance, transport_allowance,
		meal_allowance, housing_allowance, overtime_pay, thr, bonus, other_earning, gross_salary,
		bpjs_tk_jht_deduction, bpjs_tk_jp_deduction, bpjs_kes_deduction, tapera_deduction, pph21_deduction,
		unpaid_leave_deduction, late_deduction, loan_deduction, loan_details, other_deduction, total_deductions,
		net_salary, bpjs_tk_jht_employer, bpjs_tk_jp_employer, bpjs_tk_jkk_employer, bpjs_tk_jkm_employer,
		bpjs_kes_employer, tapera_employer, taxable_income, ptkp_amount, pph21_annual, pph21_monthly,
		working_days, present_days, late_days, unpaid_leave_days, overtime_hours, prorate_factor,
		full_base_salary, status)
	VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,$25,
	        $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,'calculated')
	RETURNING *`,
		runID, employeeID, n(r.BaseSalary), n(r.FixedAllowance), n(r.VariableAllowance), n(r.TransportAllowance),
		n(r.MealAllowance), n(r.HousingAllowance), n(r.OvertimePay), n(r.Thr), n(r.Bonus), n(r.OtherEarning), n(r.GrossSalary),
		n(r.BpjsTkJhtDeduction), n(r.BpjsTkJpDeduction), n(r.BpjsKesDeduction), n(r.TaperaDeduction), n(r.Pph21Deduction),
		n(r.UnpaidLeaveDeduction), n(r.LateDeduction), n(r.LoanDeduction), string(loanDetails), n(r.OtherDeduction), n(r.TotalDeductions),
		n(r.NetSalary), n(r.BpjsTkJhtEmployer), n(r.BpjsTkJpEmployer), n(r.BpjsTkJkkEmployer), n(r.BpjsTkJkmEmployer),
		n(r.BpjsKesEmployer), n(r.TaperaEmployer), n(r.TaxableIncome), n(r.PTKPAmount), n(r.Pph21Annual), n(r.Pph21Monthly),
		n(in.WorkingDays), n(in.PresentDays), n(in.LateDays), n(in.UnpaidLeaveDays),
		n(in.OvertimeHours+in.OvertimeHolidayHrs), n(factor), n(in.BaseSalary))
}

func updateRunTotals(ctx context.Context, q database.Querier, runID string, count int, t domain.RunTotals, now time.Time) error {
	_, err := q.Exec(ctx, `UPDATE hris.payroll_runs SET total_employees = $2, total_gross = $3, total_deductions = $4,
		total_net = $5, total_bjtk_employee = $6, total_bjtk_employer = $7, total_pph21 = $8, updated_at = $9
		WHERE id = $1`, runID, count, numParam(t.TotalGross), numParam(t.TotalDeductions), numParam(t.TotalNet),
		numParam(t.TotalBjtkEmployee), numParam(t.TotalBjtkEmployer), numParam(t.TotalPph21), now)
	return err
}
