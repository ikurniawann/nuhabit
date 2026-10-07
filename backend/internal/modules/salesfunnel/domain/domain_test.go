package domain

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"
)

func eq(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func jsonOf(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

/* sql.test.ts */

func TestWhere(t *testing.T) {
	w := NewWhere([]string{"l.deleted_at IS NULL"}, 1)
	w.Add("l.company_id = ?", "c1")
	me := w.Param("u1")
	w.Push("(l.owner_user_id = " + me + " OR l.created_by = " + me + ")")
	eq(t, w.SQL(), "l.deleted_at IS NULL AND l.company_id = $1 AND (l.owner_user_id = $2 OR l.created_by = $2)")
	eq(t, w.Params, []any{"c1", "u1"})

	w = NewWhere(nil, 3)
	w.Add("d.company_id = ?", "c1")
	eq(t, w.SQL(), "d.company_id = $3")
}

func TestUpdateSet(t *testing.T) {
	u := NewUpdateSet()
	u.Set("name", "A", "")
	u.Set("city", nil, "")
	u.Set("custom", "{}", "::jsonb")
	u.Raw("reminder_sent_at = NULL")
	sql, values, idParam, ok := u.Build("id-1")
	eq(t, sql, "updated_at = now(), name = $1, city = $2, custom = $3::jsonb, reminder_sent_at = NULL")
	eq(t, values, []any{"A", nil, "{}", "id-1"})
	eq(t, idParam, "$4")
	eq(t, ok, true)

	if _, _, _, ok := NewUpdateSet().Build("id-1"); ok {
		t.Fatal("an empty PATCH must fail")
	}
}

func TestParsePagination(t *testing.T) {
	eq(t, ParsePagination("", ""), Pagination{1, 20, 0})
	eq(t, ParsePagination("3", "500"), Pagination{3, 100, 200})
	eq(t, ParsePagination("-1", "abc"), Pagination{1, 20, 0})
}

func TestUUIDAndSlug(t *testing.T) {
	eq(t, IsUUID("3f2c1e4a-1b2c-4d5e-8f90-1234567890ab"), true)
	eq(t, IsUUID("bukan-uuid"), false)
	eq(t, IsUUID(""), false)
	eq(t, Slugify("  Paket Gathering & Outbound! ", 40), "paket-gathering-outbound")
	eq(t, Slugify("Field Trip Sekolah", 5), "field")
}

func TestJSNumber(t *testing.T) {
	eq(t, JSNumber(" 12 "), 12.0)
	eq(t, JSNumber("0x10"), 16.0)
	eq(t, JSNumber(""), 0.0)
	if !math.IsNaN(JSNumber("12abc")) || !math.IsNaN(JSNumber("inf")) {
		t.Fatal("non-numbers must be NaN")
	}
}

/* server.ts helpers */

func TestPhoneAndDates(t *testing.T) {
	eq(t, NormalizePhone("0812-3456-7890"), "6281234567890")
	eq(t, NormalizePhone("812 3456 7890"), "6281234567890")
	eq(t, NormalizePhone("+62 812 3456 7890"), "6281234567890")
	eq(t, IsValidNormalizedPhone("62812"), false)
	eq(t, IsValidCalendarDate("2026-02-29"), false)
	eq(t, IsValidCalendarDate("2028-02-29"), true)
	eq(t, IsParsableISODate("2026-02-30"), true)
	eq(t, IsParsableISODate("2026-02-32"), false)
	pic, venue := "Budi", "Lembang"
	eq(t, RenderWaTemplate("  Halo {pic}  di {venue} {acara}  ", map[string]*string{"pic": &pic, "venue": &venue}), "Halo Budi di Lembang")
}

func TestRowForbidden(t *testing.T) {
	company, branch, level := "c1", "b1", "branch"
	s := Scope{CompanyID: &company, BranchID: &branch, BusinessScope: &level}
	owner := "u2"
	eq(t, RowForbidden("u1", "sales", s, Venue{CompanyID: "c1", BranchID: "b1"}), false)
	eq(t, RowForbidden("u1", "sales", s, Venue{CompanyID: "c1", BranchID: "b1", OwnerUserID: &owner}), true)
	eq(t, RowForbidden("u1", "admin", s, Venue{CompanyID: "c1", BranchID: "b2"}), true)
	eq(t, RowForbidden("u1", "admin", Scope{}, Venue{CompanyID: "c1", BranchID: "b1"}), true)
	eq(t, RowForbidden("u1", "super_admin", Scope{}, Venue{CompanyID: "c1", BranchID: "b1"}), false)
}

/* tasks.test.ts */

func TestResolveTaskSubjectAndStatus(t *testing.T) {
	const u1, u2 = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
	eq(t, *ResolveTaskSubject("account", u2, u1, u2), Subject{"deal", u1})
	eq(t, *ResolveTaskSubject("member", u1, "", ""), Subject{"member", u1})
	if ResolveTaskSubject("", "", "", "") != nil {
		t.Fatal("no subject")
	}
	yes, no := true, false
	eq(t, ResolveTaskStatus("cancelled", &yes), "cancelled")
	eq(t, ResolveTaskStatus("", &yes), "done")
	eq(t, ResolveTaskStatus("", &no), "open")
	eq(t, ResolveTaskStatus("", nil), "")
}

func iso(tm *time.Time) string { return tm.UTC().Format("2006-01-02T15:04:05.000Z") }

func TestNextOccurrence(t *testing.T) {
	from := time.Date(2026, 1, 31, 2, 0, 0, 0, time.UTC)
	eq(t, iso(NextOccurrence(from, Recurrence{Freq: "daily", Interval: 3})), "2026-02-03T02:00:00.000Z")
	eq(t, iso(NextOccurrence(from, Recurrence{Freq: "weekly", Interval: 2})), "2026-02-14T02:00:00.000Z")
	eq(t, iso(NextOccurrence(from, Recurrence{Freq: "monthly", Interval: 1})), "2026-02-28T02:00:00.000Z")
	until, later := "2026-01-31", "2026-02-01"
	if NextOccurrence(from, Recurrence{Freq: "daily", Interval: 1, Until: &until}) != nil {
		t.Fatal("past until")
	}
	if NextOccurrence(from, Recurrence{Freq: "daily", Interval: 1, Until: &later}) == nil {
		t.Fatal("until is inclusive")
	}
}

func TestSpawnNextTask(t *testing.T) {
	due := time.Date(2026, 9, 15, 9, 0, 0, 0, time.UTC)
	rem := time.Date(2026, 9, 15, 8, 0, 0, 0, time.UTC)
	next, nextRem, ok := SpawnNextTask(due, &rem, Recurrence{Freq: "weekly", Interval: 1})
	eq(t, ok, true)
	eq(t, iso(&next), "2026-09-22T09:00:00.000Z")
	eq(t, iso(nextRem), "2026-09-22T08:00:00.000Z")
	if _, r, _ := SpawnNextTask(due, nil, Recurrence{Freq: "daily", Interval: 1}); r != nil {
		t.Fatal("no reminder stays nil")
	}
	until := "2026-09-15"
	if _, _, ok := SpawnNextTask(due, nil, Recurrence{Freq: "daily", Interval: 1, Until: &until}); ok {
		t.Fatal("series over")
	}
}

func TestParseRecurrence(t *testing.T) {
	var v any
	_ = json.Unmarshal([]byte(`{"freq":"weekly","interval":2,"until":null}`), &v)
	r, ok := ParseRecurrence(v)
	eq(t, ok, true)
	eq(t, r.Interval, 2)
	_ = json.Unmarshal([]byte(`{"freq":"weekly","extra":1}`), &v)
	if _, ok := ParseRecurrence(v); ok {
		t.Fatal("strict object")
	}
}

/* deals.test.ts */

const nowISO = "2026-10-04T07:00:00.000Z"

func body(kv ...any) *Fields {
	f := NewFields()
	for i := 0; i+1 < len(kv); i += 2 {
		f.Set(kv[i].(string), kv[i+1])
	}
	return f
}

func TestPlanStageMove(t *testing.T) {
	open := StageFlags{Probability: 60}
	won := StageFlags{IsWon: true, Probability: 100}
	lost := StageFlags{IsLost: true}

	b := body("stage_id", "s2", "lost_reason_id", "r1")
	cols, err := PlanStageMove(open, b, nil, nil, nowISO)
	eq(t, err, nil)
	eq(t, b.Get("lost_reason_id"), nil)
	eq(t, jsonOf(t, cols), `{"forecast_category":"best_case","closed_at":null,"entered_stage_at":"`+nowISO+`"}`)

	cols, _ = PlanStageMove(open, body("stage_id", "s2", "forecast_category", "commit"), nil, nil, nowISO)
	eq(t, cols.Has("forecast_category"), false)

	_, err = PlanStageMove(won, body("stage_id", "w"), nil, "2026-11-01", nowISO)
	eq(t, err, error(StageMoveError("Deal Menang wajib diisi nilai final")))
	_, err = PlanStageMove(won, body("stage_id", "w", "value_final", 5_000_000.0), nil, nil, nowISO)
	eq(t, err, error(StageMoveError("Deal Menang wajib punya tanggal acara fix")))

	b = body("stage_id", "w", "lost_reason_id", "r1")
	cols, _ = PlanStageMove(won, b, "5000000", "2026-11-01", nowISO)
	eq(t, b.Get("is_event_date_fixed"), true)
	eq(t, b.Get("lost_reason_id"), nil)
	eq(t, jsonOf(t, cols), `{"forecast_category":"closed_won","closed_at":"`+nowISO+`","entered_stage_at":"`+nowISO+`"}`)

	_, err = PlanStageMove(lost, body("stage_id", "l"), nil, nil, nowISO)
	eq(t, err, error(StageMoveError("Deal Kalah wajib pilih alasan kalah")))
	b = body("stage_id", "l", "lost_reason_id", "r1")
	cols, _ = PlanStageMove(lost, b, nil, nil, nowISO)
	eq(t, b.Get("lost_reason_id"), "r1")
	eq(t, cols.Get("closed_at"), nowISO)
}

/* forecast.test.ts */

func ptr[T any](v T) *T { return &v }

func TestCategoryAndMonth(t *testing.T) {
	eq(t, CategoryFromStage(StageFlags{IsWon: true, Probability: 100}), "closed_won")
	eq(t, CategoryFromStage(StageFlags{IsLost: true}), "closed_lost")
	eq(t, CategoryFromStage(StageFlags{Probability: 75}), "commit")
	eq(t, CategoryFromStage(StageFlags{Probability: 50}), "best_case")
	eq(t, CategoryFromStage(StageFlags{Probability: 49}), "pipeline")
	from, to := MonthRange("2026-12")
	eq(t, []string{from, to}, []string{"2026-12-01", "2027-01-01"})
	from, to = MonthRange("2026-09")
	eq(t, []string{from, to}, []string{"2026-09-01", "2026-10-01"})
}

func TestAggregateForecast(t *testing.T) {
	u1, ani := "u1", "Ani"
	rows := AggregateForecast([]ForecastDeal{
		{OwnerUserID: &u1, OwnerName: &ani, Value: 10_000_000, Probability: 100, Category: "closed_won"},
		{OwnerUserID: &u1, OwnerName: &ani, Value: 20_000_000, Probability: 75, Category: "commit"},
		{OwnerUserID: &u1, OwnerName: &ani, Value: 8_000_000, Probability: 50, Category: "best_case"},
		{OwnerUserID: &u1, OwnerName: &ani, Value: 5_000_000, Category: "closed_lost"},
		{Value: 4_000_000, Probability: 10, Category: "pipeline"},
	}, []Target{{UserID: &u1, TargetValue: 50_000_000, TargetDeals: ptr[int64](3)}},
		[]ForecastUser{{"u1", "Ani"}, {"u2", "Budi"}})
	var a, b *ForecastRow
	for _, r := range rows {
		if r.UserID != nil && *r.UserID == "u1" {
			a = r
		}
		if r.UserID != nil && *r.UserID == "u2" {
			b = r
		}
	}
	eq(t, a.WonValue, 10_000_000.0)
	eq(t, a.WonDeals, 1)
	eq(t, a.CommitValue, 20_000_000.0)
	eq(t, a.BestCaseValue, 8_000_000.0)
	eq(t, a.WeightedValue, 19_000_000.0)
	eq(t, a.OpenDeals, 2)
	eq(t, a.AttainmentPercent, 58.0)
	eq(t, a.Gap, 21_000_000.0)
	eq(t, b.WonValue, 0.0)
	none := rows[len(rows)-1]
	if none.UserID != nil {
		t.Fatal("unowned row last")
	}
	eq(t, none.PipelineValue, 4_000_000.0)
	total := SumForecast(rows, nil)
	eq(t, total.TargetValue, 50_000_000.0)
	eq(t, total.WeightedValue, 19_400_000.0)
}

func TestCompanyTarget(t *testing.T) {
	u1, u2, ani := "u1", "u2", "Ani"
	targets := []Target{
		{UserID: &u1, TargetValue: 30_000_000, TargetDeals: ptr[int64](2)},
		{UserID: &u2, TargetValue: 20_000_000},
		{TargetValue: 80_000_000, TargetDeals: ptr[int64](5)},
	}
	company, users := SplitTargets(targets)
	eq(t, jsonOf(t, company), `{"target_value":80000000,"target_deals":5}`)
	eq(t, len(users), 2)
	rows := AggregateForecast([]ForecastDeal{{OwnerUserID: &u1, OwnerName: &ani, Value: 40_000_000, Probability: 100, Category: "closed_won"}},
		targets, []ForecastUser{{"u1", "Ani"}, {"u2", "Budi"}})
	for _, r := range rows {
		if r.UserID == nil {
			t.Fatal("company target must not add an unowned row")
		}
	}
	total := SumForecast(rows, company)
	eq(t, *total.CompanyTargetSet, true)
	eq(t, total.TargetValue, 80_000_000.0)
	eq(t, *total.TargetDeals, int64(5))
	eq(t, *total.AllocatedTargetValue, 50_000_000.0)
	eq(t, total.AttainmentPercent, 50.0)
	eq(t, total.Gap, 40_000_000.0)
	plain := SumForecast(rows, nil)
	eq(t, *plain.CompanyTargetSet, false)
	eq(t, plain.TargetValue, 50_000_000.0)
}

/* quotations.test.ts */

func TestTermsAndAllocation(t *testing.T) {
	eq(t, TermsSumTo100(nil), true)
	eq(t, TermsSumTo100([]QuotationTerm{{Percent: 33.33}, {Percent: 33.33}, {Percent: 33.34}}), true)
	eq(t, TermsSumTo100([]QuotationTerm{{Percent: 50}, {Percent: 40}}), false)

	a := AllocateTermAmounts(10_000_000, []float64{33.33, 33.33, 33.34})
	eq(t, a, []float64{3_333_000, 3_333_000, 3_334_000})
	b := AllocateTermAmounts(1000.01, []float64{50, 50})
	eq(t, math.Round((b[0]+b[1])*100)/100, 1000.01)
	eq(t, AllocateTermAmounts(5000, nil), []float64{})
}

func TestTermProgress(t *testing.T) {
	d := "2026-08-01"
	terms := []TermInput{{Label: "DP", Percent: 50}, {Label: "Pelunasan", DueDate: &d, Percent: 50}}
	status := func(p []TermProgress) []string {
		out := make([]string, len(p))
		for i, x := range p {
			out[i] = x.Status
		}
		return out
	}
	p := TermProgressOf(terms, 10_000_000, 0)
	eq(t, status(p), []string{"belum", "belum"})
	eq(t, p[0].Amount, 5_000_000.0)
	eq(t, status(TermProgressOf(terms, 10_000_000, 5_000_000)), []string{"lunas", "belum"})
	p = TermProgressOf(terms, 10_000_000, 7_000_000)
	eq(t, []any{p[0].Status, p[0].Paid, p[1].Status, p[1].Paid}, []any{"lunas", 5_000_000.0, "sebagian", 2_000_000.0})
	p = TermProgressOf(terms, 10_000_000, 12_000_000)
	eq(t, status(p), []string{"lunas", "lunas"})
	eq(t, p[1].Paid, 5_000_000.0)
}

func TestComputeTotals(t *testing.T) {
	p := &QuotationPayload{UsePpn: true, PpnPersen: 11, DiscountPercent: 10,
		Items: []QuotationItem{{Qty: 3, UnitPrice: 33_333.33}, {Qty: 1.5, UnitPrice: 1000}}}
	tot := ComputeTotals(p)
	eq(t, p.Items[0].LineTotal, 99_999.99)
	eq(t, tot.Subtotal, 101_499.99)
	eq(t, tot.DiscountNominal, 10_150.0)
	eq(t, tot.PpnNominal, 10_048.5)
	eq(t, tot.Total, 101_398.49)
}

func TestQuotationWaMessage(t *testing.T) {
	branch, event := "Lembang", "2026-11-07"
	msg := BuildQuotationWaMessage(QuotationWaSummary{QuoteNumber: "QT-2610-0001", BranchName: &branch, PicName: "Budi",
		DealTitle: "Gathering Akhir Tahun", OrgName: "PT Maju", UsePpn: true, PpnPersen: 11, Subtotal: 1_000_000,
		PpnNominal: 110_000, Total: 1_110_000, EventDate: &event},
		[]QuotationWaItem{{Description: "Paket Makan", ItemType: "produk", Qty: 50, UnitPrice: 20_000, LineTotal: 1_000_000}})
	eq(t, strings.Split(msg, "\n"), []string{
		"*PENAWARAN QT-2610-0001*",
		"_Lembang_",
		"",
		"Halo Budi, berikut ringkasan penawaran untuk *Gathering Akhir Tahun* (PT Maju):",
		"",
		"• Paket Makan — 50 pax @ Rp20.000 = *Rp1.000.000*",
		"",
		"Subtotal: Rp1.000.000",
		"PPN 11%: Rp110.000",
		"*TOTAL: Rp1.110.000*",
		"",
		"Tanggal acara: Sabtu, 7 November 2026",
		"",
		"Bila sudah sesuai, mohon konfirmasinya ya 🙏",
	})
}

/* billing.test.ts */

func TestBilling(t *testing.T) {
	eq(t, PaymentStatus(1000, 1000), "lunas")
	eq(t, PaymentStatus(1200, 1000), "lunas")
	eq(t, PaymentStatus(1, 1000), "sebagian")
	eq(t, PaymentStatus(0, 1000), "belum")
	eq(t, PaymentStatus(0, 0), "belum")
	eq(t, ReferenceTotal("diterima", "8500000", true, "9000000", "7000000"), 8_500_000.0)
	eq(t, ReferenceTotal("terkirim", "8500000", true, "9000000", "7000000"), 9_000_000.0)
	eq(t, ReferenceTotal("draft", "8500000", true, nil, "7000000"), 8_500_000.0)
	eq(t, ReferenceTotal("", nil, false, nil, "7000000"), 7_000_000.0)
	eq(t, ReferenceTotal("", nil, false, nil, nil), 0.0)
	eq(t, RoundCents(0.1+0.2), 0.3)
	eq(t, RoundCents(1234.565), 1234.57)
}

/* realization.test.ts */

func TestRealization(t *testing.T) {
	w1, w2 := "w1", "w2"
	stock := []StockRow{
		{ID: "inv-a1", RawMaterialID: "gula", WarehouseID: &w1, QtyAvailable: 3},
		{ID: "inv-a2", RawMaterialID: "gula", WarehouseID: &w2, QtyAvailable: 5},
		{ID: "inv-b1", RawMaterialID: "kopi", WarehouseID: &w1, QtyAvailable: 1.2},
	}
	eq(t, FindShortfalls([]MaterialRequirement{{"gula", 8}}, stock), []Shortfall{})
	eq(t, FindShortfalls([]MaterialRequirement{{"gula", 8.5}}, stock), []Shortfall{{"gula", 8.5, 8}})
	eq(t, FindShortfalls([]MaterialRequirement{{"susu", 2}}, stock), []Shortfall{{"susu", 2, 0}})
	eq(t, FindShortfalls([]MaterialRequirement{{"kopi", 1.2000000001}}, stock), []Shortfall{})

	eq(t, PlanDeductions([]MaterialRequirement{{"gula", 6}}, stock), []StockDeduction{
		{"inv-a2", "gula", &w2, 5, 5, 0},
		{"inv-a1", "gula", &w1, 1, 3, 2},
	})
	eq(t, PlanDeductions([]MaterialRequirement{{"kopi", 0.5}}, stock), []StockDeduction{
		{"inv-b1", "kopi", &w1, 0.5, 1.2, 0.7},
	})
}

/* timeline.test.ts and reports-server.test.ts */

func keys(events []TimelineEvent) []string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i] = e.Key
	}
	return out
}

