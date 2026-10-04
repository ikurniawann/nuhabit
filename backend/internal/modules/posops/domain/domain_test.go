package domain

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"
)

func sp(s string) *string { return &s }

func eq(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v\nwant %#v", got, want)
	}
}

func TestJSCoercions(t *testing.T) {
	eq(t, Number(nil), 0.0)
	eq(t, math.IsNaN(Number(Undef)), true)
	eq(t, Number(" 12 "), 12.0)
	eq(t, Number(""), 0.0)
	eq(t, Number("0x1A"), 26.0)
	eq(t, math.IsNaN(Number("1a")), true)
	eq(t, Number([]any{json.Number("5")}), 5.0)
	eq(t, String([]any{1.0, nil, "a"}), "1,,a")
	eq(t, String(map[string]any{}), "[object Object]")
	eq(t, FormatNumber(1e21), "1e+21")
	eq(t, FormatNumber(1.5e-7), "1.5e-7")
	eq(t, Truthy("0"), true)
	eq(t, Truthy(json.Number("0")), false)
	eq(t, ParseInt("10abc"), 10.0)
	eq(t, math.IsNaN(ParseInt("abc")), true)
	eq(t, Round(-2.5), -2.0)
	eq(t, Round(2.5), 3.0)
	eq(t, Round2(10.555), 10.56) // 10.555*100 is 1055.5 in IEEE doubles
}

func TestShiftTotals(t *testing.T) {
	totals := SummarizeShiftOrders([]ShiftOrder{
		{TotalAmount: "50000.00", PaymentMethod: "cash"},
		{TotalAmount: "25000", PaymentMethod: "QRIS"},
		{TotalAmount: 10000.0, PaymentMethod: "cash", PaymentMethodCode: sp("transfer_bca")},
		{TotalAmount: "1", ArkCoinsUsed: "300", PaymentMethod: "ark_coin"},
		{TotalAmount: "700", PaymentMethod: "nfc_tab"},
		{TotalAmount: "5", PaymentMethod: ""},
	})
	eq(t, totals, ShiftOrderTotals{Cash: 50005, Qris: 25000, Credit: 10000, ArkCoin: 300, NfcTab: 700})
	bills := SummarizeMemberBillShiftPayments([]MemberBillPayment{
		{Amount: "20000", PaymentMethod: sp("cash")},
		{Amount: "5000", PaymentMethod: sp("qris")},
		{Amount: "1000", PaymentMethod: sp("cash"), PaymentMethodCode: sp("bca")},
	})
	eq(t, bills, MemberBillShiftTotals{Cash: 20000, Qris: 5000, Card: 1000, Total: 26000})
}

func TestShiftReportMessage(t *testing.T) {
	eq(t, *NormalizeWaPhone("0812-3456-789"), "628123456789")
	eq(t, *NormalizeWaPhone("+62 812 3456 789"), "628123456789")
	eq(t, NormalizeWaPhone("12"), (*string)(nil))
	opened := time.Date(2026, 8, 14, 1, 0, 0, 0, time.UTC)
	closed := time.Date(2026, 8, 14, 9, 0, 0, 0, time.UTC)
	msg := ShiftReportMessage(ShiftReport{OutletName: "Sulu", ShiftNumber: "SH-014", CashierName: "Ani", OpenedAt: &opened,
		ClosedAt: &closed, TotalOrders: 42, TotalSales: 3_500_000, OpeningCash: 500_000, ExpectedCash: 2_100_000,
		ClosingCash: 2_095_000, Variance: -5_000})
	for _, want := range []string{"SH-014", "Ani", "Jumlah transaksi: 42", "Rp 3.500.000", "-Rp 5.000", "Buka: 14 Agu 2026, 08.00 WIB"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("message misses %q:\n%s", want, msg)
		}
	}
	if !strings.Contains(ShiftReportMessage(ShiftReport{}), "Selisih: pas ✅") {
		t.Fatal("zero variance is pas")
	}
}

