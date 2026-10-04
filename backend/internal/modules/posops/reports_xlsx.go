package posops

import (
	"encoding/json"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/xlsx"
)

// POS report workbooks: the plain ?format=xlsx sheets of product sales and
// transactions (lib/pos/reports/*-export.ts), the rush hour export
// (lib/pos/rush-hour-xlsx.ts) and the styled /export workbooks
// (lib/pos/report-excel/builders.ts).

/* ── Transaction labels (lib/pos/reports/transaction-labels.ts) ──────── */

// labelKey is String(value || "").trim().toLowerCase().
func labelKey(v *string) string { return strings.ToLower(domain.TrimJS(orDefault(v, ""))) }

var paymentStatusLabels = map[string]string{"paid": "Lunas", "unpaid": "Belum lunas", "partial": "Sebagian", "refunded": "Refund"}

// paymentStatusLabel is formatPaymentStatusLabel: payment first, then the
// kitchen status.
func paymentStatusLabel(paymentStatus, kitchenStatus *string) string {
	if l, ok := paymentStatusLabels[labelKey(paymentStatus)]; ok {
		return l
	}
	switch labelKey(kitchenStatus) {
	case "completed":
		return "Lunas"
	case "cancelled":
		return "Dibatalkan"
	case "voided":
		return "Void"
	}
	if nonEmptyPtr(paymentStatus) != nil || nonEmptyPtr(kitchenStatus) != nil {
		return "Belum lunas"
	}
	return "—"
}

// soldFromLabel is formatSoldFromLabel.
func soldFromLabel(soldFrom *string) string {
	switch labelKey(soldFrom) {
	case "central":
		return "Kasir pusat"
	case "stall":
		return "Kasir stall"
	}
	if s := domain.TrimJS(orDefault(soldFrom, "")); s != "" {
		return s
	}
	return "—"
}

// reportStallLabel is formatReportStallLabel: never a raw UUID.
func reportStallLabel(name, code *string) string {
	for _, v := range []*string{name, code} {
		if s := domain.TrimJS(orDefault(v, "")); s != "" && !reportStallID.MatchString(s) {
			return s
		}
	}
	return "—"
}

var compTypeLabels = map[string]string{"kol_comp": "KOL Comp", "foc_comp": "FOC", "owner_comp": "Owner Comp"}

// compTypeLabel is formatCompTypeLabel ("" for a paid order).
func compTypeLabel(compType *string) string { return compTypeLabels[labelKey(compType)] }

// transactionMethodLabel is the export's methodLabel: the comp type, else
// the payment method label.
func transactionMethodLabel(row TransactionLine) string {
	if comp := compTypeLabel(row.CompType); comp != "" {
		return comp
	}
	return domain.PaymentMethodLabel(orDefault(row.PaymentMethod, ""), orDefault(row.PaymentMethodCode, ""),
		orDefault(row.PaymentMethodName, ""))
}

/* ── Plain sheets (?format=xlsx) ─────────────────────────────────────── */

// plainSheets is posReportXlsxResponse's sheet list: names cut to 31
// characters, the Excel limit.
func plainSheets(sheets ...xlsx.SheetSpec) []xlsx.SheetSpec {
	for i := range sheets {
		if r := []rune(sheets[i].Name); len(r) > 31 {
			sheets[i].Name = string(r[:31])
		}
	}
	return sheets
}

func productSalesFileName(f reportFilters) string {
	return "penjualan-produk-" + f.DateFrom + "_" + f.DateTo + ".xlsx"
}

func transactionFileName(f reportFilters) string {
	return "transaksi-pos-" + f.DateFrom + "_" + f.DateTo + ".xlsx"
}

func periodRow(f reportFilters) []any { return []any{"Periode", f.DateFrom + " s/d " + f.DateTo} }

// productSalesSheets is buildProductSalesExportSheets.
func productSalesSheets(r *ProductSalesReport) []xlsx.SheetSpec {
	rows := [][]any{{"Produk", "SKU", "Stall", "Qty", "Orders", "Omzet"}}
	for _, x := range r.Rows {
		rows = append(rows, []any{x.ProductName, orDefault(nonEmptyPtr(x.ProductSku), "—"),
			reportStallLabel(x.StallName, x.StallCode), x.Quantity, x.OrderCount, x.Revenue})
	}
	return plainSheets(
		xlsx.SheetSpec{Name: "Ringkasan", Rows: [][]any{
			{"Laporan Penjualan Produk"},
			periodRow(r.Filters),
			{"Stall", r.stallFilterLabel()},
			{},
			{"Metrik", "Nilai"},
			{"Produk terjual", r.Summary.Products},
			{"Total qty", r.Summary.Quantity},
			{"Total omzet", r.Summary.Revenue},
		}},
		xlsx.SheetSpec{Name: "Produk", Rows: rows},
	)
}

// transactionSheets is buildTransactionExportSheets. Waktu is the order
// time as a date cell, like the Date ExcelJS receives.
func transactionSheets(r *TransactionReport) []xlsx.SheetSpec {
	s := r.Summary
	perStall := [][]any{{"Stall", "Transaksi", "Item Terjual", "Penjualan"}}
	for _, x := range r.PerStall {
		perStall = append(perStall, []any{reportStallLabel(&x.StallName, x.StallCode), x.Transactions, x.Quantity, x.Sales})
	}
	top := [][]any{{"Produk", "Qty", "Omzet"}}
	for _, x := range r.TopProducts {
		top = append(top, []any{x.ProductName, x.Quantity, x.Revenue})
	}
	daily := [][]any{{"Tanggal", "Transaksi", "Nett"}}
	for _, x := range r.Daily {
		daily = append(daily, []any{x.Date, x.Transactions, x.Nett})
	}
	detail := [][]any{{"Order", "Checkout", "Waktu", "Stall", "Metode", "Subtotal", "Diskon", "Pajak", "Total",
		"Service", "ARK", "Pembayaran", "Asal", "Comp"}}
	for _, x := range r.Rows {
		var at any = ""
		if x.OrderedAt != nil {
			at = time.Time(*x.OrderedAt).UTC()
		}
		detail = append(detail, []any{orDefault(nonEmptyPtr(x.OrderNumber), x.ID), orDefault(x.CheckoutNumber, ""), at,
			reportStallLabel(x.StallName, x.StallCode), transactionMethodLabel(x), x.Subtotal, x.DiscountAmount,
			x.TaxAmount, x.TotalAmount, x.ServiceChargeAmount, x.ArkCoinsUsed,
			paymentStatusLabel(x.PaymentStatus, x.Status), soldFromLabel(x.SoldFrom), compTypeLabel(x.CompType)})
	}
	return plainSheets(
		xlsx.SheetSpec{Name: "Ringkasan", Rows: [][]any{
			{"Laporan Transaksi POS"},
			periodRow(r.Filters),
			{"Stall", r.stallFilterLabel()},
			{},
			{"Metrik", "Nilai"},
			{"Transaksi", s.Transactions},
			{"Revenue (kotor)", s.Revenue},
			{"Diskon", s.Discount},
			{"Pajak", s.Tax},
			{"Service", s.Service},
			{"Nett", s.Nett},
			{"ARK terpakai", s.TotalArkUsed},
		}},
		xlsx.SheetSpec{Name: "Per Stall", Rows: perStall},
		xlsx.SheetSpec{Name: "Top Produk", Rows: top},
		xlsx.SheetSpec{Name: "Harian", Rows: daily},
		xlsx.SheetSpec{Name: "Transaksi", Rows: detail},
	)
}

