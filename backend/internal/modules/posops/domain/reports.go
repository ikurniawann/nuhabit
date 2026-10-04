package domain

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// POS report rules: the WIB report range, rush hour aggregation, payment
// method periods and labels, profit categories, the Food/Beverage revenue
// split and the closing report helpers.

var reportDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ReportRange is parseReportDateRange's result. Start and End are the TS
// ISO strings (WIB day bounds) passed to PostgreSQL as text.
type ReportRange struct {
	DateFrom, DateTo string
	StartIso, EndIso string
}

// ParseReportRange defaults to the first of the WIB month through today;
// a reversed range is an error message.
func ParseReportRange(from, to string, now time.Time) (ReportRange, string) {
	if !reportDate.MatchString(from) {
		from = FirstOfMonthWib(now)
	}
	if !reportDate.MatchString(to) {
		to = WibDateKey(now)
	}
	if from > to {
		return ReportRange{}, "Tanggal dari tidak boleh melebihi tanggal sampai"
	}
	return ReportRange{DateFrom: from, DateTo: to, StartIso: from + "T00:00:00.000+07:00", EndIso: to + "T23:59:59.999+07:00"}, ""
}

// round2 is Math.round(v * 100) / 100.
func round2(v float64) float64 { return Round(v*100) / 100 }

// Round2Safe is round2 of `Number(v) || 0`.
func Round2Safe(v float64) float64 {
	if math.IsNaN(v) {
		return 0
	}
	return round2(v)
}

/* ── Rush hour (lib/pos/rush-hour.ts) ────────────────────────────────── */

// RushHourHeatmapHours are the heatmap columns.
var RushHourHeatmapHours = []int{8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22}

var rushWeekdays = []string{"Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"}

// RushHourPoint is one (WIB hour, ISO weekday) aggregate.
type RushHourPoint struct {
	Hour, Dow                       float64
	Transactions, Revenue, Quantity float64
}

// RushHourBucket is one hour of the report.
type RushHourBucket struct {
	Hour          int     `json:"hour"`
	Label         string  `json:"label"`
	Transactions  float64 `json:"transactions"`
	Revenue       float64 `json:"revenue"`
	Quantity      float64 `json:"quantity"`
	AverageTicket float64 `json:"average_ticket"`
}

// RushHourWeekday is one weekday of the report.
type RushHourWeekday struct {
	Dow          int     `json:"dow"`
	Label        string  `json:"label"`
	Transactions float64 `json:"transactions"`
	Revenue      float64 `json:"revenue"`
}

// RushHourPeak is a peak hour or day.
type RushHourPeak struct {
	Hour         *int    `json:"hour"`
	HourLabel    *string `json:"hour_label"`
	Dow          *int    `json:"dow"`
	DowLabel     *string `json:"dow_label"`
	Transactions float64 `json:"transactions"`
	Revenue      float64 `json:"revenue"`
}

// RushHourCell is one heatmap cell.
type RushHourCell struct {
	Hour         int     `json:"hour"`
	Dow          int     `json:"dow"`
	Transactions float64 `json:"transactions"`
	Revenue      float64 `json:"revenue"`
}

// RushHourSummary is the report total.
type RushHourSummary struct {
	Transactions  float64 `json:"transactions"`
	Revenue       float64 `json:"revenue"`
	Quantity      float64 `json:"quantity"`
	AverageTicket float64 `json:"average_ticket"`
}

// RushHourReport is buildRushHourReport's result.
type RushHourReport struct {
	Summary         RushHourSummary   `json:"summary"`
	PeakHour        RushHourPeak      `json:"peak_hour"`
	PeakRevenueHour RushHourPeak      `json:"peak_revenue_hour"`
	PeakDay         RushHourPeak      `json:"peak_day"`
	Hourly          []RushHourBucket  `json:"hourly"`
	Weekdays        []RushHourWeekday `json:"weekdays"`
	Heatmap         []RushHourCell    `json:"heatmap"`
}

// HourLabel is "HH:00" for a clamped hour.
func HourLabel(hour int) string {
	h := min(23, max(0, hour))
	return strconv.Itoa(h/10) + strconv.Itoa(h%10) + ":00"
}

func averageTicket(revenue, transactions float64) float64 {
	if transactions <= 0 {
		return 0
	}
	return round2(revenue / transactions)
}

func nonNegative(f float64) float64 {
	if math.IsNaN(f) {
		return 0
	}
	return math.Max(0, f)
}

