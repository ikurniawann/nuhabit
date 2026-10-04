package accounting

import (
	"context"
	"math"
	"strings"

	"nuhabit/backend/internal/modules/accounting/domain"
)

// Financial reports and the accounting dashboard (reports-store.ts,
// dashboard-store.ts). Amounts are posted journal lines of active postable
// accounts; numbers come back as JavaScript numbers rounded to cents.

// AccountBalance is ReportAccountBalance.
type AccountBalance struct {
	ID               string  `json:"id"`
	Code             string  `json:"code"`
	CodeDisplay      string  `json:"code_display"`
	Name             string  `json:"name"`
	AccountTypeCode  string  `json:"account_type_code"`
	NormalBalance    string  `json:"normal_balance"`
	IsContra         bool    `json:"is_contra"`
	IsCashBank       bool    `json:"is_cash_bank"`
	CashFlowCategory *string `json:"cash_flow_category"`
	Level            int     `json:"level"`
	Debit            float64 `json:"debit"`
	Credit           float64 `json:"credit"`
	Balance          float64 `json:"balance"`
}

type balanceWindow struct{ asOf, dateFrom, dateTo string }

// balances is loadPostableBalances.
func (s *Service) balances(ctx context.Context, companyID string, w balanceWindow) ([]AccountBalance, error) {
	args := []any{companyID}
	clauses := []string{"e.deleted_at IS NULL", "e.status = 'POSTED'", "e.company_id = $1::uuid"}
	for _, c := range []struct{ v, op string }{{w.asOf, "<="}, {w.dateFrom, ">="}, {w.dateTo, "<="}} {
		if c.v != "" {
			args = append(args, c.v)
			clauses = append(clauses, "e.entry_date "+c.op+" $"+itoa(len(args))+"::date")
		}
	}
	rows, err := collect[struct {
		ID, Code, Name, TypeCode, Normal string
		IsContra, IsCashBank             bool
		CashFlow                         *string
		Level                            int
		Debit, Credit                    string
	}](ctx, s.db, `
SELECT coa.id::text, coa.code, coa.name, t.code, t.normal_balance, coa.is_contra, coa.is_cash_bank,
       coa.cash_flow_category, coa.level,
       COALESCE(SUM(mov.debit), 0)::text, COALESCE(SUM(mov.credit), 0)::text
  FROM accounting.chart_of_accounts coa
  JOIN accounting.account_types t ON t.id = coa.account_type_id
  LEFT JOIN (
    SELECT l.account_id,
           CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END AS debit,
           CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END AS credit
      FROM accounting.journal_entry_lines l
      JOIN accounting.journal_entries e ON e.id = l.entry_id
     WHERE `+strings.Join(clauses, " AND ")+`
  ) mov ON mov.account_id = coa.id
 WHERE coa.deleted_at IS NULL AND coa.is_active = true AND coa.is_postable = true AND coa.company_id = $1::uuid
 GROUP BY coa.id, coa.code, coa.name, t.code, t.normal_balance, coa.is_contra, coa.is_cash_bank, coa.cash_flow_category, coa.level
 ORDER BY coa.code ASC`, args...)
	if err != nil {
		return nil, err
	}
	out := make([]AccountBalance, len(rows))
	for i, r := range rows {
		normal := domain.AsNormal(r.Normal)
		debit, credit := domain.ParseNumber(r.Debit), domain.ParseNumber(r.Credit)
		cf := r.CashFlow
		if cf != nil && *cf == "" {
			cf = nil
		}
		out[i] = AccountBalance{ID: r.ID, Code: r.Code, CodeDisplay: domain.FormatAccountCodeDisplay(r.Code), Name: r.Name,
			AccountTypeCode: r.TypeCode, NormalBalance: normal, IsContra: r.IsContra, IsCashBank: r.IsCashBank,
			CashFlowCategory: cf, Level: r.Level, Debit: domain.Round2(debit), Credit: domain.Round2(credit),
			Balance: domain.Balance(debit, credit, normal, r.IsContra)}
	}
	return out, nil
}