/* ── Rush hour export (lib/pos/rush-hour-xlsx.ts) ────────────────────── */

// hourRange is buildHourRangeContribution: the sales of hours from..to
// (inclusive, clamped) and their share of the totals.
type hourRange struct {
	From, To                        int
	Transactions, Revenue, Qty      float64
	ShareRevenue, ShareQty, ShareTx float64
}

// sharePct is Math.round(part / total * 1000) / 10, 0 without a total.
func sharePct(part, total float64) float64 {
	if total <= 0 {
		return 0
	}
	return domain.Round(part/total*1000) / 10
}

func hourRangeContribution(rep domain.RushHourReport, fromHour, toHour float64) hourRange {
	from := int(min(23, max(0, math.Floor(fromHour))))
	to := int(min(23, max(float64(from), math.Floor(toHour))))
	out := hourRange{From: from, To: to}
	revenue := 0.0
	for _, b := range rep.Hourly {
		if b.Hour >= from && b.Hour <= to {
			out.Transactions += b.Transactions
			revenue += b.Revenue
			out.Qty += b.Quantity
		}
	}
	out.Revenue = domain.RoundCurrency(revenue)
	out.ShareRevenue = sharePct(out.Revenue, rep.Summary.Revenue)
	out.ShareQty = sharePct(out.Qty, rep.Summary.Quantity)
	out.ShareTx = sharePct(out.Transactions, rep.Summary.Transactions)
	return out
}

// clampHour is the export's clampHour: Number(value) when it is a whole
// hour 0..23, else fallback. A missing value is Number(null), so 0.
func clampHour(value string, fallback float64) float64 {
	n := domain.Number(value)
	if n == math.Trunc(n) && n >= 0 && n <= 23 {
		return n
	}
	return fallback
}

// rushHourMeta is RushHourXlsxMeta.
type rushHourMeta struct {
	company, period, stall string
	rangeFrom, rangeTo     float64
	generatedAt            time.Time
}

// printedLine is "Dicetak: <WIB medium date, short time> WIB".
func printedLine(at time.Time) string { return "Dicetak: " + domain.WibDateTime(&at) + " WIB" }

// rupiahText is `Rp ${Math.round(v).toLocaleString("id-ID")}`.
func rupiahText(v float64) string { return "Rp " + domain.GroupThousands(domain.Round(v)) }

// peakText is the "<n> transaksi" of a peak.
func peakText(transactions float64) string { return domain.FormatNumber(transactions) + " transaksi" }

func titleMerges(cols int, rows ...int) []xlsx.Merge {
	out := make([]xlsx.Merge, len(rows))
	for i, r := range rows {
		out[i] = xlsx.Merge{R1: r, C1: 0, R2: r, C2: cols - 1}
	}
	return out
}

