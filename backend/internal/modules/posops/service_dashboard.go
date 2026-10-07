package posops

import (
	"context"
	"slices"
	"time"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
)

// Dashboard is GET /api/pos/dashboard's data, keys in the TS order.
type Dashboard struct {
	Stats           domain.SalesSummary `json:"stats"`
	TopProducts     []domain.TopProduct `json:"topProducts"`
	RecentOrders    []RecentOrderView   `json:"recentOrders"`
	ArkXp           ArkXpView           `json:"arkXp"`
	Trend           []domain.TrendPoint `json:"trend"`
	TopLoyalMembers []LoyalMemberView   `json:"topLoyalMembers"`
}

// RecentOrderView is one recent order card.
type RecentOrderView struct {
	ID            string  `json:"id"`
	Cashier       string  `json:"cashier"`
	Total         float64 `json:"total"`
	Status        string  `json:"status"`
	PaymentStatus string  `json:"payment_status"`
	Time          string  `json:"time"`
}

// ArkXpView is the ARK Coin and XP panel.
type ArkXpView struct {
	TotalArkUsed     float64 `json:"totalArkUsed"`
	TotalArkEarned   float64 `json:"totalArkEarned"`
	TotalXpEarned    float64 `json:"totalXpEarned"`
	ArkPaymentOrders int     `json:"arkPaymentOrders"`
	MembersWithXp    int     `json:"membersWithXp"`
	TotalArkBalance  float64 `json:"totalArkBalance"`
}

// LoyalMemberView is one top loyal member.
type LoyalMemberView struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	MembershipTier string  `json:"membershipTier"`
	TotalXp        float64 `json:"totalXp"`
	ArkBalance     float64 `json:"arkBalance"`
}

// ignored logs a failed read; the caller goes on with the nil result, as
// the TS reads only `data` from these queries.
func (s *Service) ignored(ctx context.Context, what string, err error) {
	if err != nil {
		s.log.ErrorContext(ctx, "[pos] dashboard "+what, "error", err)
	}
}

// LoadDashboard mirrors loadPosDashboard for a period and its range.
func (s *Service) LoadDashboard(ctx context.Context, period string, r domain.DashboardRange) Dashboard {
	q := s.db
	orders, err := s.ports.Sales.DashboardOrders(ctx, q, r.Start, r.End)
	s.ignored(ctx, "orders", err)
	prevTotals, err := s.ports.Sales.PaidOrderTotals(ctx, q, r.PrevStart, r.PrevEnd)
	s.ignored(ctx, "previous", err)
	items, err := s.ports.Sales.DashboardItems(ctx, q, r.Start, r.End)
	s.ignored(ctx, "items", err)

	var paid []domain.DashboardOrder
	paidIDs := map[string]bool{}
	for _, o := range orders {
		if o.IsRevenue() {
			paid = append(paid, o)
			paidIDs[o.ID] = true
		}
	}
	prevRevenue := 0.0
	for _, t := range prevTotals {
		prevRevenue += numOrZero(t)
	}
	credits, err := s.ports.StoredValue.WalletCredits(ctx, q, r.Start, r.End)
	s.ignored(ctx, "wallet", err)
	xp, err := s.ports.CRM.PosXp(ctx, q, r.Start, r.End)
	s.ignored(ctx, "xp", err)

	d := Dashboard{
		Stats:        domain.SummarizeSales(orders, prevRevenue, len(prevTotals)),
		TopProducts:  domain.TopProducts(items, paidIDs),
		RecentOrders: s.recentOrders(ctx),
		Trend:        domain.BuildTrend(period, r.Start, r.End, paid, xp, s.now()),
	}
	if d.TopProducts == nil {
		d.TopProducts = []domain.TopProduct{}
	}
	for _, o := range paid {
		d.ArkXp.TotalArkUsed += o.ArkUsed()
		if (o.PaymentMethod != nil && *o.PaymentMethod == "ark_coin") || o.ArkUsed() > 0 {
			d.ArkXp.ArkPaymentOrders++
		}
	}
	for _, c := range credits {
		v := numOrZero(c)
		if v < 0 {
			v = -v
		}
		d.ArkXp.TotalArkEarned += v
	}
	for _, x := range xp {
		d.ArkXp.TotalXpEarned += x.XpEarned
	}
	loyalty := s.memberLoyalty(ctx)
	d.ArkXp.MembersWithXp, d.ArkXp.TotalArkBalance = loyalty.withXp, loyalty.balance
	d.TopLoyalMembers = loyalty.top
	return d
}