func TestMergeTimeline(t *testing.T) {
	title, ani := "Kirim proposal", "Ani"
	task := TimelineTask{ID: "t1", ActivityType: "tugas", Title: &title, DueAt: "2026-09-10T02:00:00Z",
		Status: "open", Priority: "high", CreatedAt: "2026-09-01T00:00:00Z", OwnerName: &ani}
	body, read := "Halo, boleh minta penawaran?", "read"
	events := MergeTimeline(TimelineSources{
		Tasks:      []TimelineTask{task, task},
		Stages:     []TimelineStage{{ID: "s1", DealID: "d1", DealTitle: "Gathering", StageName: "Nego", EnteredAt: "2026-09-12T03:00:00Z"}},
		Quotations: []TimelineQuotation{{ID: "q1", DealID: "d1", QuoteNumber: "Q-001", Status: "draft", Total: 1_500_000, CreatedAt: "2026-09-11T03:00:00Z"}},
		WaMessages: []TimelineWa{{ID: "w1", Direction: "inbound", Body: &body, Status: &read, CreatedAt: "2026-09-09T01:00:00Z"}},
	}, 100)
	eq(t, keys(events), []string{"stage:s1", "quotation:q1", "task:t1", "wa:w1"})
	if !strings.Contains(events[1].Get("title").(string), "Rp1.500.000") {
		t.Fatal("quotation title")
	}
	eq(t, events[3].Get("title"), "WA masuk")
}