// rushHourSheets is buildRushHourXlsx: Ringkasan, Per Jam, Per Hari, Heatmap.
func rushHourSheets(rep domain.RushHourReport, m rushHourMeta) []xlsx.SheetSpec {
	s := rep.Summary
	rg := hourRangeContribution(rep, m.rangeFrom, m.rangeTo)
	sub := "Periode: " + m.period + " · Stall: " + m.stall
	peakLabel := func(l *string) string { return orDefault(l, "—") }

	ringkasan := [][]any{
		{m.company + " — Report Rush Hour"},
		{"Periode: " + m.period},
		{"Stall: " + m.stall},
		{printedLine(m.generatedAt)},
		{},
		{"TOTAL KESELURUHAN"},
		{"Jumlah transaksi", s.Transactions},
		{"Omzet (Rp)", domain.Round(s.Revenue)},
		{"Item terjual", s.Quantity},
		{"Rata-rata bill (Rp)", domain.Round(s.AverageTicket)},
		{},
		{"PUNCAK"},
		{"Jam tersibuk", peakLabel(rep.PeakHour.HourLabel), peakText(rep.PeakHour.Transactions)},
		{"Jam omzet tertinggi", peakLabel(rep.PeakRevenueHour.HourLabel), rupiahText(rep.PeakRevenueHour.Revenue)},
		{"Hari tersibuk", peakLabel(rep.PeakDay.DowLabel), peakText(rep.PeakDay.Transactions)},
		{},
		{"KONTRIBUSI RENTANG JAM " + domain.HourLabel(rg.From) + "–" + domain.HourLabel(rg.To)},
		{"Berdasarkan", "Nilai dalam rentang", "Total keseluruhan", "Kontribusi (%)"},
		{"Amount / omzet (Rp)", domain.Round(rg.Revenue), domain.Round(s.Revenue), rg.ShareRevenue},
		{"Quantity / item terjual", rg.Qty, s.Quantity, rg.ShareQty},
		{"Jumlah transaksi", rg.Transactions, s.Transactions, rg.ShareTx},
	}

	perJam := [][]any{{m.company + " — Rush Hour per Jam"}, {sub}, {},
		{"Jam", "Transaksi", "Omzet (Rp)", "Item Terjual", "Rata-rata Bill (Rp)", "% Omzet", "% Item"}}
	for _, b := range rep.Hourly {
		perJam = append(perJam, []any{b.Label, b.Transactions, domain.Round(b.Revenue), b.Quantity,
			domain.Round(b.AverageTicket), sharePct(b.Revenue, s.Revenue), sharePct(b.Quantity, s.Quantity)})
	}
	full := func(total float64) float64 {
		if total > 0 {
			return 100
		}
		return 0
	}
	perJam = append(perJam, []any{"TOTAL", s.Transactions, domain.Round(s.Revenue), s.Quantity,
		domain.Round(s.AverageTicket), full(s.Revenue), full(s.Quantity)})

	perHari := [][]any{{m.company + " — Rush Hour per Hari"}, {sub}, {}, {"Hari", "Transaksi", "Omzet (Rp)"}}
	for _, d := range rep.Weekdays {
		perHari = append(perHari, []any{d.Label, d.Transactions, domain.Round(d.Revenue)})
	}

	heatHeader := []any{`Hari \ Jam`}
	heatWidths := []float64{11}
	for _, h := range domain.RushHourHeatmapHours {
		heatHeader = append(heatHeader, domain.HourLabel(h))
		heatWidths = append(heatWidths, 7)
	}
	heatmap := [][]any{{m.company + " — Heatmap Transaksi (hari × jam)"}, {sub}, {}, heatHeader}
	for _, d := range rep.Weekdays {
		row := []any{d.Label}
		for _, h := range domain.RushHourHeatmapHours {
			tx := 0.0
			if i := slices.IndexFunc(rep.Heatmap, func(c domain.RushHourCell) bool { return c.Dow == d.Dow && c.Hour == h }); i >= 0 {
				tx = rep.Heatmap[i].Transactions
			}
			row = append(row, tx)
		}
		heatmap = append(heatmap, row)
	}

	return []xlsx.SheetSpec{
		{Name: "Ringkasan", Rows: ringkasan, ColumnWidths: []float64{26, 20, 20, 16}, Merges: titleMerges(4, 0, 1, 2, 3, 5, 11, 17)},
		{Name: "Per Jam", Rows: perJam, ColumnWidths: []float64{8, 11, 16, 13, 18, 9, 9}, Merges: titleMerges(7, 0, 1)},
		{Name: "Per Hari", Rows: perHari, ColumnWidths: []float64{10, 11, 16}, Merges: titleMerges(3, 0, 1)},
		{Name: "Heatmap", Rows: heatmap, ColumnWidths: heatWidths, Merges: titleMerges(len(heatHeader), 0, 1)},
	}
}

/* ── Styled /export workbooks (lib/pos/report-excel/builders.ts) ─────── */

// exportMeta is ExportMeta.
type exportMeta struct {
	company, stall string
	generatedAt    time.Time
}

// exportLabels are REPORT_EXPORTS' labels; the label names the file.
var exportLabels = map[string]string{
	"profit": "Profit", "revenue-composition": "Revenue Composition", "transactions": "Transaksi",
	"rush-hour": "Rush Hour", "voids": "Void", "product-sales": "Product Sales", "payment-methods": "Payment Methods",
}

var whitespaceRun = regexp.MustCompile(`\s+`)

// exportFileName is `${label.toLowerCase().replace(/\s+/g, "-")}_${from}_${to}.xlsx`.
func exportFileName(key, from, to string) string {
	return whitespaceRun.ReplaceAllString(strings.ToLower(exportLabels[key]), "-") + "_" + from + "_" + to + ".xlsx"
}

func round0(v float64) float64 { return domain.Round(v) }
func round2(v float64) float64 { return domain.RoundCurrency(v) }

// periodLabel is formatPeriodLabel: "1 Sep 2026" or "1 Sep 2026 s.d. 5 Sep 2026".
func periodLabel(from, to string) string {
	if from == to {
		return domain.PeriodLabel(from, "day")
	}
	return domain.PeriodLabel(from, "day") + " s.d. " + domain.PeriodLabel(to, "day")
}

// wibDateTime is the 2-digit WIB date and time of a text cell, "—" for none.
func wibDateTime(t *time.Time) string {
	if t == nil {
		return "—"
	}
	w := t.In(domain.Jakarta)
	date := domain.PeriodLabel(w.Format("2006-01-02"), "day")
	if w.Day() < 10 {
		date = "0" + date
	}
	return date + ", " + w.Format("15.04")
}

func titleLines(f reportFilters, m exportMeta) []string {
	return []string{"Periode: " + periodLabel(f.DateFrom, f.DateTo), "Stall: " + m.stall, printedLine(m.generatedAt)}
}

// sheetTitle is "<name> — <period>".
func sheetTitle(name string, f reportFilters) string {
	return name + " — " + periodLabel(f.DateFrom, f.DateTo)
}

// sum adds f(x) over xs.
func sum[T any](xs []T, f func(T) float64) float64 {
	t := 0.0
	for _, x := range xs {
		t += f(x)
	}
	return t
}

// decodeAs turns a builder of a typed report into one of the report's JSON,
// as the TS export reads the report route's response.
func decodeAs[T any](build func(T, exportMeta) *xlsx.Report) func([]byte, exportMeta) (*xlsx.Report, error) {
	return func(raw []byte, m exportMeta) (*xlsx.Report, error) {
		var v T
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, err
		}
		return build(v, m), nil
	}
}

/* Profit */

type profitBucketJSON struct {
	Label          string  `json:"label"`
	Quantity       float64 `json:"quantity"`
	Revenue        float64 `json:"revenue"`
	Cogs           float64 `json:"cogs"`
	GrossProfit    float64 `json:"gross_profit"`
	GrossMarginPct float64 `json:"gross_margin_pct"`
}

type profitJSON struct {
	Filters reportFilters `json:"filters"`
	Summary struct {
		Orders, Items, Quantity, Revenue, Cogs float64
		GrossProfit                            float64 `json:"gross_profit"`
		GrossMarginPct                         float64 `json:"gross_margin_pct"`
		ZeroCostItems                          float64 `json:"zero_cost_items"`
	} `json:"summary"`
	Breakdowns struct {
		Products, Categories, Stations, Cashiers, Dates []profitBucketJSON
	} `json:"breakdowns"`
}

