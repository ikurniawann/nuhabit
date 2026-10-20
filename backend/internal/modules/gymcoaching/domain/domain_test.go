package domain

import (
	"reflect"
	"testing"
	"time"
)

func eq(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func wib(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, WIB)
	if err != nil {
		panic(err)
	}
	return t
}

var rules = Rules{CancellationDeadlineHours: 4, LateCancelPolicy: Forfeit, NoShowPolicy: Forfeit, ReminderMinutes: 60}

func TestCanTransition(t *testing.T) {
	eq(t, CanTransition(Requested, Confirmed), true)
	eq(t, CanTransition(Requested, Cancelled), true)
	eq(t, CanTransition(Requested, Completed), false)
	eq(t, CanTransition(Confirmed, Completed), true)
	eq(t, CanTransition(Confirmed, NoShow), true)
	eq(t, CanTransition(Completed, Cancelled), false)
	eq(t, CanTransition(Cancelled, Confirmed), false)
	eq(t, Requested.Open() && Confirmed.Open() && !Completed.Open() && !NoShow.Open(), true)
}

func TestRequestProblem(t *testing.T) {
	now := wib("2031-03-02 08:00")
	eq(t, RequestProblem(wib("2031-03-02 11:59"), now, rules), "Sesi PT harus diminta paling lambat 4 jam sebelum mulai")
	eq(t, RequestProblem(wib("2031-03-02 12:00"), now, rules), "")
	eq(t, RequestProblem(wib("2031-03-30 08:00"), now, rules), "")
	eq(t, RequestProblem(wib("2031-03-30 08:30"), now, rules), "Sesi PT hanya bisa diminta sampai 28 hari ke depan")
	// A zero deadline still needs an hour of notice.
	eq(t, EarliestRequest(now, Rules{}), wib("2031-03-02 09:00"))
}

func TestCredits(t *testing.T) {
	eq(t, HasCredits(3, 2, 1), true)
	eq(t, HasCredits(3, 3, 1), false)
}

func TestEvaluateCancel(t *testing.T) {
	start := wib("2031-03-02 18:00")
	eq(t, EvaluateCancel(Confirmed, start, 2, rules, wib("2031-03-02 14:00")), CancelOutcome{})
	eq(t, EvaluateCancel(Confirmed, start, 2, rules, wib("2031-03-02 14:01")), CancelOutcome{Late: true, Penalty: 2})
	eq(t, EvaluateCancel(Requested, start, 2, rules, wib("2031-03-02 17:00")), CancelOutcome{})
	free := rules
	free.LateCancelPolicy = Free
	eq(t, EvaluateCancel(Confirmed, start, 2, free, wib("2031-03-02 17:00")), CancelOutcome{Late: true})
}

func TestNoShowAndStart(t *testing.T) {
	eq(t, NoShowPenalty(2, rules), 2)
	eq(t, NoShowPenalty(2, Rules{NoShowPolicy: Free}), 0)
	start := wib("2031-03-02 18:00")
	eq(t, Started(start, start.Add(-time.Second)), false)
	eq(t, Started(start, start), true)
}

func TestReminder(t *testing.T) {
	start := wib("2031-03-02 18:00")
	eq(t, ReminderDue(start, wib("2031-03-02 16:59"), 60), false)
	eq(t, ReminderDue(start, wib("2031-03-02 17:00"), 60), true)
	eq(t, ReminderDue(start, start, 60), false)
	eq(t, ReminderDue(start, wib("2031-03-02 17:30"), 0), false)
	eq(t, ReminderPeriod(start), "2031-03-02T11:00:00Z")
	eq(t, FormatWib(start), "Min, 2 Mar, 18.00")
}

func TestParseClock(t *testing.T) {
	for in, want := range map[string]Minutes{"06:30": 390, "18:00:00": 1080, "24:00": EndOfDay, "24:00:00": EndOfDay} {
		got, ok := ParseClock(in)
		if !ok || got != want {
			t.Fatalf("%s: %d %v", in, got, ok)
		}
	}
	for _, bad := range []string{"6:30", "25:00", "24:30", "12", "ab:cd"} {
		if _, ok := ParseClock(bad); ok {
			t.Fatalf("%s parsed", bad)
		}
	}
	eq(t, Minutes(390).Clock(), "06:30")
	eq(t, EndOfDay.Clock(), "24:00")
}

