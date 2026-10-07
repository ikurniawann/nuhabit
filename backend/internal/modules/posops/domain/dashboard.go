package domain

import (
	"regexp"
	"sort"
	"strconv"
	"time"
)

// POS dashboard rules (lib/pos/dashboard-stats.ts): WIB period ranges,
// the sales summary, best sellers and the hourly or daily trend.

const day = 24 * time.Hour

var isoDate = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)

// jsDateAt is new Date(`${key}T<clock>+07:00`): out-of-range days roll
// over like JS (Feb 30 is Mar 2); an impossible month or day is invalid.
func jsDateAt(key string, h, m, s, ms int) (time.Time, bool) {
	p := isoDate.FindStringSubmatch(key)
	if p == nil {
		return time.Time{}, false
	}
	y, _ := strconv.Atoi(p[1])
	mo, _ := strconv.Atoi(p[2])
	d, _ := strconv.Atoi(p[3])
	if mo < 1 || mo > 12 || d < 1 || d > 31 {
		return time.Time{}, false
	}
	return time.Date(y, time.Month(mo), d, h, m, s, ms*int(time.Millisecond), Jakarta), true
}

// WibMidnight is 00:00 WIB of a YYYY-MM-DD key.
func WibMidnight(key string) time.Time {
	t, _ := jsDateAt(key, 0, 0, 0, 0)
	return t
}

// WibDateKey is the WIB calendar date (YYYY-MM-DD) of t.
func WibDateKey(t time.Time) string { return t.In(Jakarta).Format("2006-01-02") }

// FirstOfMonthWib is the first day of t's WIB month.
func FirstOfMonthWib(t time.Time) string { return t.In(Jakarta).Format("2006-01") + "-01" }

// DashboardRange is a period and the same-length period just before it.
type DashboardRange struct {
	Start, End         time.Time
	PrevStart, PrevEnd time.Time
}

func withPrevious(start, end time.Time) DashboardRange {
	d := end.Sub(start)
	return DashboardRange{Start: start, End: end, PrevStart: start.Add(-d), PrevEnd: start.Add(-time.Millisecond)}
}

// CustomRange is two whole WIB days, inclusive, at most 366 days apart;
// ok is false for a bad format, a reversed or a too long range.
func CustomRange(from, to string) (DashboardRange, bool) {
	start, ok1 := jsDateAt(from, 0, 0, 0, 0)
	end, ok2 := jsDateAt(to, 23, 59, 59, 999)
	if !ok1 || !ok2 || end.Before(start) || end.Sub(start) > 366*day {
		return DashboardRange{}, false
	}
	return withPrevious(start, end), true
}

// PeriodRange is today, this week (from Monday) or this month in WIB, up
// to now.
func PeriodRange(period string, now time.Time) DashboardRange {
	today := WibDateKey(now)
	switch period {
	case "today":
		return withPrevious(WibMidnight(today), now)
	case "month":
		return withPrevious(WibMidnight(FirstOfMonthWib(now)), now)
	}
	noon, _ := time.Parse("2006-01-02T15:04:05Z", today+"T12:00:00Z")
	sinceMonday := (int(noon.Weekday()) + 6) % 7
	return withPrevious(WibMidnight(today).Add(-time.Duration(sinceMonday)*day), now)
}

// DashboardOrder is a pos_orders row of the period.
type DashboardOrder struct {
	ID            string
	TotalAmount   *string
	CashierID     *string
	OrderedAt     time.Time
	ArkCoinsUsed  *string
	PaymentMethod *string
	Status        string
	PaymentStatus string
}

// IsRevenue is a paid order that was not cancelled, voided or merged.
func (o DashboardOrder) IsRevenue() bool {
	switch o.Status {
	case "cancelled", "voided", "merged":
		return false
	}
	return o.PaymentStatus == "paid"
}

func numOf(s *string) float64 {
	if s == nil {
		return 0
	}
	return ToNumber(*s)
}

// Total is toNumber(total_amount).
func (o DashboardOrder) Total() float64 { return numOf(o.TotalAmount) }

// ArkUsed is toNumber(ark_coins_used).
func (o DashboardOrder) ArkUsed() float64 { return numOf(o.ArkCoinsUsed) }

// SalesSummary is summarizeSales' result.
type SalesSummary struct {
	TodayRevenue      float64 `json:"todayRevenue"`
	TodayOrders       int     `json:"todayOrders"`
	AverageOrderValue float64 `json:"averageOrderValue"`
	ActiveCashiers    int     `json:"activeCashiers"`
	RevenueChange     float64 `json:"revenueChange"`
	OrdersChange      float64 `json:"ordersChange"`
}

func round1(v float64) float64 { return Round(v*10) / 10 }

func percentChange(current, previous float64) float64 {
	if previous > 0 {
		return round1((current - previous) / previous * 100)
	}
	return 0
}