var profitCols = []xlsx.Col{
	{Header: "Nama", Width: 36}, {Header: "Qty", Fmt: xlsx.FmtQty, Width: 10}, {Header: "Omzet (Rp)", Fmt: xlsx.FmtRp, Width: 18},
	{Header: "HPP (Rp)", Fmt: xlsx.FmtRp, Width: 18}, {Header: "Laba Kotor (Rp)", Fmt: xlsx.FmtRp, Width: 18}, {Header: "Margin", Fmt: xlsx.FmtPct, Width: 10},
}

func profitRows(b []profitBucketJSON) [][]any {
	rows := make([][]any, len(b))
	for i, x := range b {
		rows[i] = []any{x.Label, round2(x.Quantity), round0(x.Revenue), round0(x.Cogs), round0(x.GrossProfit), round2(x.GrossMarginPct)}
	}
	return rows
}

func profitTotals(b []profitBucketJSON) []any {
	rev := sum(b, func(x profitBucketJSON) float64 { return x.Revenue })
	gp := sum(b, func(x profitBucketJSON) float64 { return x.GrossProfit })
	margin := 0.0
	if rev > 0 {
		margin = round2(gp / rev * 100)
	}
	return []any{"TOTAL", round2(sum(b, func(x profitBucketJSON) float64 { return x.Quantity })), round0(rev),
		round0(sum(b, func(x profitBucketJSON) float64 { return x.Cogs })), round0(gp), margin}
}

func profitWorkbook(r profitJSON, m exportMeta) *xlsx.Report {
	wb := xlsx.NewReport(m.generatedAt)
	ws := wb.Sheet("Ringkasan")
	s := r.Summary
	row := ws.TitleBlock(m.company+" — Laporan Profit", titleLines(r.Filters, m)...)
	row = ws.KeyValues(row, []xlsx.Pair{
		{Label: "Jumlah transaksi", Value: s.Orders, Fmt: xlsx.FmtNum}, {Label: "Jumlah baris item", Value: s.Items, Fmt: xlsx.FmtNum},
		{Label: "Qty terjual", Value: round2(s.Quantity), Fmt: xlsx.FmtQty}, {Label: "Omzet", Value: round0(s.Revenue), Fmt: xlsx.FmtRp},
		{Label: "HPP (COGS)", Value: round0(s.Cogs), Fmt: xlsx.FmtRp}, {Label: "Laba kotor", Value: round0(s.GrossProfit), Fmt: xlsx.FmtRp},
		{Label: "Margin kotor", Value: round2(s.GrossMarginPct), Fmt: xlsx.FmtPct}, {Label: "Item tanpa HPP (cost 0)", Value: s.ZeroCostItems, Fmt: xlsx.FmtNum},
	})
	row = ws.SectionTitle(row, "Per Tanggal")
	dateCols := append([]xlsx.Col{{Header: "Tanggal", Width: 16}}, profitCols[1:]...)
	ws.Table(row, dateCols, profitRows(r.Breakdowns.Dates), xlsx.TableOpts{Totals: profitTotals(r.Breakdowns.Dates)})
	b := r.Breakdowns
	for _, sheet := range []struct {
		name    string
		buckets []profitBucketJSON
	}{{"Per Produk", b.Products}, {"Per Kategori", b.Categories}, {"Per Station", b.Stations}, {"Per Kasir", b.Cashiers}} {
		s := wb.Sheet(sheet.name)
		start := s.TitleBlock(sheetTitle(sheet.name, r.Filters))
		s.Table(start, profitCols, profitRows(sheet.buckets), xlsx.TableOpts{Totals: profitTotals(sheet.buckets), FreezeHeader: true})
	}
	return wb
}

/* Revenue composition */

type revenueBucketJSON struct {
	Label         string  `json:"label"`
	Quantity      float64 `json:"quantity"`
	Sales         float64 `json:"sales"`
	Cost          float64 `json:"cost"`
	Margin        float64 `json:"margin"`
	CostPct       float64 `json:"cost_pct"`
	SalesSharePct float64 `json:"sales_share_pct"`
	QtySharePct   float64 `json:"qty_share_pct"`
}

type revenueJSON struct {
	Filters reportFilters `json:"filters"`
	Summary struct {
		Orders, Quantity, Sales, Cost, Margin float64
		CostPct                               float64 `json:"cost_pct"`
		ZeroCostItems                         float64 `json:"zero_cost_items"`
	} `json:"summary"`
	Groups []struct {
		revenueBucketJSON
		Categories []revenueBucketJSON `json:"categories"`
	} `json:"groups"`
	Daily []struct {
		Date     string            `json:"date"`
		Food     revenueBucketJSON `json:"food"`
		Beverage revenueBucketJSON `json:"beverage"`
	} `json:"daily"`
}

func revenueRow(b revenueBucketJSON) []any {
	return []any{b.Label, round2(b.Quantity), round0(b.Sales), round0(b.Cost), round0(b.Margin), round2(b.CostPct),
		round2(b.SalesSharePct), round2(b.QtySharePct)}
}

