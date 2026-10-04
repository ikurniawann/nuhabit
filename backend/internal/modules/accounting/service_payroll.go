package accounting

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/payroll"
	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
)

// payrollJournals are the journals a paid run posts, in order, with the
// amount source each mapping's seeded lines read.
var payrollJournals = []struct {
	event, source, label string
	amount               func(payroll.RunPaid) float64
}{
	{"PAYROLL_ACCRUAL", "TOTAL", "beban gaji", func(r payroll.RunPaid) float64 { return numeric(r.TotalGross) }},
	{"PAYROLL_PPH21_WITHHOLDING", "TAX", "potongan PPh 21", func(r payroll.RunPaid) float64 { return numeric(r.TotalPph21) }},
	{"PAYROLL_LOAN_DEDUCTION", "PAID", "potongan cicilan pinjaman", func(r payroll.RunPaid) float64 { return r.TotalLoanDeduction }},
	{"PAYROLL_PAYMENT", "PAID", "pembayaran gaji bersih", func(r payroll.RunPaid) float64 { return numeric(r.TotalNet) }},
}

func numeric(s *string) float64 {
	if s == nil {
		return 0
	}
	return domain.ToNumber(*s)
}

// payrollCompany is the company payroll journals post to. Payroll runs have
// no company, so it is the one company whose payroll mappings are active and
// have every required account; ok is false when none or several qualify.
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

// PostPayrollRun posts the journals of a paid payroll run, dated the day it
// was paid (Asia/Jakarta), keyed by the run id so a repeat is a no-op. They
// post together: when one fails (a closed period) none is kept.
func (s *Service) PostPayrollRun(ctx context.Context, db database.DB, in payroll.RunPaid) ([]domain.PostResult, error) {
	company, ok, err := payrollCompany(ctx, db)
	if err != nil {
		return nil, err
	}
	if !ok {
		return []domain.PostResult{{Status: domain.PostSkipped, Reason: "Journal mapping payroll belum siap di tepat satu company"}}, nil
	}
	date := in.PaidAt.In(jakarta).Format(time.DateOnly)
	period := fmt.Sprintf("%02d/%d", in.PeriodMonth, in.PeriodYear)
	var results []domain.PostResult
	err = database.WithTx(ctx, db, func(tx pgx.Tx) error {
		for _, j := range payrollJournals {
			amount := j.amount(in)
			if amount <= 0 {
				continue
			}
			r, err := PostFromMapping(ctx, tx, MappingPost{CompanyID: company, UserID: in.UserID, EventCode: j.event,
				DocumentType: "payroll_run", DocumentID: in.RunID, EntryDate: date, Amounts: domain.Amounts{j.source: amount},
				Description: "Payroll " + period + " — " + j.label, SourceModule: "PAYROLL"})
			if err != nil {
				return err
			}
			results = append(results, r)
		}
		return nil
	})
	return results, err
}
