package procurement

import (
	"context"
	"math"
	"regexp"
	"strconv"
	"time"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/jsmath"
)

// Port of frontend/src/lib/purchasing/dashboard-data.ts
// (loadPurchasingDashboard). Only the current-period PO query may fail the
// request; every other panel reads as empty (or 0) on a query error.

var idShortMonths = [...]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

// PurchasingDashboard is loadPurchasingDashboard; startDate and endDate are
// the raw query values ("" = the current month), warehouseID the active
// stall ("" = every stall).
func (s *Service) PurchasingDashboard(ctx context.Context, startDate, endDate, warehouseID string) (*Row, error) {
	now := s.now()
	start, end, prevStart, prevEnd, err := dashboardPeriod(startDate, endDate, now, s.loc)
	if err != nil {
		return nil, err
	}
	current, err := s.poValuesBetween(ctx, start, end)
	if err != nil {
		return nil, err
	}
	previous, _ := s.poValuesBetween(ctx, prevStart, prevEnd)
	lowStockCount, _ := s.ports.Stock.LowStockCount(ctx, s.db, warehouseID)
	var pending int
	_ = s.db.QueryRow(ctx, `SELECT count(*)::int FROM "v_purchase_orders" WHERE "status" = $1`, "pending_approval").Scan(&pending)

	totalValue, previousValue := sumPoValue(current), sumPoValue(previous)
	kpis := obj(
		"totalPOCount", len(current),
		"totalPOCountChange", percentChange(float64(len(current)), float64(len(previous))),
		"totalPOValue", totalValue,
		"totalPOValueChange", percentChange(totalValue, previousValue),
		"lowStockCount", lowStockCount,
		"pendingApprovalCount", pending,
	)

	actionPOs := []*Row{}
	rows, _ := s.rows.Query(ctx, s.db, `SELECT "id", "nomor_po", "tanggal_po", "tanggal_kirim_estimasi", "status", "nama_supplier"
		FROM "v_purchase_orders" WHERE ("status" = $1 OR "status" = $2)
		ORDER BY "tanggal_kirim_estimasi" ASC NULLS LAST LIMIT $3`, "sent", "pending_approval", 10)
	for _, po := range rows {
		actionPOs = append(actionPOs, obj(
			"id", po.Get("id"),
			"po_number", po.Get("nomor_po"),
			"supplier_name", orValue(po.Get("nama_supplier"), "Unknown"),
			"order_date", po.Get("tanggal_po"),
			"expected_date", po.Get("tanggal_kirim_estimasi"),
			"status", po.Get("status"),
			"days_overdue", daysOverdue(po.Get("tanggal_kirim_estimasi"), now),
		))
	}

	stockAlerts := []*Row{}
	items, _ := s.ports.Stock.LowStockItems(ctx, s.db, warehouseID)
	for _, item := range items {
		stockAlerts = append(stockAlerts, obj(
			"id", item.Get("id"),
			"material_name", item.Get("nama"),
			"category", orValue(item.Get("kategori"), "Uncategorized"),
			"qty_on_hand", orValue(item.Get("qty_onhand"), 0),
			"minimum_stok", orValue(item.Get("min_stock"), 0),
			"unit", orValue(item.Get("satuan"), "unit"),
			"alert_level", alertLevel(item.Get("qty_onhand")),
		))
	}

	monthly, _ := s.rows.Query(ctx, s.db, `SELECT "grand_total", "total", "created_at", "source_type"
		FROM "v_purchase_orders" ORDER BY "created_at" ASC LIMIT $1`, 100)

	suppliers := []*Row{}
	list, _ := s.rows.Query(ctx, s.db, `SELECT "id", "nama_supplier" FROM "suppliers" LIMIT $1`, 10)
	for _, sp := range list {
		// Fixed placeholder figures, as the TS has them.
		suppliers = append(suppliers, obj(
			"supplier_id", sp.Get("id"),
			"supplier_name", sp.Get("nama_supplier"),
			"on_time_rate", 85,
			"qc_pass_rate", 95,
			"total_deliveries", 0,
			"avg_lead_time_days", 3,
		))
	}

	return obj(
		"kpis", kpis,
		"monthlyTrends", monthlyTrends(monthly, now, s.loc),
		"actionPOs", actionPOs,
		"stockAlerts", stockAlerts,
		"hppTrends", []*Row{},
		"supplierPerformance", suppliers,
	), nil
}

func (s *Service) poValuesBetween(ctx context.Context, from, to time.Time) ([]*Row, error) {
	return s.rows.Query(ctx, s.db, `SELECT "id", "total", "grand_total", "created_at" FROM "v_purchase_orders"
		WHERE "created_at" >= $1 AND "created_at" <= $2`, from, to)
}