func revenueWorkbook(r revenueJSON, m exportMeta) *xlsx.Report {
	wb := xlsx.NewReport(m.generatedAt)
	ws := wb.Sheet("Ringkasan")
	s := r.Summary
	row := ws.TitleBlock(m.company+" — Laporan Revenue Composition", titleLines(r.Filters, m)...)
	row = ws.KeyValues(row, []xlsx.Pair{
		{Label: "Jumlah transaksi", Value: s.Orders, Fmt: xlsx.FmtNum}, {Label: "Qty terjual", Value: round2(s.Quantity), Fmt: xlsx.FmtQty},
		{Label: "Penjualan", Value: round0(s.Sales), Fmt: xlsx.FmtRp}, {Label: "Biaya (HPP)", Value: round0(s.Cost), Fmt: xlsx.FmtRp},
		{Label: "Margin", Value: round0(s.Margin), Fmt: xlsx.FmtRp}, {Label: "Rasio biaya", Value: round2(s.CostPct), Fmt: xlsx.FmtPct},
		{Label: "Item tanpa HPP (cost 0)", Value: s.ZeroCostItems, Fmt: xlsx.FmtNum},
	})
	cols := []xlsx.Col{
		{Header: "Kelompok / Kategori", Width: 34}, {Header: "Qty", Fmt: xlsx.FmtQty, Width: 10}, {Header: "Penjualan (Rp)", Fmt: xlsx.FmtRp, Width: 18},
		{Header: "Biaya (Rp)", Fmt: xlsx.FmtRp, Width: 16}, {Header: "Margin (Rp)", Fmt: xlsx.FmtRp, Width: 16}, {Header: "Rasio biaya", Fmt: xlsx.FmtPct, Width: 12},
		{Header: "Share penjualan", Fmt: xlsx.FmtPct, Width: 14}, {Header: "Share qty", Fmt: xlsx.FmtPct, Width: 12},
	}
	row = ws.SectionTitle(row, "Food vs Beverage")
	groups := make([][]any, len(r.Groups))
	for i, g := range r.Groups {
		groups[i] = revenueRow(g.revenueBucketJSON)
	}
	row = ws.Table(row, cols, groups, xlsx.TableOpts{})
	for _, g := range r.Groups {
		row = ws.SectionTitle(row, "Kategori "+g.Label)
		cats := make([][]any, len(g.Categories))
		for i, c := range g.Categories {
			cats[i] = revenueRow(c)
		}
		row = ws.Table(row, cols, cats, xlsx.TableOpts{})
	}
	d := wb.Sheet("Harian")
	start := d.TitleBlock(sheetTitle("Harian", r.Filters))
	days := make([][]any, len(r.Daily))
	for i, x := range r.Daily {
		days[i] = []any{x.Date, round2(x.Food.Quantity), round0(x.Food.Sales), round2(x.Food.SalesSharePct),
			round2(x.Beverage.Quantity), round0(x.Beverage.Sales), round2(x.Beverage.SalesSharePct), round0(x.Food.Sales + x.Beverage.Sales)}
	}
	d.Table(start, []xlsx.Col{
		{Header: "Tanggal", Width: 14}, {Header: "Food Qty", Fmt: xlsx.FmtQty, Width: 10}, {Header: "Food (Rp)", Fmt: xlsx.FmtRp, Width: 16},
		{Header: "Food share", Fmt: xlsx.FmtPct, Width: 11}, {Header: "Beverage Qty", Fmt: xlsx.FmtQty, Width: 12},
		{Header: "Beverage (Rp)", Fmt: xlsx.FmtRp, Width: 16}, {Header: "Beverage share", Fmt: xlsx.FmtPct, Width: 13}, {Header: "Total (Rp)", Fmt: xlsx.FmtRp, Width: 16},
	}, days, xlsx.TableOpts{FreezeHeader: true})
	return wb
}

/* Transactions */

type transactionsJSON struct {
	Filters     reportFilters      `json:"filters"`
	Summary     TransactionSummary `json:"summary"`
	PerStall    []StallSales       `json:"per_stall"`
	TopProducts []TopProduct       `json:"top_products"`
	Daily       []DailySales       `json:"daily"`
	Rows        []struct {
		OrderNumber       string     `json:"order_number"`
		OrderedAt         *time.Time `json:"ordered_at"`
		CheckoutNumber    string     `json:"checkout_number"`
		StallName         string     `json:"stall_name"`
		PaymentMethod     string     `json:"payment_method"`
		PaymentMethodName string     `json:"payment_method_name"`
		Subtotal          float64    `json:"subtotal"`
		DiscountAmount    float64    `json:"discount_amount"`
		TaxAmount         float64    `json:"tax_amount"`
		ServiceCharge     float64    `json:"service_charge_amount"`
		TotalAmount       float64    `json:"total_amount"`
		ArkCoinsUsed      float64    `json:"ark_coins_used"`
		Status            string     `json:"status"`
		CompType          string     `json:"comp_type"`
		CompApprovedName  string     `json:"comp_approved_name"`
	} `json:"rows"`
}