// SummarizeSales counts paid revenue and compares with the previous period.
func SummarizeSales(orders []DashboardOrder, prevRevenue float64, prevOrders int) SalesSummary {
	var s SalesSummary
	cashiers := map[string]bool{}
	for _, o := range orders {
		if o.CashierID != nil && *o.CashierID != "" {
			cashiers[*o.CashierID] = true
		}
		if o.IsRevenue() {
			s.TodayRevenue += o.Total()
			s.TodayOrders++
		}
	}
	if s.TodayOrders > 0 {
		s.AverageOrderValue = Round(s.TodayRevenue / float64(s.TodayOrders))
	}
	s.ActiveCashiers = len(cashiers)
	s.RevenueChange = percentChange(s.TodayRevenue, prevRevenue)
	s.OrdersChange = percentChange(float64(s.TodayOrders), float64(prevOrders))
	return s
}

// DashboardItem is a pos_order_items row of the period.
type DashboardItem struct {
	OrderID     string
	ProductID   *string
	ProductName *string
	Quantity    *string
	TotalAmount *string
}

// TopProduct is one best seller.
type TopProduct struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Sold    float64 `json:"sold"`
	Revenue float64 `json:"revenue"`
}

// TopProducts is the five best sellers by quantity among paid orders.
func TopProducts(items []DashboardItem, paid map[string]bool) []TopProduct {
	var order []string
	byID := map[string]*TopProduct{}
	for _, it := range items {
		if !paid[it.OrderID] {
			continue
		}
		id := "null"
		if it.ProductID != nil {
			id = *it.ProductID
		}
		p, ok := byID[id]
		if !ok {
			name := "Unknown"
			if it.ProductName != nil && *it.ProductName != "" {
				name = *it.ProductName
			}
			p = &TopProduct{ID: id, Name: name}
			byID[id] = p
			order = append(order, id)
		}
		p.Sold += numOf(it.Quantity)
		p.Revenue += numOf(it.TotalAmount)
	}
	out := make([]TopProduct, len(order))
	for i, id := range order {
		out[i] = *byID[id]
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Sold > out[j].Sold })
	if len(out) > 5 {
		out = out[:5]
	}
	return out
}

// XpRow is XP earned at a time.
type XpRow struct {
	XpEarned  float64
	CreatedAt time.Time
}

// TrendPoint is one hour or day of the trend.
type TrendPoint struct {
	Label    string  `json:"label"`
	Revenue  float64 `json:"revenue"`
	Orders   int     `json:"orders"`
	ArkUsed  float64 `json:"arkUsed"`
	XpEarned float64 `json:"xpEarned"`
}

func hourLabel(h int) string { return strconv.Itoa(h/10) + strconv.Itoa(h%10) + ":00" }

// BuildTrend buckets paid orders and XP by WIB hour (today) or WIB day.
func BuildTrend(period string, start, end time.Time, paid []DashboardOrder, xp []XpRow, now time.Time) []TrendPoint {
	hourly := period == "today"
	keyOf := func(t time.Time) string {
		if hourly {
			return hourLabel(t.In(Jakarta).Hour())
		}
		return WibDateKey(t)
	}
	buckets := map[string]*TrendPoint{}
	bucket := func(key string) *TrendPoint {
		if b, ok := buckets[key]; ok {
			return b
		}
		b := &TrendPoint{}
		buckets[key] = b
		return b
	}
	for _, o := range paid {
		b := bucket(keyOf(o.OrderedAt))
		b.Revenue += o.Total()
		b.Orders++
		b.ArkUsed += o.ArkUsed()
	}
	for _, r := range xp {
		bucket(keyOf(r.CreatedAt)).XpEarned += r.XpEarned
	}
	point := func(label, key string) TrendPoint {
		p := TrendPoint{Label: label}
		if b, ok := buckets[key]; ok {
			p.Revenue, p.Orders, p.ArkUsed, p.XpEarned = b.Revenue, b.Orders, b.ArkUsed, b.XpEarned
		}
		return p
	}
	points := []TrendPoint{}
	if hourly {
		for h := 0; h <= now.In(Jakarta).Hour(); h++ {
			points = append(points, point(hourLabel(h), hourLabel(h)))
		}
		return points
	}
	last := WibDateKey(end)
	for d := WibMidnight(WibDateKey(start)); ; d = d.Add(day) {
		key := WibDateKey(d)
		if key > last {
			break
		}
		w := d.In(Jakarta)
		points = append(points, point(strconv.Itoa(w.Day())+" "+idMonthsShort[w.Month()-1], key))
	}
	return points
}

// ClockWib is formatTime: "HH.MM" in WIB.
func ClockWib(t time.Time) string { return t.In(Jakarta).Format("15.04") }
