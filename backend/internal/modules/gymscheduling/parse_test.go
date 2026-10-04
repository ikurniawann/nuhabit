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

func TestZodLikeChecks(t *testing.T) {
	for s, want := range map[string]bool{
		"2026-10-05T18:00:00+07:00": true, "2026-10-05T18:00+07:00": true, "2026-10-05T11:00:00.123456789Z": true,
		"2026-10-05T18:00:00+0700": false, "2026-10-05 18:00:00Z": false, "2026-02-29T00:00:00Z": false,
	} {
		if got := datetimePattern.MatchString(s); got != want {
			t.Errorf("datetime %q = %v", s, got)
		}
	}
	for s, want := range map[string]bool{
		"6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11": true, "00000000-0000-0000-0000-000000000000": true,
		"6f1c2a1e-0d7b-9c55-9a43-1b0b6a0f5e11": false, "6f1c2a1e-0d7b-4c55-1a43-1b0b6a0f5e11": false,
	} {
		if isUUID(s) != want {
			t.Errorf("uuid %q", s)
		}
	}
	for s, want := range map[string]bool{"https://cdn.test/a.png": true, "mailto:a@b": true, "abc": false, "http://": false} {
		if validURL(s) != want {
			t.Errorf("url %q", s)
		}
	}
}
