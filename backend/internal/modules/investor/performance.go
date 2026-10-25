package investor

import (
	"context"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	gymdomain "nuhabit/backend/internal/modules/gymdesk/domain"
	"nuhabit/backend/internal/modules/investor/domain"
	"nuhabit/backend/internal/platform/localtime"
)

// Laporan kinerja: one row per month with revenue by stream, the posted
// income statement, member growth and retention, classes and PT sessions.
// Built once per branch, span and day.

const (
	defaultMonths = 12
	maxMonths     = 24
)

// MonthRow is one month of the performance report.
type MonthRow struct {
	Month   string `json:"month"`
	Revenue struct {
		Total   float64            `json:"total"`
		Streams map[string]float64 `json:"streams"`
	} `json:"revenue"`
	// Accounting is nil while no journal is posted for the month.
	Accounting *MonthAccounting `json:"accounting"`
	Members    struct {
		New           int      `json:"new"`
		Active        int      `json:"active"`
		Retained      int      `json:"retained"`
		RetentionRate *float64 `json:"retention_rate"`
	} `json:"members"`
	Classes struct {
		Sessions  int     `json:"sessions"`
		CheckedIn int     `json:"checked_in"`
		AvgFill   float64 `json:"avg_fill"`
	} `json:"classes"`
	PTSessions int `json:"pt_sessions"`
}

// MonthAccounting is the posted income statement of one month.
type MonthAccounting struct {
	Revenue     float64 `json:"revenue"`
	Cogs        float64 `json:"cogs"`
	GrossProfit float64 `json:"gross_profit"`
	// GrossMargin is nil without revenue.
	GrossMargin     *float64 `json:"gross_margin"`
	Expenses        float64  `json:"expenses"`
	OperatingIncome float64  `json:"operating_income"`
	NetIncome       float64  `json:"net_income"`
}

// Performance is GET /api/investor/performance.
type Performance struct {
	Timezone string     `json:"timezone"`
	From     string     `json:"from"`
	To       string     `json:"to"`
	Months   []MonthRow `json:"months"`
}

// Performance builds the monthly report of the last months months for
// branchID (nil for every branch), from cache when built today.
func (s *Service) Performance(ctx context.Context, branchID *string, months int) (*Performance, bool, error) {
	if months <= 0 {
		months = defaultMonths
	}
	months = min(months, maxMonths)
	key := strconv.Itoa(months)
	if branchID != nil {
		key += ":" + *branchID
	}
	day := localtime.DayKey(s.now(), localtime.Jakarta)
	s.mu.Lock()
	c, ok := s.performance[key]
	s.mu.Unlock()
	if ok && c.day == day {
		return c.v, true, nil
	}
	p, err := s.buildPerformance(ctx, branchID, months)
	if err != nil {
		return nil, false, err
	}
	s.mu.Lock()
	s.performance[key] = cached[*Performance]{day: day, v: p}
	s.mu.Unlock()
	return p, false, nil
}

func (s *Service) buildPerformance(ctx context.Context, branchID *string, months int) (*Performance, error) {
	zone, err := localtime.BranchZone(ctx, s.db, branchID)
	if err != nil {
		return nil, err
	}
	from, to := domain.MonthSpan(s.now(), months, zone)
	p := &Performance{Timezone: localtime.Name(zone), From: from.Format(time.DateOnly), To: to.Format(time.DateOnly)}

	daily, err := s.dailyRevenue(ctx, from, to.AddDate(0, 0, 1), zone, branchID)
	if err != nil {
		return nil, err
	}
	companies, err := s.companies(ctx, branchID)
	if err != nil {
		return nil, err
	}
	var income []MonthIncome
	if len(companies) > 0 {
		if income, err = s.ports.Accounting.MonthlyIncome(ctx, companies, p.From, p.To); err != nil {
			return nil, err
		}
	}
	incomeByMonth := map[string]MonthIncome{}
	for _, m := range income {
		incomeByMonth[m.Month] = m
	}

	for start := from; !start.After(to); start = start.AddDate(0, 1, 0) {
		end := start.AddDate(0, 1, 0)
		period := gymdomain.Period{From: start, To: end, Zone: zone}
		row := MonthRow{Month: start.Format("2006-01")}
		row.Revenue.Total, row.Revenue.Streams = daily.Sum(start.Format(time.DateOnly), end.AddDate(0, 0, -1).Format(time.DateOnly))
		if m, ok := incomeByMonth[row.Month]; ok && (m.Revenue != 0 || m.Cogs != 0 || m.Expenses != 0 || m.OtherIncome != 0 || m.OtherExpenses != 0) {
			a := &MonthAccounting{Revenue: m.Revenue, Cogs: m.Cogs, Expenses: m.Expenses}
			a.GrossProfit = m.Revenue - m.Cogs
			if m.Revenue != 0 {
				margin := a.GrossProfit / m.Revenue
				a.GrossMargin = &margin
			}
			a.OperatingIncome = a.GrossProfit - m.Expenses
			a.NetIncome = a.OperatingIncome + m.OtherIncome - m.OtherExpenses
			row.Accounting = a
		}
		members, err := s.ports.Gym.MemberStats(ctx, period, branchID)
		if err != nil {
			return nil, err
		}
		row.Members.New, row.Members.Active = members.New, members.Active
		row.Members.Retained = members.PreviousActive - members.Churned
		if members.PreviousActive > 0 {
			rate := domain.Rate(float64(row.Members.Retained), float64(members.PreviousActive))
			row.Members.RetentionRate = &rate
		}
		classes, err := s.ports.Gym.ClassReport(ctx, period, branchID)
		if err != nil {
			return nil, err
		}
		row.Classes.Sessions, row.Classes.CheckedIn, row.Classes.AvgFill = classes.Totals.Sessions, classes.Totals.CheckedIn, classes.Totals.AvgFill
		if row.PTSessions, err = s.ptSessions(ctx, start, end, branchID); err != nil {
			return nil, err
		}
		p.Months = append(p.Months, row)
	}
	return p, nil
}

// companies are the companies whose journals the report reads: the
// branch's company, or every active company.
func (s *Service) companies(ctx context.Context, branchID *string) ([]string, error) {
	rows, err := s.db.Query(ctx, `
		SELECT c.id::text FROM configuration.companies c
		 WHERE c.is_active = true
		   AND ($1::uuid IS NULL OR c.id = (SELECT company_id FROM configuration.branches WHERE id = $1))
		 ORDER BY c.id`, branchID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