// BuildRushHourReport aggregates points into hours, weekdays and the
// weekday × hour heatmap, with the busiest hour, revenue hour and day.
func BuildRushHourReport(points []RushHourPoint) RushHourReport {
	hourly := make([]RushHourBucket, 24)
	for h := range hourly {
		hourly[h] = RushHourBucket{Hour: h, Label: HourLabel(h)}
	}
	weekdays := make([]RushHourWeekday, 7)
	for i := range weekdays {
		weekdays[i] = RushHourWeekday{Dow: i + 1, Label: rushWeekdays[i]}
	}
	type cell struct{ transactions, revenue float64 }
	heat := map[[2]int]*cell{}
	var total RushHourSummary
	for _, p := range points {
		hourF, dowF := math.Floor(p.Hour), math.Floor(p.Dow)
		if hourF < 0 || hourF > 23 || dowF < 1 || dowF > 7 {
			continue
		}
		hour, dow := int(hourF), int(dowF)
		tx, rev, qty := nonNegative(p.Transactions), nonNegative(p.Revenue), nonNegative(p.Quantity)
		hourly[hour].Transactions += tx
		hourly[hour].Revenue += rev
		hourly[hour].Quantity += qty
		weekdays[dow-1].Transactions += tx
		weekdays[dow-1].Revenue += rev
		key := [2]int{dow, hour}
		if c, ok := heat[key]; ok {
			c.transactions += tx
			c.revenue += rev
		} else {
			heat[key] = &cell{tx, rev}
		}
		total.Transactions += tx
		total.Revenue += rev
		total.Quantity += qty
	}
	for i := range hourly {
		hourly[i].Revenue = round2(hourly[i].Revenue)
		hourly[i].AverageTicket = averageTicket(hourly[i].Revenue, hourly[i].Transactions)
	}
	var byCount, byRevenue *RushHourBucket
	for i := range hourly {
		b := &hourly[i]
		if b.Transactions > 0 && (byCount == nil || b.Transactions > byCount.Transactions) {
			byCount = b
		}
		if b.Revenue > 0 && (byRevenue == nil || b.Revenue > byRevenue.Revenue) {
			byRevenue = b
		}
	}
	var peakDay *RushHourWeekday
	for i := range weekdays {
		d := &weekdays[i]
		if d.Transactions > 0 && (peakDay == nil || d.Transactions > peakDay.Transactions) {
			peakDay = d
		}
	}
	hourPeak := func(b *RushHourBucket) RushHourPeak {
		if b == nil {
			return RushHourPeak{}
		}
		h, label := b.Hour, b.Label
		return RushHourPeak{Hour: &h, HourLabel: &label, Transactions: b.Transactions, Revenue: b.Revenue}
	}
	report := RushHourReport{
		Summary: RushHourSummary{
			Transactions: total.Transactions, Revenue: round2(total.Revenue), Quantity: total.Quantity,
			AverageTicket: averageTicket(total.Revenue, total.Transactions),
		},
		PeakHour:        hourPeak(byCount),
		PeakRevenueHour: hourPeak(byRevenue),
		Hourly:          hourly,
	}
	if peakDay != nil {
		dow, label := peakDay.Dow, peakDay.Label
		report.PeakDay = RushHourPeak{Dow: &dow, DowLabel: &label, Transactions: peakDay.Transactions, Revenue: round2(peakDay.Revenue)}
	}
	report.Weekdays = make([]RushHourWeekday, 7)
	for i, d := range weekdays {
		d.Revenue = round2(d.Revenue)
		report.Weekdays[i] = d
	}
	for dow := 1; dow <= 7; dow++ {
		for _, hour := range RushHourHeatmapHours {
			c := RushHourCell{Hour: hour, Dow: dow}
			if v, ok := heat[[2]int{dow, hour}]; ok {
				c.Transactions, c.Revenue = v.transactions, round2(v.revenue)
			}
			report.Heatmap = append(report.Heatmap, c)
		}
	}
	return report
}

/* ── Payment methods report (lib/pos/payment-methods-report.ts) ──────── */

// ParseGranularity is day, month or year (default day).
func ParseGranularity(v string) string {
	switch v {
	case "month", "year", "day":
		return v
	}
	return "day"
}

// PeriodKey buckets a WIB YYYY-MM-DD date.
func PeriodKey(wibDate, granularity string) string {
	if !reportDate.MatchString(wibDate) {
		return wibDate
	}
	switch granularity {
	case "month":
		return wibDate[:7]
	case "year":
		return wibDate[:4]
	}
	return wibDate
}