func TestTableBoard(t *testing.T) {
	at := time.Now()
	orders := []BoardOrder{
		{ID: "o1", TableID: sp("t1"), PaymentStatus: sp("unpaid"), TotalAmount: sp("10000"), CheckoutID: sp("c1")},
		{ID: "o2", TableID: sp("t1"), PaymentStatus: sp("unpaid"), TotalAmount: sp("5000"), CheckoutID: sp("c1"), PreSettledAt: &at},
		{ID: "o3", TableID: sp("t1"), Status: sp("cancelled"), TotalAmount: sp("1")},
		{ID: "o4", TableID: sp("t1"), OrderNumber: sp("ORD-4"), TotalAmount: sp("7000"), SoldFrom: sp("central")},
		{ID: "o5", TableID: sp("t1"), CheckoutID: sp("gone")},
	}
	checkouts := []BoardCheckout{
		{ID: "c1", TableID: sp("t1"), CheckoutNumber: sp("CHK-1")},
		{ID: "gone", TableID: sp("t1"), Notes: sp(" Cancelled by cashier")},
	}
	bills := ListTableBoardBills("t1", orders, checkouts)
	if len(bills) != 2 || bills[0].Kind != "checkout" || bills[0].TotalAmount != 15000 || bills[0].Label != "CHK-1" ||
		bills[0].PreSettledAt == nil || bills[1].SoldFrom != "central" || bills[1].Label != "ORD-4" {
		t.Fatalf("bills = %+v", bills)
	}
	eq(t, ResolveTableBoardStatus(sp("available"), bills), "billing")
	eq(t, ResolveTableBoardStatus(sp("Reserved"), nil), "reserved")
	eq(t, ResolveTableBoardStatus(nil, []TableBill{{PaymentStatus: "unpaid"}}), "occupied")

	p, msg := ParseTablePayload(map[string]any{"table_number": " A1 ", "capacity": json.Number("0.5"), "status": "x"}, false, nil)
	eq(t, msg, "")
	eq(t, []any{p.TableNumber, p.Capacity, p.Status, p.QrCode}, []any{"A1", 1.0, "available", (*string)(nil)})
	_, msg = ParseTablePayload(map[string]any{}, true, nil)
	eq(t, msg, "Table number is required")
	eq(t, TableQrCode(" meja #7 ", "ABCD1234"), "TBL-MEJA7-ABCD1234")
	eq(t, ClampPercent(33.335), 33.34)
	x, y, msg := ParsePosition(map[string]any{"pos_x": json.Number("150"), "pos_y": "-3"})
	eq(t, []any{x, y, msg}, []any{100.0, 0.0, ""})
}

func TestReservationRules(t *testing.T) {
	eq(t, NormalizeTimeSlot("9:30"), "9:30:00")
	eq(t, NormalizeTimeSlot(" 19:30:00 "), "19:30:00")
	eq(t, NormalizeTimeSlot(nil), "")
	pax := 0
	eq(t, NormalizeGuestCount(&pax), 1)
	pax = 900
	eq(t, NormalizeGuestCount(&pax), 500)
	eq(t, SeatNotes(sp(" "), sp("18:00:00")), "Reservation · Guest · 18:00:00")
}