func filterType(rows []AccountBalance, code string) []AccountBalance {
	out := []AccountBalance{}
	for _, r := range rows {
		if r.AccountTypeCode == code {
			out = append(out, r)
		}
	}
	return out
}

func sumBalance(rows []AccountBalance) float64 {
	s := 0.0
	for _, r := range rows {
		s += r.Balance
	}
	return s
}

// TrialBalance is TrialBalanceReport.
type TrialBalance struct {
	AsOf        string           `json:"as_of"`
	Rows        []AccountBalance `json:"rows"`
	TotalDebit  float64          `json:"total_debit"`
	TotalCredit float64          `json:"total_credit"`
}

// TrialBalance is getTrialBalanceReport.
func (s *Service) TrialBalance(ctx context.Context, companyID, asOf string) (*TrialBalance, error) {
	rows, err := s.balances(ctx, companyID, balanceWindow{asOf: asOf})
	if err != nil {
		return nil, err
	}
	var d, c float64
	for i := range rows {
		rows[i].Debit, rows[i].Credit = domain.TrialBalanceColumns(rows[i].Debit, rows[i].Credit)
		d += rows[i].Debit
		c += rows[i].Credit
	}
	return &TrialBalance{AsOf: asOf, Rows: rows, TotalDebit: domain.Round2(d), TotalCredit: domain.Round2(c)}, nil
}

// BalanceSheet is BalanceSheetReport.
type BalanceSheet struct {
	AsOf                      string           `json:"as_of"`
	Assets                    []AccountBalance `json:"assets"`
	Liabilities               []AccountBalance `json:"liabilities"`
	Equity                    []AccountBalance `json:"equity"`
	CurrentYearEarnings       float64          `json:"current_year_earnings"`
	TotalAssets               float64          `json:"total_assets"`
	TotalLiabilities          float64          `json:"total_liabilities"`
	TotalEquity               float64          `json:"total_equity"`
	TotalLiabilitiesAndEquity float64          `json:"total_liabilities_and_equity"`
}

// BalanceSheet is getBalanceSheetReport; current-year earnings run from the
// covering fiscal year's start (else 1 January).
func (s *Service) BalanceSheet(ctx context.Context, companyID, asOf string) (*BalanceSheet, error) {
	all, err := s.balances(ctx, companyID, balanceWindow{asOf: asOf})
	if err != nil {
		return nil, err
	}
	fyStart, found, err := scalar[string](ctx, s.db, `
SELECT start_date::text FROM accounting.fiscal_years
 WHERE deleted_at IS NULL AND company_id = $1::uuid AND start_date <= $2::date AND end_date >= $2::date
 ORDER BY start_date DESC LIMIT 1`, companyID, asOf)
	if err != nil {
		return nil, err
	}
	if !found || fyStart == "" {
		fyStart = jsSlice(asOf, 4) + "-01-01"
	}
	pl, err := s.balances(ctx, companyID, balanceWindow{dateFrom: fyStart, dateTo: asOf})
	if err != nil {
		return nil, err
	}
	earnings := 0.0
	for _, b := range pl {
		if domain.IsProfitLossType(b.AccountTypeCode) {
			earnings += domain.EarningsContribution(b.AccountTypeCode, b.Balance)
		}
	}
	earnings = domain.Round2(earnings)
	assets, liabilities, equity := filterType(all, "ASSET"), filterType(all, "LIABILITY"), filterType(all, "EQUITY")
	totalLiabilities := domain.Round2(sumBalance(liabilities))
	totalEquity := domain.Round2(sumBalance(equity) + earnings)
	return &BalanceSheet{AsOf: asOf, Assets: assets, Liabilities: liabilities, Equity: equity, CurrentYearEarnings: earnings,
		TotalAssets: domain.Round2(sumBalance(assets)), TotalLiabilities: totalLiabilities, TotalEquity: totalEquity,
		TotalLiabilitiesAndEquity: domain.Round2(totalLiabilities + totalEquity)}, nil
}