func ymd(s string) (int, int, int) {
	parts := strings.Split(s, "-")
	y, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	d, _ := strconv.Atoi(parts[2])
	return y, m, d
}

func pad(n, width int) string {
	s := strconv.Itoa(n)
	for len(s) < width {
		s = "0" + s
	}
	return s
}

// EnumeratePeriods lists every period bucket of the inclusive range.
func EnumeratePeriods(from, to, granularity string) []string {
	periods := []string{}
	if !reportDate.MatchString(from) || !reportDate.MatchString(to) || from > to {
		return periods
	}
	switch granularity {
	case "day":
		for cur := from; cur <= to; {
			periods = append(periods, cur)
			y, m, d := ymd(cur)
			next := time.Date(y, time.Month(m), d+1, 0, 0, 0, 0, time.UTC)
			cur = pad(next.Year(), 4) + "-" + pad(int(next.Month()), 2) + "-" + pad(next.Day(), 2)
		}
	case "month":
		y, m, _ := ymd(from)
		ey, em, _ := ymd(to)
		for y < ey || (y == ey && m <= em) {
			periods = append(periods, pad(y, 4)+"-"+pad(m, 2))
			if m++; m > 12 {
				m, y = 1, y+1
			}
		}
	default:
		y, _, _ := ymd(from)
		ey, _, _ := ymd(to)
		for ; y <= ey; y++ {
			periods = append(periods, strconv.Itoa(y))
		}
	}
	return periods
}

var idMonthsLong = [...]string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}

// PeriodLabel is "4 Okt 2026", "Oktober 2026" or the year.
func PeriodLabel(period, granularity string) string {
	switch granularity {
	case "year":
		return period
	case "month":
		parts := strings.Split(period, "-")
		if len(parts) < 2 {
			return period
		}
		y, _ := strconv.Atoi(parts[0])
		m, _ := strconv.Atoi(parts[1])
		if y == 0 || m == 0 {
			return period
		}
		t := time.Date(y, time.Month(m), 1, 0, 0, 0, 0, time.UTC)
		return idMonthsLong[t.Month()-1] + " " + strconv.Itoa(t.Year())
	}
	if !reportDate.MatchString(period) {
		return period
	}
	y, m, d := ymd(period)
	t := time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC)
	return strconv.Itoa(t.Day()) + " " + idMonthsShort[t.Month()-1] + " " + strconv.Itoa(t.Year())
}

// PaymentMethodKey is the catalog code when set, else the method
// (credit as credit_card), else "unknown".
func PaymentMethodKey(method, code *string) string {
	if c := strings.ToLower(TrimJS(orStr(code, ""))); c != "" {
		return c
	}
	m := strings.ToLower(TrimJS(orStr(method, "")))
	if m == "credit" {
		return "credit_card"
	}
	if m == "" {
		return "unknown"
	}
	return m
}

// builtInPaymentCodes are the codes a catalog row may not be renamed from.
var builtInPaymentCodes = map[string]bool{"cash": true, "qris": true, "credit_card": true, "ark_coin": true, "nfc_tab": true, "gift_card": true}

var paymentMethodLabels = map[string]string{
	"cash": "Tunai", "qris": "QRIS", "credit": "Kartu", "credit_card": "Kartu", "debit": "Kartu debit",
	"ark_coin": "ARK Coin", "nfc_tab": "NFC Tab", "member_bill": "Tagihan Member", "gift_card": "Gift card",
}

// PaymentMethodLabel mirrors formatPaymentMethodLabel: a custom catalog
// method shows its name, a built-in one its Indonesian label.
func PaymentMethodLabel(method string, catalogCode, catalogName string) string {
	code := strings.ToLower(TrimJS(catalogCode))
	name := TrimJS(catalogName)
	if name != "" && code != "" && !builtInPaymentCodes[code] {
		return name
	}
	value := strings.ToLower(TrimJS(method))
	if value == "" {
		if name != "" {
			return name
		}
		return "—"
	}
	if l, ok := paymentMethodLabels[value]; ok {
		return l
	}
	if method != "" {
		return method
	}
	return "—"
}

// LocaleCompare approximates String.prototype.localeCompare for labels:
// case-insensitive first, then by code point.
func LocaleCompare(a, b string) int {
	if c := strings.Compare(strings.ToLower(a), strings.ToLower(b)); c != 0 {
		return c
	}
	return strings.Compare(b, a) // lower case sorts before upper case in ICU
}