func TestVariantMatrix(t *testing.T) {
	axes := []any{
		map[string]any{"key": "ukuran", "values": []any{" S ", "S", "s", "", "M"}},
		map[string]any{"key": "warna", "values": []any{"Hitam"}},
	}
	got := ExpandMatrix(axes)
	if len(got) != 2 || got[0].Get("ukuran") != "S" || got[1].Get("ukuran") != "M" {
		t.Fatalf("expand = %+v", got)
	}
	eq(t, len(ExpandMatrix([]any{map[string]any{"key": "u", "values": []any{"  "}}})), 0)
	eq(t, len(ExpandMatrix([]any{map[string]any{"key": "u", "values": json.Number("5")}})), 0)
	eq(t, ValidateMatrixSize("x"), "Sumbu varian harus berupa daftar")
	eq(t, ValidateMatrixSize([]any{nil}), "Nilai sumbu harus berupa daftar")
	eq(t, ValidateMatrixSize([]any{map[string]any{"key": json.Number("1"), "values": []any{}}}), "Nilai sumbu harus berupa daftar")
	many := func(n int) []any {
		out := make([]any, n)
		for i := range out {
			out[i] = "v" + FormatNumber(float64(i))
		}
		return out
	}
	eq(t, ValidateMatrixSize([]any{map[string]any{"key": "a", "values": many(51)}}), "Maksimal 50 nilai per sumbu")
	eq(t, ValidateMatrixSize([]any{map[string]any{"key": "a", "values": many(25)}, map[string]any{"key": "b", "values": many(21)}}),
		"Maksimal 500 kombinasi varian per produk")
	eq(t, ValidateMatrixSize([]any{map[string]any{"key": "a", "values": many(25)}, map[string]any{"key": "b", "values": many(20)}}), "")

	eq(t, BuildSkuCode("KAOS-001", NewOptions("ukuran", "M", "warna", "Hitam")), "KAOS-001-M-HITAM")
	eq(t, BuildSkuCode("KAOS-001", NewOptions("warna", "Hitam", "ukuran", "M")), "KAOS-001-HITAM-M")
	eq(t, BuildSkuCode("", NewOptions("ukuran", "M")), "SKU-M")
	eq(t, BuildSkuCode("kaos", NewOptions("warna", "Hitám")), "KAOS-HITAM")
	long := BuildSkuCode("KAOS-001", NewOptions("ukuran", "EXTRAEXTRAEXTRALARGEUKURANPANJANGSEKALI", "warna", "HITAMKEABUABUANGELAPBANGETSEKALI"))
	if len(long) > 60 || !strings.HasPrefix(long, "KAOS-001") {
		t.Fatalf("long code = %s", long)
	}
	base := "KAOS-" + strings.Repeat("X", 60)
	eq(t, BuildSkuCode(base, NewOptions("ukuran", "M")), base[:60])
	eq(t, BuildSkuName("Kaos Polos", NewOptions("ukuran", "M", "warna", "Hitam")), "Kaos Polos — M / Hitam")
	eq(t, BuildSkuName("Kaos Polos", NewOptions()), "Kaos Polos")
	eq(t, ComposedBarcodeTooLong("", []string{strings.Repeat("A", 60)}), false)
	eq(t, ComposedBarcodeTooLong("1234", []string{strings.Repeat("A", 60)}), false)
	eq(t, ComposedBarcodeTooLong("12345", []string{strings.Repeat("A", 60)}), true)

	existing := []ExistingSku{
		{ID: "1", Options: NewOptions("ukuran", "S", "warna", "Hitam"), IsActive: true},
		{ID: "2", Options: NewOptions("warna", "hitam", "ukuran", "m"), IsActive: true, StockQuantity: 2},
		{ID: "3", Options: NewOptions("ukuran", "L", "warna", "Hitam"), IsActive: false},
		{ID: "4", Options: NewOptions("ukuran", "XL", "warna", "Hitam"), IsActive: false},
	}
	d := DiffMatrix(existing, []Options{NewOptions("ukuran", "M", "warna", "Hitam"), NewOptions("ukuran", "L", "warna", "Hitam"),
		NewOptions("ukuran", "XXL", "warna", "Hitam")})
	if len(d.Create) != 1 || d.Create[0].Get("ukuran") != "XXL" || len(d.Keep) != 1 || d.Keep[0].ID != "2" ||
		len(d.Reactivate) != 1 || d.Reactivate[0].ID != "3" || len(d.Deactivate) != 1 || d.Deactivate[0].ID != "1" {
		t.Fatalf("diff = %+v", d)
	}
	blocked := BlockedDeactivations(existing, []string{"1", "2"})
	if len(blocked) != 1 || blocked[0].ID != "2" {
		t.Fatalf("blocked = %+v", blocked)
	}
}

