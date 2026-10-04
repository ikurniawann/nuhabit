package domain

import (
	"errors"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// Ported from lib/resort/rates.test.ts, reservation.test.ts and
// planning.test.ts.

func ptr[T any](v T) *T { return &v }

var cabinRate = RoomTypeRate{ID: "t1", RateWeekday: 1_500_000, RateWeekend: 2_000_000, ExtraBedRate: 250_000}

func TestNightsAndDates(t *testing.T) {
	if n := NightsBetween("2026-09-10", "2026-09-13"); n != 3 {
		t.Fatalf("nights %d", n)
	}
	if n := NightsBetween("2026-09-10", "2026-09-10"); n != 0 {
		t.Fatalf("nights %d", n)
	}
	if got := EachNight("2026-09-10", "2026-09-13"); !reflect.DeepEqual(got, []string{"2026-09-10", "2026-09-11", "2026-09-12"}) {
		t.Fatalf("each night %v", got)
	}
	// V8 rolls 2026-02-30 over to 2026-03-02.
	if got := EachNight("2026-02-28", "2026-02-30"); !reflect.DeepEqual(got, []string{"2026-02-28", "2026-03-01"}) {
		t.Fatalf("rollover %v", got)
	}
	if NightsBetween("x", "2026-09-10") != 0 {
		t.Fatal("unparsable date must give 0 nights")
	}
}

func TestWeekendAndSeasons(t *testing.T) {
	for date, want := range map[string]bool{"2026-09-11": true, "2026-09-12": true, "2026-09-13": false} {
		if IsWeekendNight(date) != want {
			t.Fatalf("weekend %s", date)
		}
	}
	if r := NightlyRate(cabinRate, "2026-09-10", nil).Rate; r != 1_500_000 {
		t.Fatalf("weekday %v", r)
	}
	if r := NightlyRate(cabinRate, "2026-09-11", nil).Rate; r != 2_000_000 {
		t.Fatalf("weekend %v", r)
	}
	fixed := []RateSeason{{Label: "Nataru", StartDate: "2026-12-24", EndDate: "2027-01-04", Rate: ptr(3_000_000.0)}}
	if n := NightlyRate(cabinRate, "2026-12-25", fixed); n.Rate != 3_000_000 || *n.Season != "Nataru" {
		t.Fatalf("fixed season %+v", n)
	}
	pct := []RateSeason{{Label: "Long Weekend", StartDate: "2026-09-10", EndDate: "2026-09-10", SurchargePercent: ptr(20.0)}}
	if r := NightlyRate(cabinRate, "2026-09-10", pct).Rate; r != 1_800_000 {
		t.Fatalf("surcharge %v", r)
	}
	both := []RateSeason{
		{Label: "Umum", StartDate: "2026-09-10", EndDate: "2026-09-10", Rate: ptr(1_000_000.0)},
		{RoomTypeID: ptr("t1"), Label: "Khusus Cabin", StartDate: "2026-09-10", EndDate: "2026-09-10", Rate: ptr(2_500_000.0)},
	}
	if n := NightlyRate(cabinRate, "2026-09-10", both); n.Rate != 2_500_000 || *n.Season != "Khusus Cabin" {
		t.Fatalf("type season must win %+v", n)
	}
}

func TestQuoteStay(t *testing.T) {
	q := QuoteStay(cabinRate, "2026-09-10", "2026-09-13", 1, nil)
	if q.Nights != 3 || q.RoomSubtotal != 5_500_000 || q.ExtraBedTotal != 750_000 || q.Subtotal != 6_250_000 {
		t.Fatalf("quote %+v", q)
	}
	var weekends []bool
	for _, b := range q.Breakdown {
		weekends = append(weekends, b.Weekend)
	}
	if !reflect.DeepEqual(weekends, []bool{false, true, true}) {
		t.Fatalf("weekends %v", weekends)
	}
}

func TestReservationRules(t *testing.T) {
	code := GenerateReservationCode()
	if !regexp.MustCompile(`^RSV-[A-Z0-9]{6}$`).MatchString(code) || strings.ContainsAny(code[4:], "IO01") {
		t.Fatalf("code %q", code)
	}
	cases := []struct {
		from, to string
		ok       bool
	}{
		{"menunggu-bayar", "terkonfirmasi", true}, {"terkonfirmasi", "check-in", true}, {"check-in", "check-out", true},
		{"menunggu-bayar", "check-in", false}, {"check-out", "check-in", false}, {"dibatalkan", "terkonfirmasi", false},
	}
	for _, c := range cases {
		if CanTransition(c.from, c.to) != c.ok {
			t.Fatalf("transition %s -> %s", c.from, c.to)
		}
	}
	if !reflect.DeepEqual(BlockingStatuses, []string{"menunggu-bayar", "terkonfirmasi", "check-in"}) {
		t.Fatalf("blocking %v", BlockingStatuses)
	}
	for typ, want := range map[string]string{"kamar": "debit", "fnb": "debit", "pembayaran": "kredit", "diskon": "kredit", "refund": "kredit"} {
		if ChargeDirection(typ) != want {
			t.Fatalf("direction %s", typ)
		}
	}
	lines := []FolioLine{{"debit", 5_500_000}, {"debit", 350_000}, {"kredit", 3_000_000}}
	if Balance(lines) != 2_850_000 || Balance(nil) != 0 {
		t.Fatal("balance")
	}
	if got := Totals(lines); got != (FolioTotals{Charges: 5_850_000, Payments: 3_000_000, Balance: 2_850_000}) {
		t.Fatalf("totals %+v", got)
	}
	if ValidateStayDates("2026-09-10", "2026-09-12") != "" ||
		!strings.Contains(ValidateStayDates("2026-09-12", "2026-09-12"), "setelah check-in") ||
		!strings.Contains(ValidateStayDates("10-09-2026", "2026-09-12"), "Format") {
		t.Fatal("stay dates")
	}
	if got := FormatRupiah(1_000_000); got != "Rp1.000.000" {
		t.Fatalf("rupiah %q", got)
	}
	if got := FormatRupiah(-1500.5); got != "-Rp1.500" {
		t.Fatalf("negative rupiah %q", got)
	}
	if got := ReservationSummary("RSV-ABC123", "Budi", 2, 1, 4_700_000); got != "RSV-ABC123 — Budi, 1 kamar × 2 malam, total Rp4.700.000" {
		t.Fatalf("summary %q", got)
	}
}

var cabin = RoomType{ID: "t1", Code: "CAB", Name: "Cabin", CapacityAdults: 2, ExtraBedCapacity: 1,
	RateWeekday: 1_000_000, RateWeekend: 1_500_000, ExtraBedRate: 200_000, Amenities: []string{}, IsActive: true, RoomCount: 2}

func unit(id string) UnitRoom {
	return UnitRoom{ID: id, Code: strings.ToUpper(id), Name: "Kamar " + id, RoomTypeID: "t1", Status: "siap"}
}

func booking(roomID *string) Booked {
	return Booked{RoomTypeID: "t1", RoomID: roomID, CheckIn: "2026-10-05", CheckOut: "2026-10-07"}
}

func TestSummarizeAvailability(t *testing.T) {
	// 2026-10-05 Monday, 06 Tuesday, 07 Wednesday.
	got := SummarizeAvailability([]RoomType{cabin}, []UnitRoom{unit("a"), unit("b")}, []Booked{booking(ptr("a"))}, nil, "2026-10-06", "2026-10-08")[0]
	want := []NightUse{{"2026-10-06", 2, 1, 1}, {"2026-10-07", 2, 0, 2}}
	if !reflect.DeepEqual(got.PerNight, want) || got.Available != 1 || got.Quote.Nights != 2 {
		t.Fatalf("availability %+v", got)
	}
	if len(got.FreeRooms) != 1 || got.FreeRooms[0].ID != "b" {
		t.Fatalf("free rooms %+v", got.FreeRooms)
	}
	empty := SummarizeAvailability([]RoomType{cabin}, []UnitRoom{unit("a")}, nil, nil, "2026-10-06", "2026-10-06")[0]
	if empty.Available != 1 {
		t.Fatalf("no nights: available %d", empty.Available)
	}
}

func refusalStatus(err error) int {
	var r *Refusal
	if errors.As(err, &r) {
		return r.Status
	}
	return 0
}

func TestPlanReservation(t *testing.T) {
	units := map[string]int{"t1": 2}
	plan, err := PlanReservation([]RoomRequest{{RoomTypeID: "t1", Qty: 2, ExtraBed: 1, RoomID: ptr("a")}},
		"2026-10-05", "2026-10-07", 100_000, []RoomType{cabin}, nil, units, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Lines) != 2 || *plan.Lines[0].RoomID != "a" || plan.Lines[1].RoomID != nil {
		t.Fatalf("lines %+v", plan.Lines)
	}
	if plan.Nights != 2 || plan.RoomTotal != 4_000_000 || plan.ExtraTotal != 800_000 || plan.Total != 4_700_000 {
		t.Fatalf("plan %+v", plan)
	}
	_, err = PlanReservation([]RoomRequest{{RoomTypeID: "t1", Qty: 2}}, "2026-10-05", "2026-10-07", 0, []RoomType{cabin}, []Booked{booking(nil)}, units, nil)
	if refusalStatus(err) != 409 || err.Error() != "Cabin: sisa 1 kamar untuk tanggal tersebut, diminta 2" {
		t.Fatalf("stock: %v", err)
	}
	_, err = PlanReservation([]RoomRequest{{RoomTypeID: "t1", Qty: 1, ExtraBed: 3}}, "2026-10-05", "2026-10-07", 0, []RoomType{cabin}, nil, units, nil)
	if refusalStatus(err) != 400 {
		t.Fatalf("extra bed: %v", err)
	}
	_, err = PlanReservation([]RoomRequest{{RoomTypeID: "x", Qty: 1}}, "2026-10-05", "2026-10-07", 0, []RoomType{cabin}, nil, units, nil)
	if refusalStatus(err) != 404 {
		t.Fatalf("unknown type: %v", err)
	}
}

func TestOccupancySummary(t *testing.T) {
	if got := OccupancySummary(3, 1, 1, 0); got != (Occupancy{3, 1, 2, 33.3, 1, 0}) {
		t.Fatalf("occupancy %+v", got)
	}
	if OccupancySummary(0, 0, 0, 0).OccupancyPct != 0 {
		t.Fatal("no rooms")
	}
}
