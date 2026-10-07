package posops

import (
	"slices"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/httpx"
)

func sp(s string) *string { return &s }

// Ported from lib/pos/reports/transaction-labels.test.ts.
func TestTransactionLabels(t *testing.T) {
	for _, c := range []struct{ got, want string }{
		{paymentStatusLabel(sp("paid"), sp("pending")), "Lunas"},
		{paymentStatusLabel(sp("unpaid"), sp("pending")), "Belum lunas"},
		{paymentStatusLabel(nil, sp("completed")), "Lunas"},
		{paymentStatusLabel(nil, sp("voided")), "Void"},
		{paymentStatusLabel(nil, sp("pending")), "Belum lunas"},
		{paymentStatusLabel(nil, nil), "—"},
		{soldFromLabel(sp("central")), "Kasir pusat"},
		{soldFromLabel(sp("stall")), "Kasir stall"},
		{soldFromLabel(sp(" web ")), "web"},
		{soldFromLabel(nil), "—"},
		{reportStallLabel(sp("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"), sp("FNB")), "FNB"},
		{reportStallLabel(sp("Sate"), sp("SAT")), "Sate"},
		{reportStallLabel(nil, nil), "—"},
		{compTypeLabel(sp("foc_comp")), "FOC"},
		{compTypeLabel(nil), ""},
		{transactionMethodLabel(TransactionLine{PaymentMethod: sp("qris")}), "QRIS"},
		{transactionMethodLabel(TransactionLine{PaymentMethod: sp("cash"), PaymentMethodCode: sp("transfer_bca"), PaymentMethodName: sp("Transfer BCA")}), "Transfer BCA"},
		{transactionMethodLabel(TransactionLine{PaymentMethod: sp("cash"), PaymentMethodCode: sp("cash"), PaymentMethodName: sp("Cash")}), "Tunai"},
		{transactionMethodLabel(TransactionLine{PaymentMethod: sp("cash"), CompType: sp("kol_comp")}), "KOL Comp"},
	} {
		if c.got != c.want {
			t.Errorf("got %q, want %q", c.got, c.want)
		}
	}
}

func sampleHead() stallReportHead {
	return stallReportHead{Filters: reportFilters{DateFrom: "2026-08-01", DateTo: "2026-08-29"}, StallOptions: []stallOption{}}
}

// Ported from lib/pos/reports/product-sales-export.test.ts.
func TestProductSalesSheets(t *testing.T) {
	r := &ProductSalesReport{stallReportHead: sampleHead(), Summary: ProductSalesSummary{Products: 1, Quantity: 4, Revenue: 120000},
		Rows: []ProductSalesLine{{ProductID: sp("p1"), ProductName: "Es Teh", ProductSku: sp("ET-01"), WarehouseID: sp("w1"),
			StallCode: sp("FNB"), StallName: sp("F&B"), Quantity: 4, Revenue: 120000, OrderCount: 3}}}
	if got := productSalesFileName(r.Filters); got != "penjualan-produk-2026-08-01_2026-08-29.xlsx" {
		t.Fatalf("file name = %s", got)
	}
	sheets := productSalesSheets(r)
	if len(sheets) != 2 || sheets[0].Name != "Ringkasan" || sheets[1].Name != "Produk" {
		t.Fatalf("sheets = %v", sheets)
	}
	if !slices.Equal(sheets[1].Rows[0], []any{"Produk", "SKU", "Stall", "Qty", "Orders", "Omzet"}) ||
		!slices.Equal(sheets[1].Rows[1], []any{"Es Teh", "ET-01", "F&B", 4.0, 3.0, 120000.0}) {
		t.Fatalf("produk = %v", sheets[1].Rows)
	}
	if !slices.Equal(sheets[0].Rows[2], []any{"Stall", "Semua stall"}) {
		t.Fatalf("stall row = %v", sheets[0].Rows[2])
	}
}