func numOrZero(s *string) float64 {
	if s == nil {
		return 0
	}
	return domain.ToNumber(*s)
}

// recentOrders is the eight newest orders with the cashier's employee name.
func (s *Service) recentOrders(ctx context.Context) []RecentOrderView {
	rows, err := s.ports.Sales.RecentOrders(ctx, s.db, 8)
	s.ignored(ctx, "recent orders", err)
	var ids []string
	for _, o := range rows {
		if o.CashierID != nil && *o.CashierID != "" && !slices.Contains(ids, *o.CashierID) {
			ids = append(ids, *o.CashierID)
		}
	}
	var names map[string]string
	if len(ids) > 0 {
		names, err = s.ports.Directory.EmployeeNames(ctx, s.db, ids)
		s.ignored(ctx, "cashiers", err)
	}
	out := make([]RecentOrderView, len(rows))
	for i, o := range rows {
		v := RecentOrderView{ID: o.ID, Cashier: "—", Total: numOrZero(o.TotalAmount), Status: "pending", PaymentStatus: "unpaid", Time: "-"}
		if o.OrderNumber != nil && *o.OrderNumber != "" {
			v.ID = *o.OrderNumber
		}
		if o.CashierID != nil {
			if n := names[*o.CashierID]; n != "" {
				v.Cashier = n
			}
		}
		if o.Status != nil && *o.Status != "" {
			v.Status = *o.Status
		}
		if o.PaymentStatus != nil && *o.PaymentStatus != "" {
			v.PaymentStatus = *o.PaymentStatus
		}
		if o.OrderedAt != nil {
			v.Time = domain.ClockWib(*o.OrderedAt)
		}
		out[i] = v
	}
	return out
}

type loyaltyStats struct {
	withXp  int
	balance float64
	top     []LoyalMemberView
}

// memberLoyalty reads active members: how many hold XP, the ARK balance
// in circulation, and the five with the most XP.
func (s *Service) memberLoyalty(ctx context.Context) loyaltyStats {
	var st loyaltyStats
	s.ignored(ctx, "members", s.db.QueryRow(ctx,
		`SELECT count(*)::int FROM pos.pos_customers WHERE is_active = true AND total_xp > 0`).Scan(&st.withXp))
	balances, err := textColumn(ctx, s.db, `SELECT ark_coin_balance::text FROM pos.pos_customers WHERE is_active = true`)
	s.ignored(ctx, "balances", err)
	for _, b := range balances {
		st.balance += numOrZero(b)
	}
	st.top = []LoyalMemberView{}
	rows, err := s.db.Query(ctx, `SELECT id::text, name, membership_tier, total_xp, ark_coin_balance::text
		FROM pos.pos_customers
		WHERE is_active = true AND (total_xp > 0 OR ark_coin_balance > 0)
		ORDER BY total_xp DESC LIMIT 5`)
	if err != nil {
		s.ignored(ctx, "loyal members", err)
		return st
	}
	defer rows.Close()
	for rows.Next() {
		var m LoyalMemberView
		var name, tier, ark *string
		var xp *int
		if err := rows.Scan(&m.ID, &name, &tier, &xp, &ark); err != nil {
			return st
		}
		m.Name, m.MembershipTier = orDefault(nonEmptyPtr(name), "Member"), orDefault(nonEmptyPtr(tier), "regular")
		if xp != nil {
			m.TotalXp = float64(*xp)
		}
		m.ArkBalance = numOrZero(ark)
		st.top = append(st.top, m)
	}
	return st
}

// textColumn reads a one-column text result (NULL as nil).
func textColumn(ctx context.Context, q database.Querier, sql string, args ...any) ([]*string, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*string
	for rows.Next() {
		var v *string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// dashboardPeriods are the accepted ?period values.
var dashboardPeriods = []string{"today", "week", "month", "custom"}

// DashboardRangeFor resolves ?period (unknown values mean month) and the
// custom dates; ok is false for an invalid custom range.
func DashboardRangeFor(period, from, to string, now time.Time) (string, domain.DashboardRange, bool) {
	if period == "" {
		period = "today"
	}
	if !slices.Contains(dashboardPeriods, period) {
		period = "month"
	}
	if period == "custom" {
		r, ok := domain.CustomRange(from, to)
		return period, r, ok
	}
	return period, domain.PeriodRange(period, now), true
}