func TestSkuAndMerchandiseColumns(t *testing.T) {
	_, msg := SkuColumns(map[string]any{}, true)
	eq(t, msg, "Kode SKU wajib diisi")
	_, msg = SkuColumns(map[string]any{"sku": "SKU-1"}, true)
	eq(t, msg, "Nama varian wajib diisi")
	_, msg = SkuColumns(map[string]any{"sku": strings.Repeat("A", 61)}, false)
	eq(t, msg, "Kode SKU maksimal 60 karakter")
	_, msg = SkuColumns(map[string]any{"barcode": strings.Repeat("B", 65)}, false)
	eq(t, msg, "Barcode maksimal 64 karakter")
	cols, _ := SkuColumns(map[string]any{"barcode": ""}, false)
	eq(t, cols, Columns{{"barcode", nil}})
	_, msg = SkuColumns(map[string]any{"price_override": json.Number("-1")}, false)
	eq(t, msg, "Harga varian harus angka ≥ 0")
	cols, _ = SkuColumns(map[string]any{"stock_quantity": "5"}, false)
	eq(t, cols, Columns{{"stock_quantity", 5.0}})
	_, msg = SkuColumns(map[string]any{"stock_quantity": "abc"}, false)
	eq(t, msg, "Stok varian harus angka")

	cols, msg = MerchandiseColumns(map[string]any{"product_kind": " Merchandise ", "weight_gram": "-2", "inventory_quantity": "x"})
	eq(t, msg, "")
	eq(t, cols, Columns{{"product_kind", "merchandise"}, {"inventory_tracking", true}, {"inventory_quantity", 0.0}, {"weight_gram", nil}})
	_, msg = MerchandiseColumns(map[string]any{"product_kind": "toy"})
	eq(t, msg, "product_kind tidak valid (regular|gift_card|merchandise)")

	eq(t, NormalizeSalesChannels([]any{" pos", "gofood", "pos", "tiktok"}), []string{"pos", "gofood"})
	eq(t, NormalizeSalesChannels("{gofood,\"pos\"}"), []string{"gofood", "pos"})
	eq(t, NormalizeSalesChannels([]any{}), []string(nil))
	eq(t, IsSoldIn(nil, "pos"), true)
	eq(t, IsSoldIn([]any{"gofood"}, "pos"), false)
	eq(t, NormalizeStation(" BAR "), "bar")
	eq(t, NormalizeStation("grill"), "kitchen")
	eq(t, ResolvePosStation("", "Minuman Dingin"), "bar")
	eq(t, PosCategoryName("Kopi Susu"), "Minuman")
	eq(t, PosCategoryName(""), "Makanan")
	eq(t, MinXp("10.7"), 10.0)
	eq(t, MinXp(json.Number("0")), nil)
	eq(t, MinXpUpdate("0.5"), nil)
}