// IncomeStatement is IncomeStatementReport.
type IncomeStatement struct {
	DateFrom           string           `json:"date_from"`
	DateTo             string           `json:"date_to"`
	Revenue            []AccountBalance `json:"revenue"`
	Cogs               []AccountBalance `json:"cogs"`
	Expenses           []AccountBalance `json:"expenses"`
	OtherIncome        []AccountBalance `json:"other_income"`
	OtherExpenses      []AccountBalance `json:"other_expenses"`
	TotalRevenue       float64          `json:"total_revenue"`
	TotalCogs          float64          `json:"total_cogs"`
	GrossProfit        float64          `json:"gross_profit"`
	TotalExpenses      float64          `json:"total_expenses"`
	OperatingIncome    float64          `json:"operating_income"`
	TotalOtherIncome   float64          `json:"total_other_income"`
	TotalOtherExpenses float64          `json:"total_other_expenses"`
	NetIncome          float64          `json:"net_income"`
}

// IncomeStatement is getIncomeStatementReport.
func (s *Service) IncomeStatement(ctx context.Context, companyID, dateFrom, dateTo string) (*IncomeStatement, error) {
	all, err := s.balances(ctx, companyID, balanceWindow{dateFrom: dateFrom, dateTo: dateTo})
	if err != nil {
		return nil, err
	}
	r := &IncomeStatement{DateFrom: dateFrom, DateTo: dateTo,
		Revenue: filterType(all, "REVENUE"), Cogs: filterType(all, "COGS"), Expenses: filterType(all, "EXPENSE"),
		OtherIncome: filterType(all, "OTHER_INCOME"), OtherExpenses: filterType(all, "OTHER_EXPENSE")}
	r.TotalRevenue = domain.Round2(sumBalance(r.Revenue))
	r.TotalCogs = domain.Round2(sumBalance(r.Cogs))
	r.GrossProfit = domain.Round2(r.TotalRevenue - r.TotalCogs)
	r.TotalExpenses = domain.Round2(sumBalance(r.Expenses))
	r.OperatingIncome = domain.Round2(r.GrossProfit - r.TotalExpenses)
	r.TotalOtherIncome = domain.Round2(sumBalance(r.OtherIncome))
	r.TotalOtherExpenses = domain.Round2(sumBalance(r.OtherExpenses))
	r.NetIncome = domain.Round2(r.OperatingIncome + r.TotalOtherIncome - r.TotalOtherExpenses)
	return r, nil
}

// CashFlowSection is one cash flow category.
type CashFlowSection struct {
	Category string           `json:"category"`
	Rows     []AccountBalance `json:"rows"`
	Total    float64          `json:"total"`
}

// CashFlow is CashFlowReport.
type CashFlow struct {
	DateFrom      string          `json:"date_from"`
	DateTo        string          `json:"date_to"`
	Operating     CashFlowSection `json:"operating"`
	Investing     CashFlowSection `json:"investing"`
	Financing     CashFlowSection `json:"financing"`
	NonCash       CashFlowSection `json:"non_cash"`
	NetCashChange float64         `json:"net_cash_change"`
	CashOpening   float64         `json:"cash_opening"`
	CashClosing   float64         `json:"cash_closing"`
}

func cashSection(category string, rows []AccountBalance) CashFlowSection {
	out := []AccountBalance{}
	total := 0.0
	for _, r := range rows {
		if r.CashFlowCategory == nil || *r.CashFlowCategory != category {
			continue
		}
		out = append(out, r)
		if !r.IsCashBank {
			total += domain.CashFlowContribution(r.AccountTypeCode, r.Balance)
		}
	}
	return CashFlowSection{Category: category, Rows: out, Total: domain.Round2(total)}
}

