package domain

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

// Expectations ported from frontend/src/lib/ticketing/*.test.ts.

func f(v float64) *float64 { return &v }
func i(v int) *int         { return &v }
func s(v string) *string   { return &v }

func debit(a float64) TabEntry  { return TabEntry{Direction: Debit, Amount: a} }
func kredit(a float64) TabEntry { return TabEntry{Direction: Kredit, Amount: a} }

func eq(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestTab(t *testing.T) {
	eq(t, ComputeTabSummary(nil), TabSummary{})
	sum := ComputeTabSummary([]TabEntry{debit(50000), debit(35000), kredit(20000)})
	eq(t, []float64{sum.Outstanding, sum.Saldo}, []float64{65000, -65000})
	eq(t, ComputeTabSummary([]TabEntry{kredit(200000), debit(50000), debit(30000)}).Saldo, 120000.0)
	drift := ComputeTabSummary([]TabEntry{debit(0.1), debit(0.2), kredit(0.3)})
	if drift.Outstanding != 0 {
		t.Fatalf("float drift: %#v", drift)
	}

	prepaid := ComputeTabSummary([]TabEntry{kredit(100000), debit(60000)})
	eq(t, CanCharge("prepaid", prepaid, 40000, nil), "")
	reason := CanCharge("prepaid", prepaid, 40001, nil)
	if !strings.Contains(reason, "top-up") || !strings.Contains(reason, "saldo Rp40.000") {
		t.Fatal(reason)
	}
	eq(t, CanCharge("prepaid", prepaid, 0, nil), "Nominal charge harus > 0")

	postpaid := ComputeTabSummary([]TabEntry{debit(450000)})
	eq(t, CanCharge("postpaid", postpaid, 50000, f(500000)), "")
	eq(t, CanCharge("postpaid", postpaid, 50001, f(500000)), "Melewati plafon tagihan Rp500.000 — silakan bayar parsial di kasir")
	eq(t, CanCharge("postpaid", postpaid, 9_999_999, nil), "")

	eq(t, PlanSettlement(ComputeTabSummary([]TabEntry{debit(150000), debit(80000)})), SettlementPlan{AmountDue: 230000})
	eq(t, PlanSettlement(ComputeTabSummary([]TabEntry{kredit(300000), debit(120000)})), SettlementPlan{RefundAmount: 180000})
	eq(t, PlanSettlement(ComputeTabSummary([]TabEntry{kredit(100000), debit(100000)})), SettlementPlan{})
	eq(t, PlanSettlement(ComputeTabSummary([]TabEntry{kredit(50000), debit(60000)})), SettlementPlan{AmountDue: 10000})
}

func high(start, end string) ProductDateRange {
	return ProductDateRange{DateKind: "high-season", StartDate: start, EndDate: end, IsActive: true}
}

func blocked(start, end string) ProductDateRange {
	return ProductDateRange{DateKind: "blok-online", StartDate: start, EndDate: end, IsActive: true}
}

func TestPricing(t *testing.T) {
	eq(t, []bool{IsValidCalendarDate("2027-03-30"), IsValidCalendarDate("2027-02-30"), IsValidCalendarDate("30-03-2027"), IsValidCalendarDate("")},
		[]bool{true, false, false, false})

	dates := []ProductDateRange{high("2027-03-20", "2027-04-05"), blocked("2027-03-25", "2027-03-27")}
	for date, want := range map[string]string{"2027-03-20": "high", "2027-04-05": "high", "2027-03-19": "regular", "2027-04-06": "regular"} {
		got, _ := ResolveSeasonKind(date, dates)
		eq(t, got, want)
	}
	got, _ := ResolveSeasonKind("2027-05-10", []ProductDateRange{blocked("2027-05-01", "2027-05-31")})
	eq(t, got, "regular")
	inactive := high("2027-03-20", "2027-04-05")
	inactive.IsActive = false
	got, _ = ResolveSeasonKind("2027-03-25", []ProductDateRange{inactive})
	eq(t, got, "regular")
	if _, ok := ResolveSeasonKind("2027-13-01", dates); ok {
		t.Fatal("invalid date accepted")
	}

	eq(t, IsDateBlockedOnline("2027-12-31", []ProductDateRange{blocked("2027-12-31", "2028-01-01")}), true)
	eq(t, IsDateBlockedOnline("2027-12-30", []ProductDateRange{blocked("2027-12-31", "2028-01-01")}), false)
	eq(t, IsDateBlockedOnline("2027-06-01", []ProductDateRange{high("2027-06-01", "2027-06-30")}), false)

	variant := PricePair{Regular: f(100000), High: f(150000)}
	eq(t, *ResolveVariantPrice(variant, nil, "regular"), 100000.0)
	eq(t, *ResolveVariantPrice(variant, nil, "high"), 150000.0)
	override := &PricePair{Regular: f(90000)}
	eq(t, *ResolveVariantPrice(variant, override, "regular"), 90000.0)
	eq(t, *ResolveVariantPrice(variant, override, "high"), 150000.0)
	if ResolveVariantPrice(PricePair{}, nil, "regular") != nil {
		t.Fatal("missing price must be nil")
	}
	eq(t, *ResolveVariantPrice(PricePair{Regular: f(0), High: f(0)}, nil, "regular"), 0.0)

	eq(t, ResolveTicketPrice("2027-03-25", false, dates, variant, nil), PriceResult{OK: true, Price: 150000, SeasonKind: "high"})
	eq(t, ResolveTicketPrice("2027-03-25", true, dates, variant, nil), PriceResult{Reason: ReasonDateBlocked})
	eq(t, ResolveTicketPrice("2027-03-28", true, dates, variant, nil), PriceResult{OK: true, Price: 150000, SeasonKind: "high"})
	eq(t, ResolveTicketPrice("2027-03-25", false, dates, PricePair{Regular: f(100000)}, nil), PriceResult{Reason: ReasonPriceMissing})

	eq(t, IsVariantPriceComplete(PricePair{Regular: f(10), High: f(20)}, nil), true)
	eq(t, IsVariantPriceComplete(PricePair{Regular: f(10)}, &PricePair{High: f(25)}), true)
	eq(t, IsVariantPriceComplete(PricePair{Regular: f(10)}, nil), false)
}

func TestBundle(t *testing.T) {
	family := []BundleComponent{
		{ComponentVariantID: "v-adult", Qty: 2, ProductName: "Tiket Masuk", VariantName: "Adult", WeightPrice: f(50000)},
		{ComponentVariantID: "v-child", Qty: 2, ProductName: "Tiket Masuk", VariantName: "Child", WeightPrice: f(25000)},
	}
	members := ExpandBundleMembers(family)
	eq(t, len(members), 4)
	eq(t, []string{members[0].ComponentVariantID, members[3].ComponentVariantID, members[0].MemberLabel, members[3].MemberLabel},
		[]string{"v-adult", "v-child", "Tiket Masuk — Adult", "Tiket Masuk — Child"})
	eq(t, *members[3].WeightPrice, 25000.0)

	shares := AllocateBundlePrice(100000, []*float64{f(50000), f(50000), f(25000), f(25000)})
	total := 0.0
	for _, s := range shares {
		total += s
	}
	eq(t, total, 100000.0)
	eq(t, Round2(shares[0]+shares[1]), 66666.67)
	eq(t, AllocateBundlePrice(100000, []*float64{f(1), f(1), f(1), f(1)}), []float64{25000, 25000, 25000, 25000})
	eq(t, AllocateBundlePrice(90000, []*float64{f(50000), nil, f(25000)}), []float64{30000, 30000, 30000})
	eq(t, AllocateBundlePrice(90000, []*float64{f(0), f(0), f(0)}), []float64{30000, 30000, 30000})
	eq(t, AllocateBundlePrice(0, []*float64{f(50000), f(25000)}), []float64{0, 0})
	tiny := AllocateBundlePrice(0.05, []*float64{f(1), f(1), f(1), f(1), f(1), f(1), f(1), f(1), f(1), f(1)})
	sum := 0.0
	for _, s := range tiny {
		if s < 0 {
			t.Fatalf("negative share %v", tiny)
		}
		sum += s
	}
	eq(t, Round2(sum), 0.05)
	eq(t, AllocateBundlePrice(100000, nil), []float64{})

	eq(t, BundleCompositionIssue(nil), "Komposisi paket masih kosong")
	eq(t, BundleCompositionIssue([]CompositionRow{{ProductName: "Kolam", VariantName: "Adult", ComponentKind: "single", ComponentStatus: "active"}}),
		`Varian komponen "Kolam — Adult" nonaktif`)
}

func TestCapacity(t *testing.T) {
	r := func(start, end string, capacity int, active bool) CapacityDateRange {
		return CapacityDateRange{StartDate: start, EndDate: end, Capacity: capacity, IsActive: active}
	}
	resolve := func(date string, def *int, o ...CapacityDateRange) *int {
		c, ok := ResolveDailyCapacity(date, def, o)
		if !ok {
			t.Fatalf("invalid %s", date)
		}
		return c
	}
	if resolve("2026-08-01", nil) != nil {
		t.Fatal("unlimited expected")
	}
	eq(t, *resolve("2026-08-01", i(500)), 500)
	eq(t, *resolve("2026-08-03", i(500), r("2026-08-01", "2026-08-07", 1000, true)), 1000)
	eq(t, *resolve("2026-08-03", nil, r("2026-08-01", "2026-08-07", 200, true)), 200)
	eq(t, *resolve("2026-08-08", i(500), r("2026-08-01", "2026-08-07", 1000, true)), 500)
	eq(t, *resolve("2026-08-07", i(500), r("2026-08-01", "2026-08-07", 100, true)), 100)
	overlap := []CapacityDateRange{r("2026-08-01", "2026-08-31", 1000, true), r("2026-08-15", "2026-08-20", 300, true)}
	eq(t, *resolve("2026-08-17", i(500), overlap...), 300)
	eq(t, *resolve("2026-08-10", i(500), overlap...), 1000)
	eq(t, *resolve("2026-08-17", i(500), r("2026-08-01", "2026-08-31", 1000, true), r("2026-08-17", "2026-08-17", 0, true)), 0)
	eq(t, *resolve("2026-08-03", i(500), r("2026-08-01", "2026-08-07", 100, false)), 500)
	if _, ok := ResolveDailyCapacity("2026-02-30", i(500), nil); ok {
		t.Fatal("invalid date accepted")
	}

	eq(t, []bool{IsCapacityExceeded(nil, 999999, 100), IsCapacityExceeded(i(100), 98, 2), IsCapacityExceeded(i(100), 99, 2), IsCapacityExceeded(i(0), 0, 1), IsCapacityExceeded(i(100), 100, 0)},
		[]bool{false, false, true, true, false})

	for _, c := range []struct {
		now   string
		grace int
		want  string
	}{{"10:30", 30, SlotOK}, {"09:30", 30, SlotOK}, {"09:29", 30, SlotTooEarly}, {"12:30", 30, SlotOK}, {"12:31", 30, SlotTooLate},
		{"09:59", 0, SlotTooEarly}, {"10:00", 0, SlotOK}, {"12:00", 0, SlotOK}, {"12:01", 0, SlotTooLate}} {
		eq(t, SlotWindowStatus(c.now, "10:00:00", "12:00:00", c.grace), c.want)
	}
	eq(t, SlotWindowStatus("11:00:00", "10:00", "12:00", 0), SlotOK)
}

func TestCalendar(t *testing.T) {
	eq(t, []string{AddDaysISO("2026-12-31", 1), AddDaysISO("2028-03-01", -1), AddDaysISO("2026-10-04", -6)}, []string{"2027-01-01", "2028-02-29", "2026-09-28"})
	eq(t, []int{DaysBetweenISO("2026-01-01", "2026-04-03"), DaysBetweenISO("2026-10-04", "2026-10-04")}, []int{92, 0})
	eq(t, EachDayISO("2026-02-27", "2026-03-02"), []string{"2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"})
	eq(t, DateRangeError("2026-01-01", "2026-04-03", 92), "")
	eq(t, DateRangeError("2026-02-30", "2026-03-01", 92), "Rentang tanggal tidak valid")
	eq(t, DateRangeError("2026-03-02", "2026-03-01", 92), "Rentang tanggal tidak valid")
	eq(t, DateRangeError("", "", 92), "Rentang tanggal tidak valid")
	eq(t, DateRangeError("2026-01-01", "2026-04-04", 92), "Rentang maksimum 92 hari")
	eq(t, AddMonthsISO("2026-01-31", 1), "2026-03-03")
	eq(t, AddMonthsISO("2026-10-04", 12), "2027-10-04")

	jkt := time.Date(2026, 10, 3, 17, 30, 0, 0, time.UTC) // 00:30 WIB on the 4th
	eq(t, TodayJakarta(jkt), "2026-10-04")
	eq(t, NowJakartaTime(jkt), "00:30")
	eq(t, FormatDate("2026-10-04"), "4 Okt 2026")
	eq(t, FormatDateLong("2026-10-04"), "Minggu, 4 Oktober 2026")
	eq(t, FormatRupiah(1234567.5), "Rp1.234.568")
	eq(t, FormatRupiah(-5000), "-Rp5.000")
	eq(t, FormatRupiah(0), "Rp0")
	tenth, fifth := 0.1, 0.2
	eq(t, []string{FormatNumber(150000), FormatNumber(12.5), FormatNumber(tenth + fifth)}, []string{"150000", "12.5", "0.30000000000000004"})
	eq(t, []float64{JSNumber("12500.50"), JSNumber(""), JSNumber(" 3 "), JSNumber("0x10")}, []float64{12500.5, 0, 3, 16})
}

func TestBooking(t *testing.T) {
	eq(t, NormalizeBookingCode("  bk-abcdef "), "BK-ABCDEF")
	eq(t, NormalizeBookingCode("ABCDEF"), "BK-ABCDEF")
	eq(t, NormalizeBookingCode("bkabcdef"), "BK-ABCDEF")
	eq(t, []string{NormalizeBookingCode("BK-ABC10I"), NormalizeBookingCode("BK-ABCDE"), NormalizeBookingCode("")}, []string{"", "", ""})

	guests := []string{"g1", "g2", "g3"}
	pair := func(ids ...string) [2]string { r, g := MatchRedeemGuests(guests, ids); return [2]string{r, g} }
	eq(t, pair("g2", "g1", "g3"), [2]string{"", ""})
	eq(t, pair("g1", "asing"), [2]string{GuestForeign, "asing"})
	eq(t, pair("g1", "g1", "g2"), [2]string{GuestDouble, "g1"})
	eq(t, pair("g1", "g2"), [2]string{GuestIncomplete, "g3"})
	r, _ := MatchRedeemGuests(nil, nil)
	eq(t, r, "")

	eq(t, []string{RedeemWindowStatus("2026-07-23", "2026-07-22", nil), RedeemWindowStatus("2026-07-23", "2026-07-23", nil), RedeemWindowStatus("2026-07-23", "2026-07-24", nil)},
		[]string{RedeemNotYet, RedeemAllowed, RedeemPast})
	eq(t, IsForfeitDue("2026-07-23", "2030-01-01", nil), false)
	eq(t, RedeemWindowStatus("2026-07-23", "2026-07-24", i(0)), RedeemPast)
	eq(t, IsForfeitDue("2026-07-23", "2026-07-24", i(0)), true)
	eq(t, RedeemWindowStatus("2026-07-28", "2026-08-04", i(7)), RedeemAllowed)
	eq(t, IsForfeitDue("2026-07-28", "2026-08-05", i(7)), true)
	eq(t, IsForfeitDue("2026-08-01", "2026-07-23", i(0)), false)

	token := GenerateAccessToken()
	if len(token) != 64 || token == GenerateAccessToken() {
		t.Fatal(token)
	}
	col, key, ok := PassLookupKey(strings.Repeat("AB", 32))
	eq(t, []any{col, key, ok}, []any{"sp.access_token", strings.Repeat("ab", 32), true})
	col, key, _ = PassLookupKey("sp-20261004-0001")
	eq(t, []string{col, key}, []string{"sp.pass_code", "SP-20261004-0001"})
	col, key, _ = PassLookupKey("04:a2:3b:1c")
	eq(t, []string{col, key}, []string{"sp.band_uid", "04A23B1C"})
	_, _, ok = PassLookupKey("xyz")
	eq(t, ok, false)
	eq(t, PassCodePrefix("2026-10-04"), "SP-20261004")
}

func TestDistribution(t *testing.T) {
	v := func(id string, reg, hi *float64) VariantPrice {
		return VariantPrice{ID: id, Name: "Varian " + id, PricePair: PricePair{Regular: reg, High: hi}}
	}
	if FirstIncompleteVariant([]VariantPrice{v("a", f(10000), f(15000))}, nil) != nil {
		t.Fatal("complete variant flagged")
	}
	if FirstIncompleteVariant([]VariantPrice{v("a", f(10000), nil)}, map[string]PricePair{"a": {High: f(15000)}}) != nil {
		t.Fatal("override not applied")
	}
	eq(t, FirstIncompleteVariant([]VariantPrice{v("a", f(10000), f(15000)), v("b", nil, f(1))}, nil).ID, "b")

	board := BuildChannelBoard(BoardInput{
		Products: []BoardProduct{{ID: "p1", Code: "TKT-0001", Name: "Kolam", Status: "active", ProductKind: "single"}, {ID: "p2", Code: "TKT-0002", Name: "Kosong", Status: "draft", ProductKind: "single"}},
		Variants: []struct {
			ProductID string
			VariantPrice
		}{{"p1", v("v1", f(10000), nil)}},
		Channels:    []BoardChannel{{ChannelID: "walk", ChannelCode: "walk-in", ChannelName: "Walk-in"}, {ChannelID: "web", ChannelCode: "website", ChannelName: "Website", IsOnline: true}},
		Distributed: map[string]bool{BoardKey("p1", "walk"): true},
		Overrides:   map[string]PricePair{BoardKey("v1", "web"): {High: f(20000)}},
	})
	eq(t, board[0].Variants, []BoardVariant{{ID: "v1", Name: "Varian v1", PriceRegular: f(10000)}})
	eq(t, []bool{board[0].Channels[0].IsDistributed, board[0].Channels[0].PriceComplete, board[0].Channels[1].IsDistributed, board[0].Channels[1].PriceComplete},
		[]bool{true, false, false, true})
	eq(t, board[0].Channels[1].Overrides, []BoardOverride{{VariantID: "v1", PriceHigh: f(20000)}})
	eq(t, board[1].Channels[0].PriceComplete || board[1].Channels[1].PriceComplete, false)

	single := LoketOption{VariantID: "v", ProductKind: "single", TicketProductID: "p"}
	eq(t, BuildLoketOptions([]LoketOption{single}, nil)[0].Members, []LoketMember{})
	bundle := LoketOption{VariantID: "v", ProductKind: "bundle", TicketProductID: "bundle"}
	member := func(id, variant string, qty int, active bool, status string) LoketBundleRow {
		return LoketBundleRow{BundleProductID: "bundle", CompositionRow: CompositionRow{ComponentVariantID: id, Qty: qty, ProductName: "Kolam", VariantName: variant, ComponentStatus: status, ComponentKind: "single", VariantIsActive: active}}
	}
	opts := BuildLoketOptions([]LoketOption{bundle}, []LoketBundleRow{member("cv", "Adult", 2, true, "active"), member("cv2", "Child", 1, true, "active")})
	eq(t, opts[0].Members, []LoketMember{{"cv", 2, "Kolam — Adult"}, {"cv2", 1, "Kolam — Child"}})
	eq(t, opts[0].MembersPerUnit, 3)
	eq(t, len(BuildLoketOptions([]LoketOption{bundle}, nil)), 0)
	eq(t, len(BuildLoketOptions([]LoketOption{bundle}, []LoketBundleRow{member("cv", "Adult", 2, false, "active")})), 0)
	eq(t, len(BuildLoketOptions([]LoketOption{bundle}, []LoketBundleRow{member("cv", "Adult", 2, true, "draft")})), 0)

	eq(t, PlanDateUnmark("2026-10-04", "2026-10-04", "2026-10-04"), DateUnmarkPlan{Kind: "delete"})
	eq(t, PlanDateUnmark("2026-10-01", "2026-10-05", "2026-10-01"), DateUnmarkPlan{Kind: "set-start", Start: "2026-10-02"})
	eq(t, PlanDateUnmark("2026-10-01", "2026-10-05", "2026-10-05"), DateUnmarkPlan{Kind: "set-end", End: "2026-10-04"})
	eq(t, PlanDateUnmark("2026-09-30", "2026-10-05", "2026-10-01"), DateUnmarkPlan{Kind: "split", LeftEnd: "2026-09-30", RightStart: "2026-10-02"})
}

func TestReports(t *testing.T) {
	empty := BuildTicketingReport("2026-10-01", "2026-10-03", ReportRows{})
	eq(t, len(empty.Daily), 3)
	eq(t, empty.Booking, BookingRecognition{})
	eq(t, empty.Hanging, HangingSummary{Items: []HangingTab{}})

	ledger := BuildTicketingReport("2026-10-01", "2026-10-01", ReportRows{
		Ledger: []LedgerRow{
			{"2026-10-01", "tiket", 50000.004, 2}, {"2026-10-01", "fnb", 20000, 1}, {"2026-10-01", "pembayaran", -60000, -1},
			{"2026-10-01", "deposit", -10000, -1}, {"2026-10-01", "diskon", -5000, -1}, {"2026-10-01", "refund-deposit", 2500, 1},
		},
		VisitDaily: []CountRow{{Key: "2026-10-01", N: 4}},
	})
	eq(t, ledger.Summary, ReportSummary{VisitsOpened: 4, TiketNet: 50000, FnbNet: 20000, UangMasuk: 70000, RefundKeluar: 2500, DiskonPromo: 5000})
	eq(t, ledger.Daily[0], ReportDay{Date: "2026-10-01", Visits: 4, TiketNet: 50000, FnbNet: 20000, UangMasuk: 70000})

	gate := BuildTicketingReport("2026-10-01", "2026-10-01", ReportRows{GateDaily: []CountRow{
		{"2026-10-01", "masuk", 10}, {"2026-10-01", "masuk-lagi", 3}, {"2026-10-01", "masuk-karyawan", 2}, {"2026-10-01", "ditolak-plafon", 1}, {"2026-10-01", "ditolak-sudah-masuk", 4},
	}})
	eq(t, []int{gate.Summary.OrangMasuk, gate.Summary.MasukLagi, gate.Summary.MasukKaryawan, gate.Summary.TapDitolak, gate.Daily[0].Masuk, gate.Daily[0].MasukLagi},
		[]int{10, 3, 2, 5, 10, 3})

	tickets := BuildTicketingReport("2026-10-01", "2026-10-01", ReportRows{
		TicketContexts: []TicketContextRow{
			{VariantID: s("v1"), ChannelID: s("c1"), SeasonKind: s("high"), Net: 30000, Qty: 2},
			{VariantID: s("v2"), BundleProductID: s("b1"), Net: 45000, Qty: 3},
			{Net: 1000, Qty: 1},
		},
		VariantNames: map[string]VariantName{"v1": {"Adult", "Kolam"}, "v2": {"Child", "Kolam"}},
		ChannelNames: map[string]string{"c1": "Walk-in"},
	}).Tickets
	labels := func(a []Agg) []string {
		out := []string{}
		for _, x := range a {
			out = append(out, x.Label)
		}
		return out
	}
	eq(t, labels(tickets.Products), []string{"Kolam — Child", "Kolam — Adult", "(tanpa konteks)"})
	eq(t, tickets.Channels, []Agg{{"(tanpa kanal)", 4, 46000}, {"Walk-in", 2, 30000}})
	eq(t, labels(tickets.Seasons), []string{"alokasi paket", "high", "(tanpa musim)"})
	eq(t, tickets.Bundles, []Agg{{"(paket terhapus)", 3, 45000}})

	booking := BuildTicketingReport("2026-10-01", "2026-10-01", ReportRows{
		DepositCount: 2, DepositTotal: 150000, ForfeitedCount: 1, ForfeitedTotal: 75000.005,
		Hanging:    []HangingTab{{ID: "h1", Outstanding: 12000.5}, {ID: "h2", Outstanding: 8000}},
		BandsRecap: []CountRow{{Key: "tersedia", N: 40}},
	})
	eq(t, booking.Booking, BookingRecognition{TitipanCount: 2, TitipanTotal: 150000, HangusCount: 1, HangusTotal: 75000.01})
	eq(t, []float64{float64(booking.Hanging.Count), booking.Hanging.Total}, []float64{2, 20000.5})
	eq(t, booking.Bands, []BandCount{{"tersedia", 40}})
}

func TestBookingMessages(t *testing.T) {
	b := PaidBooking{BookingCode: "BK-ABC234", AccessToken: "tok", VisitDate: "2026-10-04", CustomerName: "Budi", Total: 150000}
	msg := BookingPaidMessage("https://tiket.example", b)
	for _, want := range []string{"Kode booking: *BK-ABC234*", "Tanggal kunjungan: Minggu, 4 Oktober 2026", "Total: Rp150.000\n\n", "https://tiket.example/booking/status/tok"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("missing %q in %q", want, msg)
		}
	}
	if strings.Contains(msg, "Potongan promo") {
		t.Fatal(msg)
	}
	b.Discount = 25000
	if !strings.Contains(BookingPaidMessage("", b), "Total: Rp150.000\nPotongan promo: -Rp25.000\nDibayar: Rp125.000") {
		t.Fatal("discount lines")
	}
	b.Discount = 0
	b.GiftRecipientName, b.GiftRecipientPhone = s("Ani"), s("6282")
	if !strings.Contains(BookingPaidMessage("", b), "E-tiket HADIAH telah dikirim ke WA Ani") {
		t.Fatal("gift notice")
	}
	gift := BookingGiftMessage("", b)
	if !strings.Contains(gift, "Dari: Budi\nUntuk: *Ani*") || !strings.Contains(gift, "Tanggal kunjungan: Minggu, 4 Oktober 2026") {
		t.Fatal(gift)
	}
}
