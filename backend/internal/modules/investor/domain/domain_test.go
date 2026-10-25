package domain

import (
	"math"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestStream(t *testing.T) {
	cases := []struct {
		kind     string
		personal bool
		want     string
	}{
		{"credits", false, StreamPackages},
		{"pass", false, StreamPasses},
		{"pass", true, StreamPT},
		{"credits", true, StreamPT},
	}
	for _, c := range cases {
		if got := Stream(c.kind, c.personal); got != c.want {
			t.Errorf("Stream(%q, %v) = %q, want %q", c.kind, c.personal, got, c.want)
		}
	}
}

func TestRollUpDailyAndSum(t *testing.T) {
	days := []string{"2031-03-01", "2031-03-02", "2031-03-03"}
	d := RollUpDaily(days, []SaleRow{
		{Day: "2031-03-01", Stream: StreamPackages, BranchID: "b1", Amount: 1_000_000},
		{Day: "2031-03-01", Stream: StreamPOS, BranchID: "b1", Amount: 50_000},
		{Day: "2031-03-02", Stream: StreamPasses, BranchID: "b2", Amount: 500_000},
		{Day: "2031-03-02", Stream: StreamPackages, BranchID: "b1", Amount: -200_000},
		{Day: "2031-02-28", Stream: StreamPackages, BranchID: "b1", Amount: 9_999_999},
	})
	if len(d.Days) != 3 || !near(d.Days[0].Total, 1_050_000) || !near(d.Days[1].Total, 300_000) || !near(d.Days[2].Total, 0) {
		t.Fatalf("days = %+v", d.Days)
	}
	if !near(d.Days[0].Branch["b1"], 1_050_000) || !near(d.Days[1].Branch["b2"], 500_000) || !near(d.Days[1].Branch["b1"], -200_000) {
		t.Fatalf("branches = %+v", d.Days)
	}
	if d.Days[2].Stream[StreamPT] != 0 {
		t.Fatalf("every stream is present at zero: %+v", d.Days[2].Stream)
	}
	total, streams := d.Sum("2031-03-01", "2031-03-02")
	if !near(total, 1_350_000) || !near(streams[StreamPackages], 800_000) || !near(streams[StreamPasses], 500_000) || !near(streams[StreamPOS], 50_000) {
		t.Fatalf("sum = %v %v", total, streams)
	}
	if r := d.Range("2031-03-02", "2031-03-09"); len(r) != 2 || r[0].Day != "2031-03-02" {
		t.Fatalf("range = %+v", r)
	}
}

func TestCompare(t *testing.T) {
	c := Compare(120, 100)
	if c.Change == nil || !near(*c.Change, 0.2) {
		t.Fatalf("change = %v", c.Change)
	}
	if c := Compare(5, 0); c.Change != nil {
		t.Fatalf("no previous: change = %v", *c.Change)
	}
}

func TestWindowsAt(t *testing.T) {
	zone := localtime.Jakarta
	at := func(s string) time.Time {
		v, err := time.ParseInLocation("2006-01-02 15:04", s, zone)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	w := WindowsAt(at("2031-03-20 12:00"), zone)
	want := Windows{Today: "2031-03-20", Yesterday: "2031-03-19", MonthFrom: "2031-03-01", PrevMonthFrom: "2031-02-01", PrevTo: "2031-02-20",
		YearFrom: "2031-01-01", PrevYearFrom: "2030-01-01", PrevYTo: "2030-03-20"}
	if w != want {
		t.Fatalf("windows = %+v, want %+v", w, want)
	}
	// 31 March compares with all of February, never with 3 March.
	if w := WindowsAt(at("2031-03-31 09:00"), zone); w.PrevTo != "2031-02-28" {
		t.Fatalf("capped previous month = %s", w.PrevTo)
	}
	// 31 December of a leap year compares with the whole previous year.
	if w := WindowsAt(at("2032-12-31 09:00"), zone); w.PrevYTo != "2031-12-31" {
		t.Fatalf("capped previous year = %s", w.PrevYTo)
	}
	// Just after midnight WIB is still yesterday in UTC.
	if w := WindowsAt(time.Date(2031, 3, 19, 17, 30, 0, 0, time.UTC), zone); w.Today != "2031-03-20" {
		t.Fatalf("today in WIB = %s", w.Today)
	}
}

func TestMonthSpanAndDayKeys(t *testing.T) {
	now := time.Date(2031, 3, 20, 5, 0, 0, 0, time.UTC)
	from, to := MonthSpan(now, 3, localtime.Jakarta)
	if from.Format(time.DateOnly) != "2031-01-01" || to.Format(time.DateOnly) != "2031-03-31" {
		t.Fatalf("span = %s .. %s", from, to)
	}
	keys := DayKeys(from, to, localtime.Jakarta)
	if len(keys) != 90 || keys[0] != "2031-01-01" || keys[89] != "2031-03-31" {
		t.Fatalf("keys = %d %s .. %s", len(keys), keys[0], keys[len(keys)-1])
	}
}