func TestNormalizeTasks(t *testing.T) {
	follow, notes, trip := "Follow up", "tidak diangkat", "Field Trip"
	out := NormalizeTasks([]TimelineTask{
		{ID: "a", ActivityType: "tugas", Title: &follow, DueAt: "2026-09-01T00:00:00Z", DoneAt: "2026-09-03T00:00:00Z",
			Status: "done", Priority: "normal", CreatedAt: "2026-08-30T00:00:00Z"},
		{ID: "b", ActivityType: "telepon", Notes: &notes, Status: "open", Priority: "normal",
			CreatedAt: "2026-08-31T00:00:00Z", DealTitle: &trip},
	})
	eq(t, out[0].At, "2026-09-03T00:00:00Z")
	eq(t, out[0].Get("kind"), "task")
	eq(t, out[1].Get("kind"), "activity")
	eq(t, out[1].Get("title"), "Telepon · Field Trip")
}

func TestTimelineLimitAndInvalidDates(t *testing.T) {
	events := MergeTimeline(TimelineSources{Leads: []TimelineLead{
		{ID: "l1", OrgName: "A", Status: "baru", CreatedAt: "not-a-date"},
		{ID: "l2", OrgName: "B", Status: "baru", CreatedAt: "2026-09-02T00:00:00Z"},
		{ID: "l3", OrgName: "C", Status: "baru", CreatedAt: "2026-09-03T00:00:00Z"},
	}}, 2)
	eq(t, keys(events), []string{"lead:l3", "lead:l2"})
}