func TestSpanProblem(t *testing.T) {
	eq(t, SpanProblem(Span{360, 600}), "")
	eq(t, SpanProblem(Span{600, 600}), "Jam selesai harus setelah jam mulai")
	eq(t, SpanProblem(Span{600, EndOfDay + 1}), "Jam selesai harus setelah jam mulai")
}

func TestDayWindows(t *testing.T) {
	// 2031-03-03 is a Monday.
	weekly := []WeeklyWindow{
		{1, Span{6 * 60, 10 * 60}}, {1, Span{9 * 60, 12 * 60}}, {1, Span{16 * 60, 20 * 60}}, {2, Span{6 * 60, 8 * 60}},
	}
	iv := func(a, b string) Interval { return Interval{wib("2031-03-03 " + a), wib("2031-03-03 " + b)} }

	t.Run("weekly windows of the weekday, merged", func(t *testing.T) {
		eq(t, DayWindows("2031-03-03", weekly, nil), []Interval{iv("06:00", "12:00"), iv("16:00", "20:00")})
	})
	t.Run("off with a span cuts a hole, extra adds time", func(t *testing.T) {
		ex := []Exception{
			{Date: "2031-03-03", Kind: Off, Span: &Span{8 * 60, 9 * 60}},
			{Date: "2031-03-03", Kind: Extra, Span: &Span{20 * 60, 21 * 60}},
			{Date: "2031-03-04", Kind: Off},
		}
		eq(t, DayWindows("2031-03-03", weekly, ex), []Interval{iv("06:00", "08:00"), iv("09:00", "12:00"), iv("16:00", "21:00")})
		eq(t, DayWindows("2031-03-04", weekly, ex), []Interval{})
	})
	t.Run("a whole day off keeps extra time", func(t *testing.T) {
		ex := []Exception{{Date: "2031-03-03", Kind: Off}, {Date: "2031-03-03", Kind: Extra, Span: &Span{7 * 60, 8 * 60}}}
		eq(t, DayWindows("2031-03-03", weekly, ex), []Interval{iv("07:00", "08:00")})
	})
	t.Run("bad date", func(t *testing.T) {
		eq(t, DayWindows("03-03-2031", weekly, nil) == nil, true)
	})
}

func TestFreeSlots(t *testing.T) {
	day := func(s string) time.Time { return wib("2031-03-03 " + s) }
	windows := []Interval{{day("06:00"), day("09:00")}}
	busy := []Interval{{day("07:00"), day("07:45")}}
	got := FreeSlots(windows, busy, time.Hour, SlotStep, day("06:15"))
	eq(t, got, []time.Time{day("08:00")})
	eq(t, Fits(windows, day("08:00"), day("09:00")), true)
	eq(t, Fits(windows, day("08:30"), day("09:30")), false)
}

func TestAssessmentProblem(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	n := func(v int) *int { return &v }
	ok := Assessment{AssessedOn: "2031-03-02", WeightKg: f(72.5), BodyFatPct: f(18), MuscleMassKg: f(33), Run1kmSec: n(240)}
	eq(t, ok.Problem("2031-03-02"), "")

	cases := map[string]Assessment{
		"Tanggal asesmen tidak valid":                   {AssessedOn: "02-03-2031", WeightKg: f(70)},
		"Tanggal asesmen tidak boleh di masa depan":     {AssessedOn: "2031-03-03", WeightKg: f(70)},
		"Isi minimal satu metrik":                       {AssessedOn: "2031-03-01"},
		"Berat badan di luar rentang wajar":             {AssessedOn: "2031-03-01", WeightKg: f(10)},
		"Lari 1 km di luar rentang wajar":               {AssessedOn: "2031-03-01", Run1kmSec: n(60)},
		"Wall ball di luar rentang wajar":               {AssessedOn: "2031-03-01", WallBallsMaxReps: n(-1)},
		"Massa otot harus lebih kecil dari berat badan": {AssessedOn: "2031-03-01", WeightKg: f(60), MuscleMassKg: f(60)},
	}
	for want, a := range cases {
		eq(t, a.Problem("2031-03-02"), want)
	}
	zero := Assessment{AssessedOn: "2031-03-01", WallBallsMaxReps: n(0)}
	eq(t, zero.Problem("2031-03-02"), "")
}
