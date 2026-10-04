// Package payroll holds the events the payroll module publishes.
package payroll

import "time"

// TopicRunPaid fires when a payroll run is marked paid, in the transaction
// that set the run to paid and settled the loan installments on its slips.
// Accounting posts the payroll journals from it per company in Companies
// (PAYROLL_ACCRUAL from gross, PAYROLL_PPH21_WITHHOLDING from PPh 21,
// PAYROLL_LOAN_DEDUCTION from the settled installments, PAYROLL_PAYMENT from
// net, PAYROLL_BPJS_TK_EMPLOYER and PAYROLL_BPJS_KES_EMPLOYER from the
// employer BPJS shares), dated PaidAt in Asia/Jakarta. An event without
// Companies posts the run totals to the one company with ready mappings.
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
	// UserID is the staff user who marked the run paid (journal created_by).
	UserID string `json:"user_id"`
	// TotalBpjsTkEmployer is the employer BPJS Ketenagakerjaan share (JHT,
	// JP, JKK, JKM) and TotalBpjsKesEmployer the employer BPJS Kesehatan
	// share, in rupiah.
	TotalBpjsTkEmployer  float64 `json:"total_bpjs_tk_employer"`
	TotalBpjsKesEmployer float64 `json:"total_bpjs_kes_employer"`
	// Companies splits the run by the company of each employee's account
	// (the user's company, else its branch's company).
	Companies []RunCompany `json:"companies,omitempty"`
}

// RunCompany is one company's share of a paid run, in rupiah. CompanyID is
// nil for the employees without a company.
type RunCompany struct {
	CompanyID            *string `json:"company_id"`
	TotalGross           float64 `json:"total_gross"`
	TotalNet             float64 `json:"total_net"`
	TotalPph21           float64 `json:"total_pph21"`
	TotalLoanDeduction   float64 `json:"total_loan_deduction"`
	TotalBpjsTkEmployer  float64 `json:"total_bpjs_tk_employer"`
	TotalBpjsKesEmployer float64 `json:"total_bpjs_kes_employer"`
}