func TestTimelineDateSortsAtSeconds(t *testing.T) {
	// Two DB timestamps 300 ms apart compare equal (Date.parse(date)), so
	// the source order wins.
	a := JSDate(time.Date(2026, 9, 1, 10, 0, 0, 100_000_000, time.UTC))
	b := JSDate(time.Date(2026, 9, 1, 10, 0, 0, 400_000_000, time.UTC))
	events := MergeTimeline(TimelineSources{Leads: []TimelineLead{{ID: "a", CreatedAt: a}, {ID: "b", CreatedAt: b}}}, 10)
	eq(t, keys(events), []string{"lead:a", "lead:b"})
	eq(t, jsonOf(t, events[0].Get("at")), `"2026-09-01T10:00:00.100Z"`)
}

func TestReportHelpers(t *testing.T) {
	now := time.Date(2026, 10, 4, 5, 0, 0, 0, time.UTC)
	eq(t, ResolveReportPeriod("", "", now), ReportPeriod{"2026-07-06", "2026-10-04"})
	eq(t, ResolveReportPeriod("2026-09-30", "2026-09-01", now), ReportPeriod{"2026-09-01", "2026-09-30"})
	eq(t, ResolveReportPeriod("30/09/2026", "2026-10-01", now).From, "2026-07-06")

	company, branch, level := "c1", "b1", "branch"
	sql, params := DealScopeSQL("u1", "sales", Scope{CompanyID: &company, BranchID: &branch, BusinessScope: &level}, 3)
	eq(t, sql, "AND d.company_id = $3 AND d.branch_id = $4 AND (d.owner_user_id = $5 OR d.owner_user_id IS NULL)")
	eq(t, params, []any{"c1", "b1", "u1"})
	sql, params = DealScopeSQL("u1", "super_admin", Scope{}, 1)
	eq(t, sql, "")
	eq(t, params, []any(nil))

	changes := DiffChanges(map[string]any{"status": "baru", "city": "Bandung"},
		body("status", "qualified", "city", "Bandung", "notes", "x"))
	eq(t, jsonOf(t, changes), `{"status":{"from":"baru","to":"qualified"},"notes":{"to":"x"}}`)

	eq(t, TimelineScopeSQL("member"), TimelineScope{"FALSE", "FALSE", "(a.subject_type = 'member' AND a.subject_id = $1)"})
	eq(t, TimelineScopeSQL("deal").DealWhere, "d.id = $1")
	eq(t, PhoneSuffixes([]string{"0812-3456-7890", "+62 812 3456 7890", "123"}), []string{"234567890", "234567890"})

	m, ok := ParseMonth(ptr("2026-10"), now)
	eq(t, []any{m, ok}, []any{"2026-10", true})
	_, ok = ParseMonth(ptr("10-2026"), now)
	eq(t, ok, false)
	m, _ = ParseMonth(nil, now)
	eq(t, m, "2026-10")
}

