package posops

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/posops/domain"
)

// ClosingReport mirrors GET /api/pos/reports/closing: the cashier closing
// (daily sales) report of one WIB day, optionally one shift, with targets
// from Settings. printedBy is the caller's name.
func (s *Service) ClosingReport(ctx context.Context, date string, shiftID *string, printedBy string) (*Obj, error) {
	if date == "" {
		date = domain.WibDateKey(s.now())
	}
	startIso, endIso := date+"T00:00:00.000+07:00", date+"T23:59:59.999+07:00"
	orders, err := s.ports.Sales.ClosingOrders(ctx, s.db, startIso, endIso, shiftID)
	if err != nil {
		return nil, err
	}
	shifts, err := closingShifts(ctx, s.db, startIso, endIso)
	if err != nil {
		return nil, err
	}
	setting := func(key string) *string {
		v, err := s.ports.Directory.Setting(ctx, s.db, key)
		if err != nil {
			return nil // getSettings(...).catch(() => ({}))
		}
		return v
	}
	monthlyTarget := numOrZero(setting("pos_monthly_sales_target"))
	dailyTarget := numOrZero(setting("pos_daily_sales_target"))
	outletSetting := nonEmptyPtr(setting("pos_outlet_name"))

	var branchIDs []string
	for _, sh := range shifts {
		if sh.BranchID != nil && *sh.BranchID != "" && !slices.Contains(branchIDs, *sh.BranchID) {
			branchIDs = append(branchIDs, *sh.BranchID)
		}
	}
	branches := map[string]Branch{}
	if len(branchIDs) > 0 {
		if b, err := s.ports.Directory.Branches(ctx, s.db, branchIDs); err == nil {
			branches = b
		}
	}
	ids := make([]string, len(orders))
	for i, o := range orders {
		ids[i] = o.ID
	}
	var lines []SaleLine
	if len(ids) > 0 {
		if lines, err = s.ports.Sales.SaleLines(ctx, s.db, ids); err != nil {
			return nil, err
		}
	}
	// The TS ignores these two reads' errors.
	categoryNames, _ := posCategoryNames(ctx, s.db, lineProductIDs(lines), "Others")

	var netSales, service, tax, discount float64
	amounts := make([]domain.ClosingOrderAmounts, len(orders))
	dineIn := 0
	for i, o := range orders {
		sub, disc := numOrZero(o.Subtotal), numOrZero(o.DiscountAmount)
		netSales += sub - disc
		service += numOrZero(o.ServiceCharge)
		tax += numOrZero(o.TaxAmount)
		discount += disc
		amounts[i] = domain.ClosingOrderAmounts{Subtotal: sub, Discount: disc, Total: numOrZero(o.TotalAmount)}
		if o.OrderType != nil && *o.OrderType == "dine_in" {
			dineIn++
		}
	}
	netSales, service, tax, discount = domain.RoundCurrency(netSales), domain.RoundCurrency(service),
		domain.RoundCurrency(tax), domain.RoundCurrency(discount)
	gross := domain.RoundCurrency(netSales + service + tax)
	guests := dineIn
	if guests == 0 {
		guests = len(orders)
	}
	perPax := 0.0
	if guests > 0 {
		perPax = domain.RoundCurrency(netSales / float64(guests))
	}

	type segmentTotal struct {
		segment, name string
		amount        float64
	}
	var catOrder []string
	catTotals := map[string]*segmentTotal{}
	for _, l := range lines {
		name := "Others"
		if l.ProductID != nil {
			if n := categoryNames[*l.ProductID]; n != nil {
				name = *n
			}
		}
		seg := domain.Segment(l.Station)
		key := seg + ":" + name
		if catTotals[key] == nil {
			catTotals[key] = &segmentTotal{segment: seg, name: name}
			catOrder = append(catOrder, key)
		}
		catTotals[key].amount += numOrZero(l.TotalAmount)
	}
	var bySegment []*Obj
	for _, seg := range []string{"FNB", "BEV", "OTHER"} {
		type row struct {
			name        string
			amount, pct float64
		}
		var rows []row
		for _, k := range catOrder {
			if c := catTotals[k]; c.segment == seg {
				rows = append(rows, row{c.name, domain.RoundCurrency(c.amount), domain.Percentage(c.amount, netSales)})
			}
		}
		sort.SliceStable(rows, func(i, j int) bool { return rows[i].amount > rows[j].amount })
		if len(rows) == 0 {
			rows = append(rows, row{name: "Others"})
		}
		out := make([]*Obj, len(rows))
		for i, r := range rows {
			out[i] = NewObj("name", r.name, "amount", r.amount, "percentage", r.pct)
		}
		bySegment = append(bySegment, NewObj("segment", seg,
			"title", "SALES BY CATEGORY "+strings.ToUpper(domain.SegmentLabels[seg]), "rows", out))
	}

	type promo struct {
		segment, name string
		qty           float64
	}
	var promoOrder []string
	promos := map[string]*promo{}
	addPromo := func(seg, name string, qty float64) {
		key := seg + ":" + name
		if promos[key] == nil {
			promos[key] = &promo{segment: seg, name: name}
			promoOrder = append(promoOrder, key)
		}
		promos[key].qty += qty
	}
	for _, l := range lines {
		if numOrZero(l.DiscountAmount) <= 0 {
			continue
		}
		addPromo(domain.Segment(l.Station), orDefault(nonEmptyPtr(l.ProductName), "Promo Item"), numOrZero(l.Quantity))
	}
	for _, o := range orders {
		if r := nonEmptyPtr(o.DiscountReason); r != nil {
			addPromo("FNB", *r, 1)
		}
	}
	var promosBySegment []*Obj
	for _, seg := range []string{"FNB", "BEV"} {
		type row struct {
			name string
			qty  float64
		}
		var rows []row
		for _, k := range promoOrder {
			if p := promos[k]; p.segment == seg {
				rows = append(rows, row{p.name, domain.Round(p.qty)})
			}
		}
		sort.SliceStable(rows, func(i, j int) bool { return rows[i].qty > rows[j].qty })
		out := make([]*Obj, len(rows))
		for i, r := range rows {
			out[i] = NewObj("name", r.name, "qty", r.qty)
		}
		promosBySegment = append(promosBySegment, NewObj("segment", seg,
			"title", "PROMO "+strings.ToUpper(domain.SegmentLabels[seg]), "rows", out))
	}

	lastOrder := func(list []ClosingOrder) *time.Time {
		var latest *time.Time
		for _, o := range list {
			stamp := o.CompletedAt
			if stamp == nil {
				stamp = o.OrderedAt
			}
			if stamp != nil && (latest == nil || stamp.After(*latest)) {
				latest = stamp
			}
		}
		return latest
	}
	var sessions []*Obj
	if len(shifts) == 0 {
		var closedAt *time.Time
		if len(orders) > 0 {
			end, _ := time.Parse("2006-01-02T15:04:05.000-07:00", endIso)
			closedAt = &end
		}
		sessions = append(sessions, NewObj("label", "All", "last_order", domain.ReportClock(lastOrder(orders)),
			"closed_at", domain.ReportClock(closedAt)))
	}
	var outletNames []string
	for _, sh := range shifts {
		var shiftOrders []ClosingOrder
		for _, o := range orders {
			if o.ShiftID != nil && *o.ShiftID == sh.ID {
				shiftOrders = append(shiftOrders, o)
			}
		}
		label := "Shift"
		b, hasBranch := Branch{}, false
		if sh.BranchID != nil {
			b, hasBranch = branches[*sh.BranchID]
		}
		switch {
		case hasBranch && nonEmptyPtr(b.Code) != nil:
			label = *b.Code
		case hasBranch && nonEmptyPtr(b.Name) != nil:
			label = *b.Name
		case nonEmptyPtr(sh.ShiftNumber) != nil:
			label = *sh.ShiftNumber
		}
		sessions = append(sessions, NewObj("label", label, "last_order", domain.ReportClock(lastOrder(shiftOrders)),
			"closed_at", domain.ReportClock(sh.ClosedAt)))
		if hasBranch {
			name := orDefault(nonEmptyPtr(b.Name), orDefault(nonEmptyPtr(b.Code), ""))
			if name != "" && !slices.Contains(outletNames, name) {
				outletNames = append(outletNames, name)
			}
		}
	}

	day, ok := domain.CalendarDay(date)
	if !ok {
		return nil, &jsError{msg: "Invalid time value"}
	}
	daysInMonth := time.Date(day.Year(), day.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	monthStart := day.Format("2006-01") + "-01T00:00:00.000+07:00"
	monthEnd := day.Format("2006-01") + "-" + fmt.Sprintf("%02d", daysInMonth) + "T23:59:59.999+07:00"
	netOf := func(list []ClosingOrder) float64 {
		sum := 0.0
		for _, o := range list {
			sum = sum + numOrZero(o.Subtotal) - numOrZero(o.DiscountAmount)
		}
		return domain.RoundCurrency(sum)
	}
	monthOrders, _ := s.ports.Sales.ClosingOrders(ctx, s.db, monthStart, monthEnd, nil)
	mtdOrders, _ := s.ports.Sales.ClosingOrders(ctx, s.db, monthStart, endIso, nil)
	computedDaily := dailyTarget
	if computedDaily <= 0 {
		computedDaily = 0
		if monthlyTarget > 0 {
			computedDaily = monthlyTarget / float64(daysInMonth)
		}
	}
	mtdTarget := computedDaily * float64(day.Day())
	if monthlyTarget > 0 {
		mtdTarget = monthlyTarget / float64(daysInMonth) * float64(day.Day())
	}
	outletLine := strings.Join(outletNames, " & ")
	if outletLine == "" {
		outletLine = orDefault(outletSetting, "Outlet")
	}

	return NewObj(
		"filters", NewObj("date", date, "shift_id", shiftID),
		"header", NewObj("title", "Daily Report Sales "+outletLine, "outlet_line", outletLine,
			"report_date", domain.ReportDateTitle(day)),
		"shift_sessions", sessions,
		"sales_summary", NewObj("net_sales", netSales, "service", service, "tax", tax, "discount", discount, "gross", gross),
		"transaction_totals", domain.SummarizeClosingTransactions(amounts),
		"guests", NewObj("count", guests, "average_per_pax", perPax),
		"categories_by_segment", bySegment,
		"targets", NewObj(
			"daily", domain.NewTargetBlock(netSales, computedDaily),
			"monthly", domain.NewTargetBlock(netOf(monthOrders), monthlyTarget),
			"month_to_date", domain.NewTargetBlock(netOf(mtdOrders), mtdTarget),
		),
		"promos_by_segment", promosBySegment,
		"footer", NewObj("printed_by", printedBy),
	), nil
}