// dashboardPeriod is resolveDashboardPeriod: the query dates (new Date),
// else the current local month, plus the same span a month earlier.
func dashboardPeriod(startDate, endDate string, now time.Time, loc *time.Location) (start, end, prevStart, prevEnd time.Time, err error) {
	local := now.In(loc)
	start = time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, loc)
	end = time.Date(local.Year(), local.Month()+1, 0, 23, 59, 59, 999_000_000, loc)
	for _, p := range []struct {
		raw string
		dst *time.Time
	}{{startDate, &start}, {endDate, &end}} {
		if p.raw == "" {
			continue
		}
		t, ok := parseJSDate(p.raw, loc)
		if !ok {
			return start, end, prevStart, prevEnd, errInvalidDate
		}
		*p.dst = t
	}
	return start, end, previousMonth(start, loc), previousMonth(end, loc), nil
}

// previousMonth is date.setMonth(date.getMonth() - 1) in local time; an
// overflowing day rolls into the next month as in JS.
func previousMonth(t time.Time, loc *time.Location) time.Time {
	l := t.In(loc)
	return time.Date(l.Year(), l.Month()-1, l.Day(), l.Hour(), l.Minute(), l.Second(), l.Nanosecond(), loc)
}

var (
	isoDateOnly = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)
	isoDateTime = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$`)
)

// parseJSDate is new Date(s) for the ISO forms: a date alone is UTC
// midnight (V8 accepts days up to 31 and rolls over), a date-time without
// zone is local time. Other text is an Invalid Date.
func parseJSDate(s string, loc *time.Location) (time.Time, bool) {
	if m := isoDateOnly.FindStringSubmatch(s); m != nil {
		y, _ := strconv.Atoi(m[1])
		mo, _ := strconv.Atoi(m[2])
		d, _ := strconv.Atoi(m[3])
		if mo < 1 || mo > 12 || d < 1 || d > 31 {
			return time.Time{}, false
		}
		return time.Date(y, time.Month(mo), d, 0, 0, 0, 0, time.UTC), true
	}
	if !isoDateTime.MatchString(s) {
		return time.Time{}, false
	}
	for _, layout := range []string{"2006-01-02T15:04:05.999999999Z07:00", "2006-01-02T15:04Z07:00"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Truncate(time.Millisecond), true
		}
	}
	for _, layout := range []string{"2006-01-02T15:04:05.999999999", "2006-01-02T15:04"} {
		if t, err := time.ParseInLocation(layout, s, loc); err == nil {
			return t.Truncate(time.Millisecond), true
		}
	}
	return time.Time{}, false
}

// alertLevel is `qty_onhand === 0 ? "critical" : "warning"`. node-postgres
// hands numeric over as a string, so in practice every alert is a warning.
func alertLevel(qty any) string {
	if qty == 0.0 {
		return "critical"
	}
	return "warning"
}

// poValue is `toQty(po.grand_total || po.total)`.
func poValue(po *Row) float64 { return toNum(orValue(po.Get("grand_total"), po.Get("total"))) }

func sumPoValue(rows []*Row) float64 {
	sum := 0.0
	for _, po := range rows {
		sum += poValue(po)
	}
	return sum
}

// percentChange is the change in percent with one decimal; 0 when the
// previous period is empty.
func percentChange(current, previous float64) float64 {
	if !(previous > 0) {
		return 0
	}
	return jsmath.Round(float64(float64((current-previous)/previous)*100)*10) / 10
}

// daysOverdue is Math.max(0, floor((now - expected) / day)); 0 without a date.
func daysOverdue(expected any, now time.Time) float64 {
	t, ok := expected.(httpx.JSTime)
	if !ok {
		return 0
	}
	ms := now.UnixMilli() - time.Time(t).UnixMilli()
	return math.Max(0, math.Floor(float64(ms)/float64(24*time.Hour/time.Millisecond)))
}

// monthlyTrends is buildMonthlyTrends: PO value per local short month
// ("Okt"), split by source_type ("manual" when empty), in first-seen order.
func monthlyTrends(rows []*Row, now time.Time, loc *time.Location) []*Row {
	out := []*Row{}
	byMonth := map[string]*Row{}
	for _, po := range rows {
		at := now
		if t, ok := po.Get("created_at").(httpx.JSTime); ok {
			at = time.Time(t)
		}
		month := idShortMonths[at.In(loc).Month()-1]
		bucket := byMonth[month]
		if bucket == nil {
			bucket = obj("month", month)
			byMonth[month] = bucket
			out = append(out, bucket)
		}
		category, _ := orValue(po.Get("source_type"), "manual").(string)
		bucket.Set(category, toNum(bucket.Get(category))+poValue(po))
	}
	return out
}

// orValue is `a || b` for node-postgres values.
func orValue(a, b any) any {
	switch x := a.(type) {
	case nil:
		return b
	case string:
		if x == "" {
			return b
		}
	case bool:
		if !x {
			return b
		}
	case float64:
		if x == 0 || math.IsNaN(x) {
			return b
		}
	case int:
		if x == 0 {
			return b
		}
	}
	return a
}
