// Package payroll holds the events the payroll module publishes.
package payroll

import "time"

// TopicRunPaid fires when a payroll run is marked paid, in the transaction
// that set the run to paid and settled the loan installments on its slips.
// Accounting posts the payroll journals from it (PAYROLL_ACCRUAL,
// PAYROLL_PAYMENT, PAYROLL_PPH21_WITHHOLDING, PAYROLL_LOAN_DEDUCTION).
const TopicRunPaid = "payroll.run.paid"

// RunPaid is the TopicRunPaid payload. Amounts are the payroll_runs numeric
// columns as text (exact rupiah with two decimals), nil when the column is NULL.
type RunPaid struct {
	RunID             string    `json:"run_id"`
	PeriodMonth       int       `json:"period_month"`
	PeriodYear        int       `json:"period_year"`
	PaidAt            time.Time `json:"paid_at"`
	TotalEmployees    *int      `json:"total_employees"`
	TotalGross        *string   `json:"total_gross"`
	TotalDeductions   *string   `json:"total_deductions"`
	TotalNet          *string   `json:"total_net"`
	TotalPph21        *string   `json:"total_pph21"`
	TotalBjtkEmployee *string   `json:"total_bjtk_employee"`
	TotalBjtkEmployer *string   `json:"total_bjtk_employer"`
	// TotalLoanDeduction is the installments settled against hris.loans (rupiah).
	TotalLoanDeduction float64 `json:"total_loan_deduction"`
	// SettledLoans counts the loan rows the settlement touched.
	SettledLoans int `json:"settled_loans"`
}
