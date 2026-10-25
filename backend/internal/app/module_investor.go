package app

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/accounting"
	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/gymdesk"
	gymdomain "nuhabit/backend/internal/modules/gymdesk/domain"
	"nuhabit/backend/internal/modules/investor"
	"nuhabit/backend/internal/platform/module"
)

// investor: the investor portal (read-only revenue, performance, progress
// and documents), the directors' update editor and the daily digest mail.
func init() {
	Register(investor.Name, func(d module.Deps) module.Module { return investor.New(d, InvestorPorts(d)) })
	RegisterJob(investor.Name, "investor.daily-digest", 10*time.Minute, investorService, (*investor.Service).SendDailyDigest)
}

func investorService(d module.Deps) *investor.Service {
	return investor.NewService(d.DB, InvestorPorts(d), d.Now, d.Log)
}

// InvestorPorts reads the gym figures through gym-desk's report service
// and the monthly income statement through accounting. The module's
// integration tests use it too.
func InvestorPorts(d module.Deps) investor.Ports {
	gym := gymdesk.NewService(d.DB, gymdesk.Ports{Credits: gymDeskCredits{svc: gymcredits.NewDefaultService(d, d.DB)}}, d.Now)
	return investor.Ports{
		Gym:        investorGym{svc: gym},
		Accounting: investorAccounting{svc: accounting.NewService(d.DB, AccountingPorts(d), d.Log, d.Now)},
		Mailer: investorMail{
			mail: &resendMailer{apiKey: strings.TrimSpace(os.Getenv("RESEND_API_KEY")), log: d.Log, client: &http.Client{Timeout: 15 * time.Second}},
			from: strings.TrimSpace(firstNonEmptyStr(os.Getenv("INVESTOR_FROM_EMAIL"), os.Getenv("FROM_EMAIL"))),
		},
	}
}

type investorGym struct{ svc *gymdesk.Service }

var _ investor.GymReports = investorGym{}

func (a investorGym) ClassReport(ctx context.Context, p gymdomain.Period, branchID *string) (gymdomain.ClassReport, error) {
	return a.svc.ClassReport(ctx, p, branchID)
}

func (a investorGym) MemberStats(ctx context.Context, p gymdomain.Period, branchID *string) (investor.MemberStats, error) {
	m, err := a.svc.MemberStats(ctx, p, branchID)
	return investor.MemberStats{New: m.New, Active: m.Active, PreviousActive: m.PreviousActive, Churned: m.Churned, ChurnRate: m.ChurnRate}, err
}

type investorAccounting struct{ svc *accounting.Service }

var _ investor.Accounting = investorAccounting{}

func (a investorAccounting) MonthlyIncome(ctx context.Context, companyIDs []string, dateFrom, dateTo string) ([]investor.MonthIncome, error) {
	rows, err := a.svc.MonthlyIncome(ctx, companyIDs, dateFrom, dateTo)
	out := make([]investor.MonthIncome, len(rows))
	for i, r := range rows {
		out[i] = investor.MonthIncome{Month: r.Month, Revenue: r.Revenue, Cogs: r.Cogs, Expenses: r.Expenses,
			OtherIncome: r.OtherIncome, OtherExpenses: r.OtherExpenses}
	}
	return out, err
}

// investorMail sends the digest through Resend when RESEND_API_KEY and a
// sender (INVESTOR_FROM_EMAIL or FROM_EMAIL) are set.
type investorMail struct {
	mail *resendMailer
	from string
}

func (m investorMail) Configured() bool { return m.mail.apiKey != "" && m.from != "" }

func (m investorMail) Send(ctx context.Context, to, subject, html string) bool {
	return m.mail.Send(ctx, to, m.from, subject, html)
}