func cashTotal(rows []AccountBalance) float64 {
	s := 0.0
	for _, r := range rows {
		if r.IsCashBank {
			s += r.Balance
		}
	}
	return domain.Round2(s)
}

// dayBefore is the TS `new Date(d + "T00:00:00")` minus a day, then
// toISOString().slice(0, 10), on a UTC server: the previous calendar day.
func (s *Service) dayBefore(ctx context.Context, date string) (string, error) {
	d, _, err := scalar[string](ctx, s.db, `SELECT ($1::date - 1)::text`, date)
	return d, err
}

// CashFlow is getCashFlowReport.
func (s *Service) CashFlow(ctx context.Context, companyID, dateFrom, dateTo string) (*CashFlow, error) {
	period, err := s.balances(ctx, companyID, balanceWindow{dateFrom: dateFrom, dateTo: dateTo})
	if err != nil {
		return nil, err
	}
	before, err := s.dayBefore(ctx, dateFrom)
	if err != nil {
		return nil, err
	}
	opening, err := s.balances(ctx, companyID, balanceWindow{asOf: before})
	if err != nil {
		return nil, err
	}
	through, err := s.balances(ctx, companyID, balanceWindow{asOf: dateTo})
	if err != nil {
		return nil, err
	}
	open, closing := cashTotal(opening), cashTotal(through)
	return &CashFlow{DateFrom: dateFrom, DateTo: dateTo,
		Operating: cashSection("OPERATING", period), Investing: cashSection("INVESTING", period),
		Financing: cashSection("FINANCING", period), NonCash: cashSection("NON_CASH", period),
		NetCashChange: domain.Round2(closing - open), CashOpening: open, CashClosing: closing}, nil
}

// GLAccountOption is GeneralLedgerAccountOption.
type GLAccountOption struct {
	ID              string  `json:"id"`
	Code            string  `json:"code"`
	CodeDisplay     string  `json:"code_display"`
	Name            string  `json:"name"`
	AccountTypeCode string  `json:"account_type_code"`
	Balance         float64 `json:"balance"`
}

// GLAccounts is listGeneralLedgerAccounts.
func (s *Service) GLAccounts(ctx context.Context, companyID, asOf string) ([]GLAccountOption, error) {
	rows, err := s.balances(ctx, companyID, balanceWindow{asOf: asOf})
	if err != nil {
		return nil, err
	}
	out := make([]GLAccountOption, len(rows))
	for i, b := range rows {
		out[i] = GLAccountOption{ID: b.ID, Code: b.Code, CodeDisplay: b.CodeDisplay, Name: b.Name, AccountTypeCode: b.AccountTypeCode, Balance: b.Balance}
	}
	return out, nil
}

// GeneralLedger is getGeneralLedgerReport: nil when the account is not a
// live postable account of the company.
func (s *Service) GeneralLedger(ctx context.Context, companyID, accountID string, dateFrom, dateTo *string) (*Ledger, error) {
	acc, err := s.ledgerAccount(ctx, accountID)
	if err != nil {
		return nil, err
	}
	if acc == nil || acc.Deleted || !acc.IsPostable || acc.CompanyID == nil || *acc.CompanyID != companyID {
		return nil, nil
	}
	l, err := s.ledger(ctx, acc, companyID, dateFrom, dateTo, acc.IsContra)
	if err != nil {
		return nil, err
	}
	l.Account.AccountTypeCode = acc.TypeCode
	return l, nil
}

/* ── Dashboard ───────────────────────────────────────────────────────── */

// NameValue is a chart slice.
type NameValue struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}

// MonthTrend is one month of revenue vs expense.
type MonthTrend struct {
	Month   string  `json:"month"`
	Revenue float64 `json:"revenue"`
	Expense float64 `json:"expense"`
	Net     float64 `json:"net"`
}