func transactionsWorkbook(r transactionsJSON, m exportMeta) *xlsx.Report {
	wb := xlsx.NewReport(m.generatedAt)
	ws := wb.Sheet("Ringkasan")
	s := r.Summary
	row := ws.TitleBlock(m.company+" — Laporan Transaksi", titleLines(r.Filters, m)...)
	row = ws.KeyValues(row, []xlsx.Pair{
		{Label: "Jumlah transaksi", Value: s.Transactions, Fmt: xlsx.FmtNum}, {Label: "Omzet (sebelum diskon/pajak)", Value: round0(s.Revenue), Fmt: xlsx.FmtRp},
		{Label: "Diskon", Value: round0(s.Discount), Fmt: xlsx.FmtRp}, {Label: "Pajak", Value: round0(s.Tax), Fmt: xlsx.FmtRp},
		{Label: "Service", Value: round0(s.Service), Fmt: xlsx.FmtRp}, {Label: "Nett (dibayar pelanggan)", Value: round0(s.Nett), Fmt: xlsx.FmtRp},
		{Label: "ARK Coin terpakai", Value: round0(s.TotalArkUsed), Fmt: xlsx.FmtNum},
	})
	row = ws.SectionTitle(row, "Per Stall")
	stalls := make([][]any, len(r.PerStall))
	for i, x := range r.PerStall {
		stalls[i] = []any{x.StallName, orDefault(x.StallCode, ""), x.Transactions, round2(x.Quantity), round0(x.Sales)}
	}
	row = ws.Table(row, []xlsx.Col{{Header: "Stall", Width: 28}, {Header: "Kode", Width: 12}, {Header: "Transaksi", Fmt: xlsx.FmtNum, Width: 12},
		{Header: "Qty", Fmt: xlsx.FmtQty, Width: 10}, {Header: "Penjualan (Rp)", Fmt: xlsx.FmtRp, Width: 18}}, stalls, xlsx.TableOpts{})
	row = ws.SectionTitle(row, "Produk Terlaris")
	top := make([][]any, len(r.TopProducts))
	for i, x := range r.TopProducts {
		top[i] = []any{x.ProductName, round2(x.Quantity), round0(x.Revenue)}
	}
	ws.Table(row, []xlsx.Col{{Header: "Produk", Width: 36}, {Header: "Qty", Fmt: xlsx.FmtQty, Width: 10}, {Header: "Omzet (Rp)", Fmt: xlsx.FmtRp, Width: 18}},
		top, xlsx.TableOpts{})

	h := wb.Sheet("Harian")
	hs := h.TitleBlock(sheetTitle("Harian", r.Filters))
	days := make([][]any, len(r.Daily))
	for i, d := range r.Daily {
		days[i] = []any{d.Date, d.Transactions, round0(d.Nett)}
	}
	h.Table(hs, []xlsx.Col{{Header: "Tanggal", Width: 14}, {Header: "Transaksi", Fmt: xlsx.FmtNum, Width: 12}, {Header: "Nett (Rp)", Fmt: xlsx.FmtRp, Width: 18}},
		days, xlsx.TableOpts{Totals: []any{"TOTAL", sum(r.Daily, func(d DailySales) float64 { return float64(d.Transactions) }),
			round0(sum(r.Daily, func(d DailySales) float64 { return d.Nett }))}, FreezeHeader: true})

	t := wb.Sheet("Transaksi")
	ts := t.TitleBlock(sheetTitle("Daftar Transaksi", r.Filters), strconv.Itoa(len(r.Rows))+" transaksi")
	rows := make([][]any, len(r.Rows))
	var totals [6]float64
	for i, x := range r.Rows {
		comp := ""
		if x.CompType != "" {
			comp = x.CompType
			if x.CompApprovedName != "" {
				comp += " (" + x.CompApprovedName + ")"
			}
		}
		for j, v := range []float64{x.Subtotal, x.DiscountAmount, x.TaxAmount, x.ServiceCharge, x.TotalAmount, x.ArkCoinsUsed} {
			totals[j] += v
		}
		rows[i] = []any{i + 1, wibDateTime(x.OrderedAt), x.OrderNumber, x.CheckoutNumber, x.StallName,
			firstNonEmpty(x.PaymentMethodName, x.PaymentMethod), round0(x.Subtotal), round0(x.DiscountAmount),
			round0(x.TaxAmount), round0(x.ServiceCharge), round0(x.TotalAmount), round0(x.ArkCoinsUsed), x.Status, comp}
	}
	t.Table(ts, []xlsx.Col{
		{Header: "No", Fmt: xlsx.FmtNum, Width: 6}, {Header: "Waktu (WIB)", Width: 20}, {Header: "No. Order", Width: 20}, {Header: "Checkout", Width: 16},
		{Header: "Stall", Width: 22}, {Header: "Metode Bayar", Width: 16}, {Header: "Subtotal (Rp)", Fmt: xlsx.FmtRp, Width: 16}, {Header: "Diskon (Rp)", Fmt: xlsx.FmtRp, Width: 14},
		{Header: "Pajak (Rp)", Fmt: xlsx.FmtRp, Width: 14}, {Header: "Service (Rp)", Fmt: xlsx.FmtRp, Width: 14}, {Header: "Total (Rp)", Fmt: xlsx.FmtRp, Width: 16}, {Header: "ARK Coin", Fmt: xlsx.FmtNum, Width: 12},
		{Header: "Status", Width: 12}, {Header: "Comp", Width: 16},
	}, rows, xlsx.TableOpts{Totals: []any{"TOTAL", "", "", "", "", "", round0(totals[0]), round0(totals[1]), round0(totals[2]),
		round0(totals[3]), round0(totals[4]), round0(totals[5]), "", ""}, FreezeHeader: true})
	return wb
}

/* Rush hour */

type rushHourJSON struct {
	Filters reportFilters `json:"filters"`
	domain.RushHourReport
}

func rushHourWorkbook(r rushHourJSON, m exportMeta) *xlsx.Report {
	wb := xlsx.NewReport(m.generatedAt)
	ws := wb.Sheet("Ringkasan")
	s := r.Summary
	peak := func(label *string, detail string) string {
		if label == nil || *label == "" {
			return "—"
		}
		return *label + " · " + detail
	}
	share := func(part, total float64) float64 {
		if total > 0 {
			return round2(part / total * 100)
		}
		return 0
	}
	row := ws.TitleBlock(m.company+" — Laporan Rush Hour", titleLines(r.Filters, m)...)
	row = ws.KeyValues(row, []xlsx.Pair{
		{Label: "Jumlah transaksi", Value: s.Transactions, Fmt: xlsx.FmtNum}, {Label: "Omzet", Value: round0(s.Revenue), Fmt: xlsx.FmtRp},
		{Label: "Qty item", Value: round2(s.Quantity), Fmt: xlsx.FmtQty}, {Label: "Rata-rata per transaksi", Value: round0(s.AverageTicket), Fmt: xlsx.FmtRp},
		{Label: "Jam tersibuk (transaksi)", Value: peak(r.PeakHour.HourLabel, peakText(r.PeakHour.Transactions))},
		{Label: "Jam omzet tertinggi", Value: peak(r.PeakRevenueHour.HourLabel, rupiahText(r.PeakRevenueHour.Revenue))},
		{Label: "Hari tersibuk", Value: peak(r.PeakDay.DowLabel, peakText(r.PeakDay.Transactions))},
	})
	row = ws.SectionTitle(row, "Per Hari")
	days := make([][]any, len(r.Weekdays))
	for i, d := range r.Weekdays {
		days[i] = []any{d.Label, d.Transactions, round0(d.Revenue), share(d.Revenue, s.Revenue)}
	}
	ws.Table(row, []xlsx.Col{{Header: "Hari", Width: 14}, {Header: "Transaksi", Fmt: xlsx.FmtNum, Width: 12}, {Header: "Omzet (Rp)", Fmt: xlsx.FmtRp, Width: 18},
		{Header: "Kontribusi omzet", Fmt: xlsx.FmtPct, Width: 16}}, days, xlsx.TableOpts{})

	h := wb.Sheet("Per Jam")
	hs := h.TitleBlock(sheetTitle("Per Jam", r.Filters))
	hours := make([][]any, len(r.Hourly))
	for i, x := range r.Hourly {
		hours[i] = []any{x.Label, x.Transactions, round0(x.Revenue), round2(x.Quantity), round0(x.AverageTicket),
			share(x.Revenue, s.Revenue), share(x.Quantity, s.Quantity)}
	}
	h.Table(hs, []xlsx.Col{
		{Header: "Jam", Width: 14}, {Header: "Transaksi", Fmt: xlsx.FmtNum, Width: 12}, {Header: "Omzet (Rp)", Fmt: xlsx.FmtRp, Width: 18},
		{Header: "Qty item", Fmt: xlsx.FmtQty, Width: 12}, {Header: "Rata-rata (Rp)", Fmt: xlsx.FmtRp, Width: 16},
		{Header: "Kontribusi omzet", Fmt: xlsx.FmtPct, Width: 16}, {Header: "Kontribusi qty", Fmt: xlsx.FmtPct, Width: 14},
	}, hours, xlsx.TableOpts{Totals: []any{"TOTAL", s.Transactions, round0(s.Revenue), round2(s.Quantity), round0(s.AverageTicket), 100, 100}, FreezeHeader: true})

	hm := wb.Sheet("Heatmap")
	ms := hm.TitleBlock("Heatmap jumlah transaksi — hari × jam")
	var heatHours []int
	byKey := map[[2]int]float64{}
	for _, c := range r.Heatmap {
		if !slices.Contains(heatHours, c.Hour) {
			heatHours = append(heatHours, c.Hour)
		}
		byKey[[2]int{c.Dow, c.Hour}] = c.Transactions
	}
	slices.Sort(heatHours)
	cols := []xlsx.Col{{Header: "Hari", Width: 12}}
	for _, hr := range heatHours {
		label := strconv.Itoa(hr)
		if i := slices.IndexFunc(r.Hourly, func(b domain.RushHourBucket) bool { return b.Hour == hr }); i >= 0 {
			label = r.Hourly[i].Label
		}
		cols = append(cols, xlsx.Col{Header: label, Fmt: xlsx.FmtNum, Width: 8})
	}
	grid := make([][]any, len(r.Weekdays))
	for i, d := range r.Weekdays {
		grid[i] = []any{d.Label}
		for _, hr := range heatHours {
			grid[i] = append(grid[i], byKey[[2]int{d.Dow, hr}])
		}
	}
	hm.Table(ms, cols, grid, xlsx.TableOpts{FreezeHeader: true})
	return wb
}