func TestDashboardRules(t *testing.T) {
	now := time.Date(2026, 10, 4, 18, 30, 0, 0, time.UTC) // Monday 01:30 WIB
	eq(t, PeriodRange("today", now).Start.UTC().Format(time.RFC3339), "2026-10-04T17:00:00Z")
	eq(t, PeriodRange("week", now).Start.UTC().Format(time.RFC3339), "2026-10-04T17:00:00Z")
	eq(t, PeriodRange("month", now).Start.UTC().Format(time.RFC3339), "2026-09-30T17:00:00Z")
	r, ok := CustomRange("2026-10-01", "2026-10-02")
	eq(t, ok, true)
	eq(t, r.End.UTC().Format("2006-01-02T15:04:05.000Z"), "2026-10-02T16:59:59.999Z")
	_, ok = CustomRange("2026-10-02", "2026-10-01")
	eq(t, ok, false)
	_, ok = CustomRange("2025-01-01", "2026-10-01")
	eq(t, ok, false)

	k1, k2, k3 := "k1", "k2", "k3"
	orders := []DashboardOrder{
		{ID: "a", TotalAmount: sp("30000"), CashierID: &k1, PaymentStatus: "paid", Status: "pending"},
		{ID: "b", TotalAmount: sp("20000"), CashierID: &k2, PaymentStatus: "paid", Status: "pending"},
		{ID: "c", TotalAmount: sp("99999"), CashierID: &k1, PaymentStatus: "paid", Status: "voided"},
		{ID: "d", TotalAmount: sp("5000"), CashierID: &k3, PaymentStatus: "unpaid", Status: "pending"},
	}
	eq(t, SummarizeSales(orders, 30000, 3), SalesSummary{TodayRevenue: 50000, TodayOrders: 2, AverageOrderValue: 25000,
		ActiveCashiers: 3, RevenueChange: 66.7, OrdersChange: -33.3})
	kopi, teh := "kopi", "teh"
	top := TopProducts([]DashboardItem{
		{OrderID: "a", ProductID: &kopi, ProductName: sp("Kopi"), Quantity: sp("2"), TotalAmount: sp("40000")},
		{OrderID: "b", ProductID: &kopi, ProductName: sp("Kopi"), Quantity: sp("1"), TotalAmount: sp("20000")},
		{OrderID: "x", ProductID: &teh, ProductName: sp("Teh"), Quantity: sp("9"), TotalAmount: sp("9000")},
	}, map[string]bool{"a": true, "b": true})
	eq(t, top, []TopProduct{{ID: "kopi", Name: "Kopi", Sold: 3, Revenue: 60000}})

	today := PeriodRange("today", now)
	trend := BuildTrend("today", today.Start, now, []DashboardOrder{{OrderedAt: time.Date(2026, 10, 4, 18, 10, 0, 0, time.UTC),
		TotalAmount: sp("15000"), ArkCoinsUsed: sp("5000")}}, []XpRow{{XpEarned: 3, CreatedAt: time.Date(2026, 10, 4, 17, 20, 0, 0, time.UTC)}}, now)
	eq(t, trend, []TrendPoint{{Label: "00:00", XpEarned: 3}, {Label: "01:00", Revenue: 15000, Orders: 1, ArkUsed: 5000}})
	cr, _ := CustomRange("2026-10-01", "2026-10-03")
	daily := BuildTrend("custom", cr.Start, cr.End, []DashboardOrder{{OrderedAt: time.Date(2026, 10, 2, 20, 0, 0, 0, time.UTC), TotalAmount: sp("1000")}}, nil, now)
	eq(t, []any{len(daily), daily[0].Label, daily[2].Revenue}, []any{3, "1 Okt", 1000.0})
}