// Ported from lib/pos/reports/transaction-export.test.ts.
func TestTransactionSheets(t *testing.T) {
	at := time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC)
	r := &TransactionReport{stallReportHead: sampleHead(),
		Summary:     TransactionSummary{Transactions: 1, TotalSales: 27000, Revenue: 30000, Discount: 3000, Nett: 27000},
		PerStall:    []StallSales{{StallCode: sp("FNB"), StallName: "F&B", Transactions: 1, Quantity: 2, Sales: 30000}},
		TopProducts: []TopProduct{{ProductName: "Es Teh", Quantity: 2, Revenue: 30000}},
		Daily:       []DailySales{{Date: "2026-08-29", Nett: 27000, Transactions: 1}},
		Rows: []TransactionLine{{ID: "ord-1", OrderNumber: sp("POS-20260829-0001"), OrderedAt: httpx.NewJSTime(&at),
			Status: sp("completed"), PaymentStatus: sp("paid"), PaymentMethod: sp("qris"), PaymentMethodCode: sp("qris"),
			PaymentMethodName: sp("QRIS"), Subtotal: 30000, DiscountAmount: 3000, TotalAmount: 27000, WarehouseID: sp("w1"),
			StallCode: sp("FNB"), StallName: sp("F&B"), SoldFrom: sp("stall")}},
	}
	if got := transactionFileName(r.Filters); got != "transaksi-pos-2026-08-01_2026-08-29.xlsx" {
		t.Fatalf("file name = %s", got)
	}
	sheets := transactionSheets(r)
	var names []string
	for _, s := range sheets {
		names = append(names, s.Name)
	}
	if !slices.Equal(names, []string{"Ringkasan", "Per Stall", "Top Produk", "Harian", "Transaksi"}) {
		t.Fatalf("names = %v", names)
	}
	detail := sheets[4].Rows
	if detail[0][0] != "Order" || detail[1][0] != "POS-20260829-0001" || detail[1][2] != at || detail[1][4] != "QRIS" ||
		detail[1][8] != 27000.0 || detail[1][11] != "Lunas" || detail[1][12] != "Kasir stall" {
		t.Fatalf("detail = %v", detail)
	}
}

// Ported from lib/pos/rush-hour.test.ts (buildHourRangeContribution).
func TestHourRangeContribution(t *testing.T) {
	rep := domain.BuildRushHourReport([]domain.RushHourPoint{
		{Hour: 8, Dow: 1, Transactions: 5, Revenue: 500_000, Quantity: 10},
		{Hour: 10, Dow: 2, Transactions: 10, Revenue: 1_000_000, Quantity: 30},
		{Hour: 12, Dow: 3, Transactions: 5, Revenue: 500_000, Quantity: 20},
		{Hour: 19, Dow: 4, Transactions: 20, Revenue: 2_000_000, Quantity: 40},
	})
	got := hourRangeContribution(rep, 7, 12)
	if got != (hourRange{From: 7, To: 12, Transactions: 20, Revenue: 2_000_000, Qty: 60, ShareRevenue: 50, ShareQty: 60, ShareTx: 50}) {
		t.Fatalf("range = %+v", got)
	}
	if flipped := hourRangeContribution(rep, 12, 7); flipped.From != 12 || flipped.To != 12 {
		t.Fatalf("flipped = %+v", flipped)
	}
	zero := hourRangeContribution(domain.BuildRushHourReport(nil), 0, 23)
	if zero.ShareRevenue != 0 || zero.ShareQty != 0 {
		t.Fatalf("zero = %+v", zero)
	}
	for in, want := range map[string]float64{"": 0, "8": 8, " 9 ": 9, "7.5": 7, "24": 7, "x": 7, "-1": 7} {
		if got := clampHour(in, 7); got != want {
			t.Errorf("clampHour(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestExportHelpers(t *testing.T) {
	for _, c := range []struct{ got, want string }{
		{validateReportRange("2026-09-01", "2026-09-05"), ""},
		{validateReportRange("2026-9-1", "2026-09-05"), "Format tanggal harus YYYY-MM-DD"},
		{validateReportRange("2026-09-06", "2026-09-05"), "Tanggal dari tidak boleh melebihi tanggal sampai"},
		{periodLabel("2026-09-01", "2026-09-05"), "1 Sep 2026 s.d. 5 Sep 2026"},
		{periodLabel("2026-08-17", "2026-08-17"), "17 Agu 2026"},
		{wibDateTime(func() *time.Time { t := time.Date(2031, 5, 4, 3, 15, 0, 0, time.UTC); return &t }()), "04 Mei 2031, 10.15"},
		{wibDateTime(nil), "—"},
		{printedLine(time.Date(2031, 5, 4, 3, 15, 0, 0, time.UTC)), "Dicetak: 4 Mei 2031, 10.15 WIB"},
		{exportFileName("revenue-composition", "2026-09-01", "2026-09-05"), "revenue-composition_2026-09-01_2026-09-05.xlsx"},
		{exportFileName("voids", "2026-09-01", "2026-09-05"), "void_2026-09-01_2026-09-05.xlsx"},
		{rupiahText(1234567.4), "Rp 1.234.567"},
		{stallLabel(sp("w1"), []stallOption{{ID: "w1", Name: "Sate"}}), "Sate"},
		{stallLabel(sp("w2"), []stallOption{{ID: "w1", Name: "Sate"}}), "Stall terpilih"},
		{stallLabel(nil, nil), "Semua stall"},
	} {
		if c.got != c.want {
			t.Errorf("got %q, want %q", c.got, c.want)
		}
	}
	if len(exportLabels) != len(reportExports) {
		t.Fatalf("export labels %d, exports %d", len(exportLabels), len(reportExports))
	}
}
