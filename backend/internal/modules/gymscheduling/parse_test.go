package gymscheduling

import (
	"net/url"
	"testing"
	"time"
)

func TestWibMidnightRollsOverLikeJSDate(t *testing.T) {
	for in, want := range map[string]string{
		"2026-10-05": "2026-10-04T17:00:00Z",
		"2026-02-30": "2026-03-01T17:00:00Z", // new Date("2026-02-30T00:00:00+07:00") is 2 March WIB
	} {
		got, ok := wibMidnight(in)
		if !ok || got.UTC().Format(time.RFC3339) != want {
			t.Errorf("wibMidnight(%s) = %s %v, want %s", in, got.UTC().Format(time.RFC3339), ok, want)
		}
	}
	for _, bad := range []string{"2026-13-01", "2026-00-10", "2026-01-32", "2026/01/01"} {
		if _, ok := wibMidnight(bad); ok {
			t.Errorf("wibMidnight(%s) should be invalid", bad)
		}
	}
}

func TestRangeParams(t *testing.T) {
	now := time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)
	from, to := rangeParams(url.Values{}, now, 7)
	if !from.Equal(now) || !to.Equal(now.Add(7*24*time.Hour)) {
		t.Errorf("defaults: %s %s", from, to)
	}
	from, to = rangeParams(url.Values{"from": {"2026-10-05"}, "to": {"2026-10-06T10:00:00.5+07:00"}}, now, 7)
	if from.UTC().Format(time.RFC3339) != "2026-10-04T17:00:00Z" || to.UTC().Format(time.RFC3339Nano) != "2026-10-06T03:00:00.5Z" {
		t.Errorf("explicit: %s %s", from, to)
	}
	from, _ = rangeParams(url.Values{"from": {"kemarin"}}, now, 7)
	if !from.Equal(now) {
		t.Errorf("unparseable from falls back to now: %s", from)
	}
}
