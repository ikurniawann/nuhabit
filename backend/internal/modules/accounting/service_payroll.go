package accounting

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/payroll"
	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
)

// payrollJournals are the journals a paid run posts per company, in order,
// with the amount source each mapping's seeded lines read.
var payrollJournals = []struct {
	event, source, label string
	amount               func(payroll.RunCompany) float64
}{
	{"PAYROLL_ACCRUAL", "TOTAL", "beban gaji", func(r payroll.RunCompany) float64 { return r.TotalGross }},
	{"PAYROLL_PPH21_WITHHOLDING", "TAX", "potongan PPh 21", func(r payroll.RunCompany) float64 { return r.TotalPph21 }},
	{"PAYROLL_LOAN_DEDUCTION", "PAID", "potongan cicilan pinjaman", func(r payroll.RunCompany) float64 { return r.TotalLoanDeduction }},
	{"PAYROLL_BPJS_TK_EMPLOYEE", "TOTAL", "potongan BPJS Ketenagakerjaan karyawan", func(r payroll.RunCompany) float64 { return r.TotalBpjsTkEmployee }},
	{"PAYROLL_BPJS_KES_EMPLOYEE", "TOTAL", "potongan BPJS Kesehatan karyawan", func(r payroll.RunCompany) float64 { return r.TotalBpjsKesEmployee }},
	{"PAYROLL_TAPERA_EMPLOYEE", "TOTAL", "potongan Tapera karyawan", func(r payroll.RunCompany) float64 { return r.TotalTaperaEmployee }},
	{"PAYROLL_PAYMENT", "PAID", "pembayaran gaji bersih", func(r payroll.RunCompany) float64 { return r.TotalNet }},
	{"PAYROLL_BPJS_TK_EMPLOYER", "TOTAL", "BPJS Ketenagakerjaan pemberi kerja", func(r payroll.RunCompany) float64 { return r.TotalBpjsTkEmployer }},
	{"PAYROLL_BPJS_KES_EMPLOYER", "TOTAL", "BPJS Kesehatan pemberi kerja", func(r payroll.RunCompany) float64 { return r.TotalBpjsKesEmployer }},
	{"PAYROLL_TAPERA_EMPLOYER", "TOTAL", "Tapera pemberi kerja", func(r payroll.RunCompany) float64 { return r.TotalTaperaEmployer }},
}

func numeric(s *string) float64 {
	if s == nil {
		return 0
	}
	return domain.ToNumber(*s)
}

// payrollCompany is where the employees without a company post: the one
// company whose payroll mappings are active and have every required account
// (or the global template); ok is false when none or several qualify.
func payrollCompany(ctx context.Context, q database.Querier) (company *string, ok bool, err error) {
	events := make([]string, len(payrollJournals))
	for i, j := range payrollJournals {
		events[i] = j.event
	}
	companies, err := collect[struct{ ID *string }](ctx, q, `
SELECT DISTINCT m.company_id::text
  FROM accounting.journal_mappings m
 WHERE m.deleted_at IS NULL
   AND m.is_active = true
   AND m.event_code = ANY($1)
   AND EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l WHERE l.mapping_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM accounting.journal_mapping_lines l
                    WHERE l.mapping_id = m.id AND l.is_required AND l.account_id IS NULL)`, events)
	if err != nil {
		return nil, false, err
	}
	global := false
	for _, c := range companies {
		switch {
		case c.ID == nil:
			global = true
		case company != nil:
			return nil, false, nil
		default:
			company = c.ID
		}
	}
	return company, company != nil || global, nil
}

// PostPayrollRun posts the journals of a paid payroll run per company,
// dated the day it was paid (Asia/Jakarta), keyed by the run id so a repeat
// is a no-op. They post together: when one fails (a closed period) none is
// kept. An event without a company split posts its run totals as one group.
func (s *Service) PostPayrollRun(ctx context.Context, db database.DB, in payroll.RunPaid) ([]domain.PostResult, error) {
	groups, skipped, err := payrollGroups(ctx, db, in)
	if err != nil {
		return nil, err
	}
	results := skipped
	date := in.PaidAt.In(jakarta).Format(time.DateOnly)
	period := fmt.Sprintf("%02d/%d", in.PeriodMonth, in.PeriodYear)
	err = database.WithTx(ctx, db, func(tx pgx.Tx) error {
		for _, g := range groups {
			for _, j := range payrollJournals {
				amount := domain.Round2(j.amount(g))
				if amount <= 0 {
					continue
				}
				r, err := PostFromMapping(ctx, tx, MappingPost{CompanyID: g.CompanyID, UserID: in.UserID, EventCode: j.event,
					DocumentType: "payroll_run", DocumentID: in.RunID, EntryDate: date, Amounts: domain.Amounts{j.source: amount},
					Description: "Payroll " + period + " — " + j.label, SourceModule: "PAYROLL"})
				if err != nil {
					return err
				}
				results = append(results, r)
			}
		}
		return nil
	})
	return results, err
}

// payrollGroups resolves the company of each group of a paid run and merges
// groups that land on the same company, since a journal posts once per
// company and run. The employees without a company go to payrollCompany;
// when it finds none, their share is skipped with the reason.
func payrollGroups(ctx context.Context, q database.Querier, in payroll.RunPaid) ([]payroll.RunCompany, []domain.PostResult, error) {
	groups := in.Companies
	if len(groups) == 0 {
		groups = []payroll.RunCompany{{TotalGross: numeric(in.TotalGross), TotalNet: numeric(in.TotalNet),
			TotalPph21: numeric(in.TotalPph21), TotalLoanDeduction: in.TotalLoanDeduction,
			TotalBpjsTkEmployer: in.TotalBpjsTkEmployer, TotalBpjsKesEmployer: in.TotalBpjsKesEmployer,
			TotalBpjsTkEmployee: in.TotalBpjsTkEmployee, TotalBpjsKesEmployee: in.TotalBpjsKesEmployee,
			TotalTaperaEmployer: in.TotalTaperaEmployer, TotalTaperaEmployee: in.TotalTaperaEmployee}}
	}
	var merged []payroll.RunCompany
	var skipped []domain.PostResult
	for _, g := range groups {
		if g.CompanyID == nil {
			company, ok, err := payrollCompany(ctx, q)
			if err != nil {
				return nil, nil, err
			}
			if !ok {
				skipped = append(skipped, domain.PostResult{Status: domain.PostSkipped, Reason: "Journal mapping payroll belum siap di tepat satu company"})
				continue
			}
			g.CompanyID = company
		}
		i := slices.IndexFunc(merged, func(m payroll.RunCompany) bool { return sameCompany(m.CompanyID, g.CompanyID) })
		if i < 0 {
			merged = append(merged, g)
			continue
		}
		m := &merged[i]
		m.TotalGross += g.TotalGross
		m.TotalNet += g.TotalNet
		m.TotalPph21 += g.TotalPph21
		m.TotalLoanDeduction += g.TotalLoanDeduction
		m.TotalBpjsTkEmployer += g.TotalBpjsTkEmployer
		m.TotalBpjsKesEmployer += g.TotalBpjsKesEmployer
		m.TotalBpjsTkEmployee += g.TotalBpjsTkEmployee
		m.TotalBpjsKesEmployee += g.TotalBpjsKesEmployee
		m.TotalTaperaEmployer += g.TotalTaperaEmployer
		m.TotalTaperaEmployee += g.TotalTaperaEmployee
	}
	return merged, skipped, nil
}

func sameCompany(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}