// TopExpense is one of the largest expense accounts.
type TopExpense struct {
	Code    string  `json:"code"`
	Name    string  `json:"name"`
	Balance float64 `json:"balance"`
}

// DashboardKPIs are the dashboard headline numbers.
type DashboardKPIs struct {
	TotalAssets      float64 `json:"total_assets"`
	TotalLiabilities float64 `json:"total_liabilities"`
	TotalEquity      float64 `json:"total_equity"`
	NetIncome        float64 `json:"net_income"`
	CashBalance      float64 `json:"cash_balance"`
	CashOpening      float64 `json:"cash_opening"`
	CashChange       float64 `json:"cash_change"`
	TrialBalanceDiff float64 `json:"trial_balance_diff"`
	PostedEntriesYTD float64 `json:"posted_entries_ytd"`
	DraftEntries     float64 `json:"draft_entries"`
}

// Dashboard is AccountingDashboard.
type Dashboard struct {
	AsOf               string        `json:"as_of"`
	DateFrom           string        `json:"date_from"`
	DateTo             string        `json:"date_to"`
	KPIs               DashboardKPIs `json:"kpis"`
	BalanceComposition []NameValue   `json:"balance_composition"`
	PnlBreakdown       []NameValue   `json:"pnl_breakdown"`
	CashFlowBreakdown  []NameValue   `json:"cash_flow_breakdown"`
	MonthlyTrend       []MonthTrend  `json:"monthly_trend"`
	TopExpenseAccounts []TopExpense  `json:"top_expense_accounts"`
}

// Dashboard is getAccountingDashboard.
func (s *Service) Dashboard(ctx context.Context, companyID, asOf, dateFrom, dateTo string) (*Dashboard, error) {
	bs, err := s.BalanceSheet(ctx, companyID, asOf)
	if err != nil {
		return nil, err
	}
	is, err := s.IncomeStatement(ctx, companyID, dateFrom, dateTo)
	if err != nil {
		return nil, err
	}
	cf, err := s.CashFlow(ctx, companyID, dateFrom, dateTo)
	if err != nil {
		return nil, err
	}
	tb, err := s.TrialBalance(ctx, companyID, asOf)
	if err != nil {
		return nil, err
	}
	var posted, draft string
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*) FILTER (WHERE status = 'POSTED' AND entry_date >= $2::date AND entry_date <= $3::date)::text,
       COUNT(*) FILTER (WHERE status = 'DRAFT')::text
  FROM accounting.journal_entries
 WHERE deleted_at IS NULL AND company_id = $1::uuid`, companyID, dateFrom, dateTo).Scan(&posted, &draft); err != nil {
		return nil, err
	}
	monthly, err := collect[struct{ Month, Revenue, Expense string }](ctx, s.db, `
WITH months AS (
  SELECT to_char(d, 'YYYY-MM') AS month,
         date_trunc('month', d)::date AS start_date,
         (date_trunc('month', d) + interval '1 month' - interval '1 day')::date AS end_date
    FROM generate_series(date_trunc('month', $2::date), date_trunc('month', $3::date), interval '1 month') AS d
)
SELECT m.month,
       COALESCE(SUM(CASE WHEN t.code IN ('REVENUE', 'OTHER_INCOME') THEN
         CASE WHEN l.entry_side = 'CREDIT' THEN l.amount WHEN l.entry_side = 'DEBIT' THEN -l.amount ELSE 0 END
       ELSE 0 END), 0)::text AS revenue,
       COALESCE(SUM(CASE WHEN t.code IN ('EXPENSE', 'COGS', 'OTHER_EXPENSE') THEN
         CASE WHEN l.entry_side = 'DEBIT' THEN l.amount WHEN l.entry_side = 'CREDIT' THEN -l.amount ELSE 0 END
       ELSE 0 END), 0)::text AS expense
  FROM months m
  LEFT JOIN accounting.journal_entries e
    ON e.deleted_at IS NULL AND e.status = 'POSTED' AND e.company_id = $1::uuid
   AND e.entry_date >= m.start_date AND e.entry_date <= LEAST(m.end_date, $3::date)
  LEFT JOIN accounting.journal_entry_lines l ON l.entry_id = e.id
  LEFT JOIN accounting.chart_of_accounts coa ON coa.id = l.account_id
  LEFT JOIN accounting.account_types t ON t.id = coa.account_type_id
 GROUP BY m.month
 ORDER BY m.month ASC`, companyID, dateFrom, asOf)
	if err != nil {
		return nil, err
	}
	top, err := collect[struct{ Code, Name, Balance string }](ctx, s.db, `
