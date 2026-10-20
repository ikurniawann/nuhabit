package localtime

import (
	"testing"
	"time"
)

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestZone(t *testing.T) {
	for name, abbrev := range map[string]string{"Asia/Jakarta": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT"} {
		if !Valid(name) || Abbrev(Zone(name)) != abbrev {
			t.Fatalf("%s: valid %v, abbrev %q", name, Valid(name), Abbrev(Zone(name)))
		}
	}
	if Zone("") != Jakarta || Zone("Mars/Olympus") != Jakarta || Zone("Mars/Olympus") != Jakarta {
		t.Fatal("empty or unknown name must fall back to Jakarta")
	}
	if Valid("Asia/Pontianak") || Valid("") {
		t.Fatal("only the branch zones are valid")
	}
	if Zone("UTC") != Zone("UTC") {
		t.Fatal("loaded zones are cached")
	}
}

func TestDayBoundaries(t *testing.T) {
	// 16.30 UTC on 24 Oct: 23.30 WIB on the 24th, 00.30 WITA and 01.30 WIT on the 25th.
	instant := at("2026-10-24T16:30:00Z")
	cases := []struct {
		zone, key, start string
	}{
		{"Asia/Jakarta", "2026-10-24", "2026-10-23T17:00:00Z"},
		{"Asia/Makassar", "2026-10-25", "2026-10-24T16:00:00Z"},
		{"Asia/Jayapura", "2026-10-25", "2026-10-24T15:00:00Z"},
	}
	for _, c := range cases {
		loc := Zone(c.zone)
		if got := DayKey(instant, loc); got != c.key {
			t.Errorf("%s: day key %s, want %s", c.zone, got, c.key)
		}
		start, end := DayBounds(instant, loc)
		if !start.Equal(at(c.start)) || end.Sub(start) != 24*time.Hour {
			t.Errorf("%s: bounds [%s, %s)", c.zone, start.UTC(), end.UTC())
		}
		parsed, err := ParseDay(c.key, loc)
		if err != nil || !parsed.Equal(start) {
			t.Errorf("%s: ParseDay = %s %v", c.zone, parsed, err)
		}
	}
	if DayKey(instant, nil) != "2026-10-24" {
		t.Fatal("nil location is Jakarta")
	}
}

func TestWeekStart(t *testing.T) {
	// Sunday 23.30 WIB is Monday 00.30 WITA: a new week in Makassar only.
	instant := at("2026-10-25T16:30:00Z")
	if got := DayKey(WeekStart(instant, Jakarta), Jakarta); got != "2026-10-19" {
		t.Fatalf("WIB week %s", got)
	}
	if got := DayKey(WeekStart(instant, Zone("Asia/Makassar")), Zone("Asia/Makassar")); got != "2026-10-26" {
		t.Fatalf("WITA week %s", got)
	}
}

func TestFormat(t *testing.T) {
	instant := at("2026-10-24T11:00:00Z") // Saturday
	end := instant.Add(time.Hour)
	cases := []struct {
		zone, short, span, date, long, dateTime string
	}{
		{"Asia/Jakarta", "Sab, 24 Okt, 18.00", "Sab, 24 Okt, 18.00–19.00", "24 Okt 2026", "Sabtu, 24 Okt 2026", "24 Okt 2026 pukul 18.00 WIB"},
		{"Asia/Makassar", "Sab, 24 Okt, 19.00 WITA", "Sab, 24 Okt, 19.00–20.00 WITA", "24 Okt 2026", "Sabtu, 24 Okt 2026", "24 Okt 2026 pukul 19.00 WITA"},
		{"Asia/Jayapura", "Sab, 24 Okt, 20.00 WIT", "Sab, 24 Okt, 20.00–21.00 WIT", "24 Okt 2026", "Sabtu, 24 Okt 2026", "24 Okt 2026 pukul 20.00 WIT"},
	}
	for _, c := range cases {
		loc := Zone(c.zone)
		if got := Format(instant, loc); got != c.short {
			t.Errorf("Format %s = %q", c.zone, got)
		}
		if got := FormatSpan(instant, end, loc); got != c.span {
			t.Errorf("FormatSpan %s = %q", c.zone, got)
		}
		if got := FormatDate(instant, loc); got != c.date {
			t.Errorf("FormatDate %s = %q", c.zone, got)
		}
		if got := FormatLongDate(instant, loc); got != c.long {
			t.Errorf("FormatLongDate %s = %q", c.zone, got)
		}
		if got := FormatDateTime(instant, loc); got != c.dateTime {
			t.Errorf("FormatDateTime %s = %q", c.zone, got)
		}
	}
	// Late evening WIB is already the next day further east.
	late := at("2026-10-24T16:30:00Z")
	if got := Format(late, Zone("Asia/Jayapura")); got != "Min, 25 Okt, 01.30 WIT" {
		t.Errorf("Format across midnight = %q", got)
	}
	if got := Format(late, nil); got != "Sab, 24 Okt, 23.30" {
		t.Errorf("nil location = %q", got)
	}
}