/* Voids */

type voidsJSON struct {
	Filters reportFilters                   `json:"filters"`
	Summary struct{ Voids, Amount float64 } `json:"summary"`
	Rows    []struct {
		OrderNumber       string     `json:"order_number"`
		CheckoutNumber    string     `json:"checkout_number"`
		OrderedAt         *time.Time `json:"ordered_at"`
		VoidedAt          *time.Time `json:"voided_at"`
		VoidReason        string     `json:"void_reason"`
		CreatedByName     string     `json:"created_by_name"`
		VoidedByName      string     `json:"voided_by_name"`
		StallName         string     `json:"stall_name"`
		PaymentMethod     string     `json:"payment_method"`
		PaymentMethodName string     `json:"payment_method_name"`
		TotalAmount       float64    `json:"total_amount"`
		Items             []struct {
			ProductName string  `json:"product_name"`
			ProductSku  string  `json:"product_sku"`
			Quantity    float64 `json:"quantity"`
			UnitPrice   float64 `json:"unit_price"`
			TotalAmount float64 `json:"total_amount"`
		} `json:"items"`
	} `json:"rows"`
}

func voidsWorkbook(r voidsJSON, m exportMeta) *xlsx.Report {
	wb := xlsx.NewReport(m.generatedAt)
	ws := wb.Sheet("Void")
	row := ws.TitleBlock(m.company+" — Laporan Void", titleLines(r.Filters, m)...)
	row = ws.KeyValues(row, []xlsx.Pair{{Label: "Jumlah void", Value: r.Summary.Voids, Fmt: xlsx.FmtNum},
		{Label: "Nilai void", Value: round0(r.Summary.Amount), Fmt: xlsx.FmtRp}})
	rows := make([][]any, len(r.Rows))
	var items [][]any
	total := 0.0
	for i, x := range r.Rows {
		total += x.TotalAmount
		rows[i] = []any{i + 1, x.OrderNumber, x.CheckoutNumber, wibDateTime(x.OrderedAt), wibDateTime(x.VoidedAt), x.VoidReason,
			x.CreatedByName, x.VoidedByName, x.StallName, firstNonEmpty(x.PaymentMethodName, x.PaymentMethod), round0(x.TotalAmount)}
		for _, it := range x.Items {
			items = append(items, []any{x.OrderNumber, it.ProductName, it.ProductSku, round2(it.Quantity), round0(it.UnitPrice), round0(it.TotalAmount)})
		}
	}
	ws.Table(row, []xlsx.Col{
		{Header: "No", Fmt: xlsx.FmtNum, Width: 6}, {Header: "No. Order", Width: 20}, {Header: "Checkout", Width: 16}, {Header: "Dipesan (WIB)", Width: 20},
		{Header: "Di-void (WIB)", Width: 20}, {Header: "Alasan", Width: 34}, {Header: "Kasir", Width: 18}, {Header: "Supervisor", Width: 18},
		{Header: "Stall", Width: 20}, {Header: "Metode Bayar", Width: 16}, {Header: "Total (Rp)", Fmt: xlsx.FmtRp, Width: 16},
	}, rows, xlsx.TableOpts{Totals: []any{"TOTAL", "", "", "", "", "", "", "", "", "", round0(total)}, FreezeHeader: true})

	it := wb.Sheet("Item Void")
	is := it.TitleBlock("Item pada transaksi yang di-void")
	it.Table(is, []xlsx.Col{
		{Header: "No. Order", Width: 20}, {Header: "Produk", Width: 34}, {Header: "SKU", Width: 18}, {Header: "Qty", Fmt: xlsx.FmtQty, Width: 8},
		{Header: "Harga (Rp)", Fmt: xlsx.FmtRp, Width: 14}, {Header: "Total (Rp)", Fmt: xlsx.FmtRp, Width: 16},
	}, items, xlsx.TableOpts{FreezeHeader: true})
	return wb
}

/* Product sales */