SELECT coa.code, coa.name,
       COALESCE(SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE -l.amount END), 0)::text AS balance
  FROM accounting.chart_of_accounts coa
  JOIN accounting.account_types t ON t.id = coa.account_type_id
  LEFT JOIN accounting.journal_entry_lines l ON l.account_id = coa.id
  LEFT JOIN accounting.journal_entries e
    ON e.id = l.entry_id AND e.deleted_at IS NULL AND e.status = 'POSTED' AND e.company_id = $1::uuid
   AND e.entry_date >= $2::date AND e.entry_date <= $3::date
 WHERE coa.deleted_at IS NULL AND coa.is_active = true AND coa.is_postable = true AND coa.company_id = $1::uuid
   AND t.code IN ('EXPENSE', 'COGS', 'OTHER_EXPENSE')
 GROUP BY coa.id, coa.code, coa.name
HAVING COALESCE(SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE -l.amount END), 0) > 0
 ORDER BY 3 DESC
 LIMIT 8`, companyID, dateFrom, dateTo)
	if err != nil {
		return nil, err
	}
	trend := make([]MonthTrend, len(monthly))
	for i, m := range monthly {
		rev, exp := domain.Round2(domain.ParseNumber(m.Revenue)), domain.Round2(domain.ParseNumber(m.Expense))
		trend[i] = MonthTrend{Month: m.Month, Revenue: rev, Expense: exp, Net: domain.Round2(rev - exp)}
	}
	tops := make([]TopExpense, len(top))
	for i, t := range top {
		tops[i] = TopExpense{Code: t.Code, Name: t.Name, Balance: domain.Round2(domain.ParseNumber(t.Balance))}
	}
	return &Dashboard{
		AsOf: asOf, DateFrom: dateFrom, DateTo: dateTo,
		KPIs: DashboardKPIs{
			TotalAssets: bs.TotalAssets, TotalLiabilities: bs.TotalLiabilities, TotalEquity: bs.TotalEquity,
			NetIncome: is.NetIncome, CashBalance: cf.CashClosing, CashOpening: cf.CashOpening, CashChange: cf.NetCashChange,
			TrialBalanceDiff: domain.Round2(math.Abs(tb.TotalDebit - tb.TotalCredit)),
			PostedEntriesYTD: domain.ParseNumber(posted), DraftEntries: domain.ParseNumber(draft),
		},
		BalanceComposition: []NameValue{
			{"Assets", math.Max(bs.TotalAssets, 0)}, {"Liabilities", math.Max(bs.TotalLiabilities, 0)}, {"Equity", math.Max(bs.TotalEquity, 0)},
		},
		PnlBreakdown: []NameValue{
			{"Revenue", is.TotalRevenue}, {"COGS", is.TotalCogs}, {"Expenses", is.TotalExpenses},
			{"Other Income", is.TotalOtherIncome}, {"Other Expense", is.TotalOtherExpenses},
		},
		CashFlowBreakdown: []NameValue{
			{"Operating", cf.Operating.Total}, {"Investing", cf.Investing.Total}, {"Financing", cf.Financing.Total},
		},
		MonthlyTrend: trend, TopExpenseAccounts: tops,
	}, nil
}

// jsSlice is s.slice(0, n) on an ASCII string.
func jsSlice(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