/* ── Profit categories (lib/pos/profit-category.ts) ──────────────────── */

var posGroupCategories = map[string]bool{"makanan": true, "minuman": true, "dessert": true}

func isPosGroupCategory(name string) bool { return posGroupCategories[strings.ToLower(TrimJS(name))] }

// ItemCategory is an item.product_categories row.
type ItemCategory struct{ Code, Nama *string }

// ItemCategoryLabels maps lower-cased codes and names to display labels.
func ItemCategoryLabels(categories []ItemCategory) map[string]string {
	m := map[string]string{}
	for _, c := range categories {
		code, nama := TrimJS(orStr(c.Code, "")), TrimJS(orStr(c.Nama, ""))
		label := nama
		if label == "" {
			label = code
		}
		if label == "" {
			continue
		}
		if code != "" {
			m[strings.ToLower(code)] = label
		}
		if nama != "" {
			m[strings.ToLower(nama)] = nama
		}
	}
	return m
}

// LookupItemCategoryName maps a kategori code to its label (or itself).
func LookupItemCategoryName(kategori *string, labels map[string]string) *string {
	key := TrimJS(orStr(kategori, ""))
	if key == "" {
		return nil
	}
	if l, ok := labels[strings.ToLower(key)]; ok && l != "" {
		return &l
	}
	return &key
}

// ProfitCategory mirrors resolveProfitCategory: the master category unless
// it is only a POS group (Makanan, Minuman, Dessert).
func ProfitCategory(itemCode, itemName, posName *string) (id, label string) {
	name, code := TrimJS(orStr(itemName, "")), TrimJS(orStr(itemCode, ""))
	if code != "" && !isPosGroupCategory(code) {
		if name != "" && !isPosGroupCategory(name) {
			return code, name
		}
		return code, code
	}
	if name != "" && !isPosGroupCategory(name) {
		return name, name
	}
	if pos := TrimJS(orStr(posName, "")); pos != "" && !isPosGroupCategory(pos) {
		return pos, pos
	}
	return "uncategorized", "Tanpa kategori"
}

/* ── Revenue composition (lib/pos/revenue-composition.ts) ────────────── */

var (
	bakeryGroup   = regexp.MustCompile(`(?i)bakery|dessert|pastry`)
	beverageGroup = regexp.MustCompile(`(?i)beverage|minuman|coffee|matcha[\s-]*bar|tea|drink|barista|yokoco`)
)

// RevenueGroup is "food" or "beverage": from the master category, else the
// POS category, else the item's station (bar is beverage).
func RevenueGroup(itemCategory, posCategory, station *string) string {
	for _, v := range []*string{itemCategory, posCategory} {
		if s := TrimJS(orStr(v, "")); s != "" {
			if bakeryGroup.MatchString(s) || !beverageGroup.MatchString(s) {
				return "food"
			}
			return "beverage"
		}
	}
	if strings.ToLower(TrimJS(orStr(station, ""))) == "bar" {
		return "beverage"
	}
	return "food"
}

// RevenueGroupLabels are the group labels.
var RevenueGroupLabels = map[string]string{"food": "Food", "beverage": "Beverage"}

// RevenueBucket is a Food/Beverage or category bucket.
type RevenueBucket struct {
	ID            string  `json:"id"`
	Label         string  `json:"label"`
	Quantity      float64 `json:"quantity"`
	Sales         float64 `json:"sales"`
	Cost          float64 `json:"cost"`
	Margin        float64 `json:"margin"`
	CostPct       float64 `json:"cost_pct"`
	SalesSharePct float64 `json:"sales_share_pct"`
	QtySharePct   float64 `json:"qty_share_pct"`
}

// SafePct is part / whole * 100 rounded to 2 decimals, 0 for a zero whole.
func SafePct(part, whole float64) float64 {
	if whole == 0 || math.IsNaN(whole) {
		return 0
	}
	return Round2Safe(part / whole * 100)
}

// Finalize fills margin, cost% and shares of totals (salesTotal, qtyTotal).
func (b RevenueBucket) Finalize(salesTotal, qtyTotal float64) RevenueBucket {
	sales, cost := Round2Safe(b.Sales), Round2Safe(b.Cost)
	b.Sales, b.Cost = sales, cost
	b.Margin = Round2Safe(sales - cost)
	b.CostPct = SafePct(cost, sales)
	b.SalesSharePct = SafePct(sales, salesTotal)
	b.QtySharePct = SafePct(b.Quantity, qtyTotal)
	return b
}