func TestReportRules(t *testing.T) {
	rep := BuildRushHourReport([]RushHourPoint{
		{Hour: 12, Dow: 6, Transactions: 10, Revenue: 1_000_000},
		{Hour: 12, Dow: 7, Transactions: 4, Revenue: 200_000},
		{Hour: 19, Dow: 6, Transactions: 3, Revenue: 900_000},
		{Hour: 25, Dow: 1, Transactions: 9, Revenue: 1},
	})
	eq(t, rep.Summary.Transactions, 17.0)
	eq(t, rep.Summary.Revenue, 2_100_000.0)
	eq(t, rep.Hourly[12].AverageTicket, Round(1_200_000.0/14*100)/100)
	eq(t, *rep.PeakHour.Hour, 12)
	eq(t, *rep.PeakDay.DowLabel, "Sab")
	eq(t, len(rep.Heatmap), 105)

	_, msg := ParseReportRange("2026-10-09", "2026-10-01", time.Now())
	eq(t, msg, "Tanggal dari tidak boleh melebihi tanggal sampai")
	rr, _ := ParseReportRange("bad", "", time.Date(2026, 10, 4, 18, 0, 0, 0, time.UTC))
	eq(t, []string{rr.DateFrom, rr.DateTo, rr.StartIso}, []string{"2026-10-01", "2026-10-05", "2026-10-01T00:00:00.000+07:00"})

	eq(t, EnumeratePeriods("2026-01-30", "2026-02-02", "day"), []string{"2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"})
	eq(t, EnumeratePeriods("2025-11-15", "2026-02-02", "month"), []string{"2025-11", "2025-12", "2026-01", "2026-02"})
	eq(t, EnumeratePeriods("2026-02-02", "2026-01-30", "day"), []string{})
	eq(t, PeriodLabel("2026-10", "month"), "Oktober 2026")
	eq(t, PeriodLabel("2026-10-04", "day"), "4 Okt 2026")
	eq(t, PaymentMethodKey(sp("credit"), nil), "credit_card")
	eq(t, PaymentMethodKey(sp("cash"), sp(" BCA ")), "bca")
	eq(t, PaymentMethodKey(nil, nil), "unknown")
	eq(t, PaymentMethodLabel("cash", "bca", "Transfer BCA"), "Transfer BCA")
	eq(t, PaymentMethodLabel("cash", "cash", "Cash"), "Tunai")
	eq(t, PaymentMethodLabel("Lainnya", "", ""), "Lainnya")

	id, label := ProfitCategory(sp("KOPI"), sp("Kopi Susu"), nil)
	eq(t, []string{id, label}, []string{"KOPI", "Kopi Susu"})
	id, label = ProfitCategory(sp("Minuman"), nil, sp("Dessert"))
	eq(t, []string{id, label}, []string{"uncategorized", "Tanpa kategori"})
	eq(t, *LookupItemCategoryName(sp("kp"), ItemCategoryLabels([]ItemCategory{{Code: sp("KP"), Nama: sp("Kopi")}})), "Kopi")
	eq(t, RevenueGroup(sp("BAKERY-BAR"), nil, nil), "food")
	eq(t, RevenueGroup(nil, sp("Minuman"), nil), "beverage")
	eq(t, RevenueGroup(nil, nil, sp("bar")), "beverage")
	b := RevenueBucket{Sales: 1000, Cost: 333.333, Quantity: 2}.Finalize(4000, 8)
	eq(t, []float64{b.Cost, b.Margin, b.CostPct, b.SalesSharePct, b.QtySharePct}, []float64{333.33, 666.67, 33.33, 25, 25})

	eq(t, IsFullDiscount(ClosingOrderAmounts{Subtotal: 50000, Discount: 50000}), true)
	eq(t, IsFullDiscount(ClosingOrderAmounts{Subtotal: 50000, Discount: 10000, Total: 40000}), false)
	eq(t, SummarizeClosingTransactions([]ClosingOrderAmounts{{50000, 50000, 0}, {20000, 0, 20000}}),
		TransactionTotals{Transactions: 2, Sales: 20000, Discount: 50000, FullDiscountTransactions: 1, FullDiscountAmount: 50000})
	day, _ := CalendarDay("2026-10-04")
	eq(t, ReportDateTitle(day), "Sunday, 04th Oct 2026")
	eq(t, Segment(sp("merchandise")), "BEV")
	eq(t, Segment(nil), "OTHER")
}

func TestSettingsRules(t *testing.T) {
	eq(t, ReceiptLines([]any{" a ", "", 1.0, "b", "c", "d", "e", "f", "g"}), []string{"a", "b", "c", "d", "e", "f"})
	eq(t, ParseGiftCardConfig(map[string]any{"presets": []any{100000.0, 50000.0, 50000.0, -1.0}, "allow_custom": false}),
		GiftCardConfig{Presets: []float64{50000, 100000}, AllowCustom: false})
	eq(t, ParseGiftCardConfig(nil), GiftCardConfig{Presets: DefaultGiftCardPresets, AllowCustom: true})
	eq(t, TopupPresets([]any{100000.0, 50000.0, 50000.0, 0.0, -1.0}), []float64{50000, 100000})
	eq(t, TopupPresets(nil), DefaultTopupPresets)

	def := DefaultBillingProfile().Charges
	eq(t, CalculateBillCharges(100_000, def, nil).Total, 100_000.0)
	tax := CalculateBillCharges(100_000, def, []string{"tax"})
	rate := 10.0
	eq(t, tax.Breakdown, []ChargeLine{{Code: "TAX", Name: "Tax", Kind: "tax", Amount: 10000, Rate: &rate, CalcMethod: "percent"}})
	res := CalculateBillCharges(100_000, []BillingCharge{
		{Code: "SERVICE", ChargeKind: "service", CalcMethod: "percent", Rate: 5, ApplyOrder: 10, IsEnabled: true, Base: "subtotal_after_discount"},
		{Code: "PACK", ChargeKind: "fee", CalcMethod: "fixed", Amount: 2000, ApplyOrder: 20, IsEnabled: true},
		{Code: "TAX", ChargeKind: "tax", CalcMethod: "percent", Rate: 10, ApplyOrder: 30, IsEnabled: true, Base: "subtotal_plus_fees"},
	}, nil)
	eq(t, []float64{res.ServiceChargeAmount, res.OtherChargesAmount, res.TaxAmount, res.Total}, []float64{5000, 2000, 10700, 117700})
	round := CalculateBillCharges(10_050, []BillingCharge{
		{Code: "TAX", ChargeKind: "tax", CalcMethod: "percent", Rate: 10, ApplyOrder: 1, IsEnabled: true},
		{Code: "ROUND", ChargeKind: "rounding", CalcMethod: "round_nearest", Rate: 100, ApplyOrder: 9, IsEnabled: true},
	}, nil)
	eq(t, []float64{round.TaxAmount, round.RoundingAdjustment, round.Total}, []float64{1005, 45, 11100})

	eq(t, SlugPaymentCode(" Transfer BCA! "), "transfer_bca")
	eq(t, ValidPaymentCode("a"), false)
	eq(t, IsBuiltInPaymentCode("credit_card"), true)
}