func productSalesWorkbook(r ProductSalesReport, m exportMeta) *xlsx.Report {
	wb := xlsx.NewReport(m.generatedAt)
	ws := wb.Sheet("Product Sales")
	s := r.Summary
	row := ws.TitleBlock(m.company+" — Laporan Product Sales", titleLines(r.Filters, m)...)
	row = ws.KeyValues(row, []xlsx.Pair{{Label: "Jumlah produk", Value: s.Products, Fmt: xlsx.FmtNum},
		{Label: "Qty terjual", Value: round2(s.Quantity), Fmt: xlsx.FmtQty}, {Label: "Total omzet", Value: round0(s.Revenue), Fmt: xlsx.FmtRp}})
	rows := make([][]any, len(r.Rows))
	for i, x := range r.Rows {
		share := 0.0
		if s.Revenue > 0 {
			share = round2(x.Revenue / s.Revenue * 100)
		}
		rows[i] = []any{i + 1, orDefault(x.ProductSku, ""), x.ProductName, orDefault(x.StallName, ""), round2(x.Quantity),
			round0(x.Revenue), x.OrderCount, share}
	}
	ws.Table(row, []xlsx.Col{
		{Header: "Rank", Fmt: xlsx.FmtNum, Width: 7}, {Header: "SKU", Width: 20}, {Header: "Produk", Width: 36}, {Header: "Stall", Width: 22},
		{Header: "Qty", Fmt: xlsx.FmtQty, Width: 10}, {Header: "Omzet (Rp)", Fmt: xlsx.FmtRp, Width: 18}, {Header: "Jumlah order", Fmt: xlsx.FmtNum, Width: 13},
		{Header: "Kontribusi omzet", Fmt: xlsx.FmtPct, Width: 16},
	}, rows, xlsx.TableOpts{Totals: []any{"TOTAL", "", "", "", round2(s.Quantity), round0(s.Revenue), "", 100}, FreezeHeader: true})
	return wb
}

/* Payment methods */

type paymentMethodsJSON struct {
	Filters struct {
		reportFilters
		Granularity string `json:"granularity"`
	} `json:"filters"`
	Summary struct {
		TotalAmount  float64 `json:"total_amount"`
		PaymentCount float64 `json:"payment_count"`
		OrderCount   float64 `json:"order_count"`
		MethodCount  float64 `json:"method_count"`
	} `json:"summary"`
	ByMethod []struct {
		Label        string  `json:"label"`
		Amount       float64 `json:"amount"`
		Pct          float64 `json:"pct"`
		PaymentCount float64 `json:"payment_count"`
		OrderCount   float64 `json:"order_count"`
	} `json:"by_method"`
	MethodColumns []struct {
		MethodKey string `json:"method_key"`
		Label     string `json:"label"`
	} `json:"method_columns"`
	Series []struct {
		Label        string  `json:"label"`
		TotalAmount  float64 `json:"total_amount"`
		PaymentCount float64 `json:"payment_count"`
		ByMethod     []struct {
			MethodKey string  `json:"method_key"`
			Amount    float64 `json:"amount"`
		} `json:"by_method"`
	} `json:"series"`
}

var granularityNoun = map[string]string{"day": "hari", "month": "bulan"}

func paymentMethodsWorkbook(r paymentMethodsJSON, m exportMeta) *xlsx.Report {
	wb := xlsx.NewReport(m.generatedAt)
	ws := wb.Sheet("Ringkasan")
	s := r.Summary
	f := r.Filters.reportFilters
	row := ws.TitleBlock(m.company+" — Laporan Payment Methods", titleLines(f, m)...)
	row = ws.KeyValues(row, []xlsx.Pair{
		{Label: "Total pembayaran", Value: round0(s.TotalAmount), Fmt: xlsx.FmtRp}, {Label: "Jumlah pembayaran", Value: s.PaymentCount, Fmt: xlsx.FmtNum},
		{Label: "Jumlah order", Value: s.OrderCount, Fmt: xlsx.FmtNum}, {Label: "Jumlah metode", Value: s.MethodCount, Fmt: xlsx.FmtNum},
	})
	row = ws.SectionTitle(row, "Per Metode Pembayaran")
	methods := make([][]any, len(r.ByMethod))
	for i, x := range r.ByMethod {
		methods[i] = []any{x.Label, round0(x.Amount), round2(x.Pct), x.PaymentCount, x.OrderCount}
	}
	ws.Table(row, []xlsx.Col{
		{Header: "Metode", Width: 26}, {Header: "Nominal (Rp)", Fmt: xlsx.FmtRp, Width: 18}, {Header: "Porsi", Fmt: xlsx.FmtPct, Width: 10},
		{Header: "Jumlah pembayaran", Fmt: xlsx.FmtNum, Width: 18}, {Header: "Jumlah order", Fmt: xlsx.FmtNum, Width: 14},
	}, methods, xlsx.TableOpts{Totals: []any{"TOTAL", round0(s.TotalAmount), 100, s.PaymentCount, s.OrderCount}})

	ps := wb.Sheet("Per Periode")
	noun, ok := granularityNoun[r.Filters.Granularity]
	if !ok {
		noun = "tahun"
	}
	start := ps.TitleBlock(sheetTitle("Tren per "+noun, f))
	cols := []xlsx.Col{{Header: "Periode", Width: 16}, {Header: "Total (Rp)", Fmt: xlsx.FmtRp, Width: 18}, {Header: "Pembayaran", Fmt: xlsx.FmtNum, Width: 12}}
	for _, c := range r.MethodColumns {
		cols = append(cols, xlsx.Col{Header: c.Label + " (Rp)", Fmt: xlsx.FmtRp, Width: 16})
	}
	methodSums := make([]float64, len(r.MethodColumns))
	var total, payments float64
	rows := make([][]any, len(r.Series))
	for i, p := range r.Series {
		total += p.TotalAmount
		payments += p.PaymentCount
		rows[i] = []any{p.Label, round0(p.TotalAmount), p.PaymentCount}
		for j, c := range r.MethodColumns {
			amount := 0.0
			for _, b := range p.ByMethod {
				if b.MethodKey == c.MethodKey {
					amount = b.Amount
					break
				}
			}
			methodSums[j] += amount
			rows[i] = append(rows[i], round0(amount))
		}
	}
	totals := []any{"TOTAL", round0(total), payments}
	for _, v := range methodSums {
		totals = append(totals, round0(v))
	}
	ps.Table(start, cols, rows, xlsx.TableOpts{Totals: totals, FreezeHeader: true})
	return wb
}