/* ── Closing report (lib/pos/closing-report-helpers.ts) ──────────────── */

var stationSegment = map[string]string{
	"kitchen": "FNB", "bakery": "FNB", "dessert": "FNB", "bar": "BEV", "merchandise": "BEV", "photobooth": "OTHER",
}

// SegmentLabels are the closing report segment titles.
var SegmentLabels = map[string]string{"FNB": "F&B", "BEV": "Beverage", "OTHER": "Others"}

// Segment maps an item station to FNB, BEV or OTHER.
func Segment(station *string) string {
	if station == nil || *station == "" {
		return "OTHER"
	}
	if s, ok := stationSegment[*station]; ok {
		return s
	}
	return "OTHER"
}

// Percentage is part / total * 100 to one decimal, 0 for total <= 0.
func Percentage(part, total float64) float64 {
	if total <= 0 {
		return 0
	}
	return Round(part/total*1000) / 10
}

// RoundCurrency is Math.round(v * 100) / 100.
func RoundCurrency(v float64) float64 { return round2(v) }

// TargetBlock is {target, actual, variance} rounded to cents.
type TargetBlock struct {
	Target   float64 `json:"target"`
	Actual   float64 `json:"actual"`
	Variance float64 `json:"variance"`
}

// NewTargetBlock compares actual with target.
func NewTargetBlock(actual, target float64) TargetBlock {
	return TargetBlock{Target: round2(target), Actual: round2(actual), Variance: round2(actual - target)}
}

// ClosingOrderAmounts are the order amounts the closing totals read.
type ClosingOrderAmounts struct{ Subtotal, Discount, Total float64 }

// IsFullDiscount is a bill whose discount covers the subtotal, or a paid
// bill reduced to zero by a discount.
func IsFullDiscount(o ClosingOrderAmounts) bool {
	if o.Subtotal <= 0 {
		return false
	}
	if o.Discount+0.01 >= o.Subtotal {
		return true
	}
	return o.Total <= 0.01 && o.Discount > 0
}

// TransactionTotals is summarizeClosingTransactions' result.
type TransactionTotals struct {
	Transactions             int     `json:"transactions"`
	Sales                    float64 `json:"sales"`
	Discount                 float64 `json:"discount"`
	FullDiscountTransactions int     `json:"full_discount_transactions"`
	FullDiscountAmount       float64 `json:"full_discount_amount"`
}

// SummarizeClosingTransactions counts bills, sales, discounts and the
// complimentary (fully discounted) ones.
func SummarizeClosingTransactions(orders []ClosingOrderAmounts) TransactionTotals {
	var t TransactionTotals
	for _, o := range orders {
		t.Transactions++
		t.Sales += o.Total
		t.Discount += o.Discount
		if IsFullDiscount(o) {
			t.FullDiscountTransactions++
			t.FullDiscountAmount += o.Subtotal
		}
	}
	t.Sales, t.Discount, t.FullDiscountAmount = round2(t.Sales), round2(t.Discount), round2(t.FullDiscountAmount)
	return t
}

// CalendarDay is new Date(`${date}T12:00:00`) on a UTC server: a
// YYYY-MM-DD day (days past the month end roll over, as in JS).
func CalendarDay(date string) (time.Time, bool) {
	t, ok := jsDateAt(date, 12, 0, 0, 0)
	if !ok {
		return time.Time{}, false
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 12, 0, 0, 0, time.UTC), true
}

// ReportDateTitle mirrors formatReportDate: "Sunday, 04th Oct 2026" for a
// calendar day.
func ReportDateTitle(d time.Time) string {
	day := d.Day()
	suffix := "th"
	switch {
	case day%10 == 1 && day != 11:
		suffix = "st"
	case day%10 == 2 && day != 12:
		suffix = "nd"
	case day%10 == 3 && day != 13:
		suffix = "rd"
	}
	return d.Format("Monday") + ", " + pad(day, 2) + suffix + " " + d.Format("Jan") + " " + strconv.Itoa(d.Year())
}

// ReportClock mirrors formatReportTime: "HH:MM" in WIB, "-" for none.
func ReportClock(t *time.Time) string {
	if t == nil {
		return "-"
	}
	return t.In(Jakarta).Format("15:04")
}