/* custom-fields validation */

func TestValidateCustomValues(t *testing.T) {
	defs := []CustomFieldDef{
		{Key: "budget", Label: "Budget", FieldType: "number", Validation: map[string]any{"min": 1.0}},
		{Key: "size", Label: "Ukuran", FieldType: "picklist", Options: []string{"S", "M"}, IsRequired: true},
		{Key: "tags", Label: "Tag", FieldType: "multipicklist", Options: []string{"a", "b"}},
	}
	values, errs := ValidateCustomValues(defs, map[string]any{"budget": "25.000.000", "size": "M", "tags": "a, b", "ghost": 1}, false)
	eq(t, len(errs), 0)
	eq(t, values, map[string]any{"budget": 25_000_000.0, "size": "M", "tags": []string{"a", "b"}})

	_, errs = ValidateCustomValues(defs, map[string]any{"budget": "0"}, false)
	eq(t, JoinCustomErrors(errs), "Budget minimal 1; Ukuran wajib diisi")

	values, errs = ValidateCustomValues(defs, map[string]any{"budget": ""}, true)
	eq(t, len(errs), 0)
	eq(t, values, map[string]any{"budget": nil})
	eq(t, ParseLocaleNumber("1.500,50"), 1500.5)
	eq(t, ParseLocaleNumber("1,5"), 1.5)
}

func TestFormat(t *testing.T) {
	eq(t, FormatRupiah(1_250_000.4), "Rp1.250.000")
	eq(t, FormatRupiah(-1500), "-Rp1.500")
	eq(t, FormatNumber(1234.5678, 3), "1.234,568")
	eq(t, FormatDateLong("2026-10-04", "-"), "Minggu, 4 Oktober 2026")
	eq(t, FormatDateLong("", "x"), "x")
}
