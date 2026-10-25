package investor

import (
	"context"

	gymdomain "nuhabit/backend/internal/modules/gymdesk/domain"
)

// Ports are what the investor portal reads from other contexts. The gym
// figures come from gym-desk's report queries, the monthly income statement
// from accounting; internal/app adapts both.
type Ports struct {
	Gym        GymReports
	Accounting Accounting
	// Mailer sends the daily digest; nil or unconfigured means no mail.
	Mailer Mailer
}

// MemberStats are the member counts of a period, without names.
type MemberStats struct {
	New            int
	Active         int
	PreviousActive int
	Churned        int
	ChurnRate      float64
}

// GymReports reads gym-desk's class, revenue and member roll-ups.
type GymReports interface {
	ClassReport(ctx context.Context, p gymdomain.Period, branchID *string) (gymdomain.ClassReport, error)
	MemberStats(ctx context.Context, p gymdomain.Period, branchID *string) (MemberStats, error)
}

// MonthIncome is one month of a company's posted income statement.
type MonthIncome struct {
	Month                      string
	Revenue, Cogs, Expenses    float64
	OtherIncome, OtherExpenses float64
}

// Accounting reads the posted journals per month.
type Accounting interface {
	// MonthlyIncome is one row per month from dateFrom to dateTo
	// (YYYY-MM-DD, inclusive) over companyIDs.
	MonthlyIncome(ctx context.Context, companyIDs []string, dateFrom, dateTo string) ([]MonthIncome, error)
}

// Mailer sends one HTML email; Send reports success.
type Mailer interface {
	Configured() bool
	Send(ctx context.Context, to, subject, html string) bool
}