func TestStallRules(t *testing.T) {
	eq(t, ResolveSellStall(SellStallInput{ActiveMode: StallModeStall, ActiveStallID: "w1"}), SellStall{OK: true, WarehouseID: "w1"})
	eq(t, ResolveSellStall(SellStallInput{ActiveMode: StallModeAll}).Reason, "all_stalls")
	eq(t, ResolveSellStall(SellStallInput{ActiveMode: StallModeUnset, AssignedIDs: []string{"w2"}}).WarehouseID, "w2")
	eq(t, ResolveSellStall(SellStallInput{ActiveMode: StallModeUnset, AssignedIDs: []string{"a", "b"}}).Reason, "multiple_unselected")
	eq(t, ResolveSellStall(SellStallInput{ActiveMode: StallModeUnset}).Reason, "no_stall")
	eq(t, ResolveSellScope(SellStallInput{ActiveMode: StallModeAll}, true).Mode, "all")
	eq(t, ResolveSellScope(SellStallInput{ActiveMode: StallModeAll}, false).Mode, "blocked")
	sorted := SortStalls([]Stall{{Code: "STALL-10"}, {Code: "STALL-2"}, {Code: "BAR"}, {Code: "MAIN"}, {Code: "X", IsDefault: true}})
	codes := make([]string, len(sorted))
	for i, s := range sorted {
		codes[i] = s.Code
	}
	eq(t, codes, []string{"X", "MAIN", "BAR", "STALL-2", "STALL-10"})
}

func TestStockAlerts(t *testing.T) {
	active, inactive := true, false
	bom := []BomLine{
		{ProductID: "p1", RawMaterialID: "m1", QtyRequired: sp("2"), ProductFound: true, ProductActive: &active, ProductNama: sp("Latte")},
		{ProductID: "p1", RawMaterialID: "m2", QtyRequired: sp("1"), ProductFound: true, ProductActive: &active},
		{ProductID: "p2", RawMaterialID: "m1", QtyRequired: sp("1"), ProductFound: true, ProductActive: &inactive},
	}
	stock := map[string]RawMaterialStock{
		"m1": {ID: "m1", Nama: sp("Susu"), QtyOnhand: sp("5"), StatusStok: sp("MENIPIS")},
		"m2": {ID: "m2", QtyOnhand: sp("100")},
	}
	risk := ProductsAtRisk(bom, stock)
	if len(risk) != 1 || risk[0].MaxServings != 2 || risk[0].LimitingIngredient != "Susu" || risk[0].AlertLevel != "warning" ||
		len(risk[0].Ingredients) != 1 {
		t.Fatalf("risk = %+v", risk)
	}
	alerts := PosStockAlerts([]PosStockRow{{ID: "a", Quantity: sp("0"), MinStock: sp("2")}, {ID: "b", Quantity: sp("3"), MinStock: sp("2")}})
	eq(t, alerts, []PosStockAlert{{ID: "a", Min: 2, AlertLevel: "critical"}})
}
