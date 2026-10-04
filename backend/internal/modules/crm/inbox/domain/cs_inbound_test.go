package domain

import (
	"testing"
	"time"
)

// Expectations of lib/crm/cs-rules.test.ts.
func TestIsWithinBusinessHours(t *testing.T) {
	at := func(hour string) time.Time {
		v, err := time.Parse(time.RFC3339, "2026-07-20T"+hour+":00:00+07:00")
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	cases := []struct {
		hour       string
		start, end float64
		want       bool
	}{
		{"10", 10, 22, true}, {"15", 10, 22, true}, {"21", 10, 22, true}, {"22", 10, 22, false},
		{"09", 10, 22, false}, {"02", 10, 22, false},
		{"21", 20, 2, true}, {"01", 20, 2, true}, {"03", 20, 2, false}, {"12", 20, 2, false},
		{"03", 0, 0, true},
	}
	for _, c := range cases {
		if got := IsWithinBusinessHours(at(c.hour), c.start, c.end); got != c.want {
			t.Errorf("%s WIB in %v-%v = %v, want %v", c.hour, c.start, c.end, got, c.want)
		}
	}
	if got := WibDateKey(at("02")); got != "2026-07-20" {
		t.Errorf("WibDateKey = %s", got)
	}
}

func TestParseCsatReply(t *testing.T) {
	s := func(v string) *string { return &v }
	cases := []struct {
		in   *string
		want int
	}{
		{s("5"), 5}, {s(" 4 "), 4}, {s("3."), 3}, {s("nilai 5"), 5},
		{s("0"), 0}, {s("6"), 0}, {s("10"), 0},
		{s("pesanan saya nomor 3 belum datang"), 0}, {s("saya sudah bayar 2 kali tapi belum masuk"), 0},
		{nil, 0}, {s(""), 0}, {s("terima kasih"), 0},
	}
	for _, c := range cases {
		if got := ParseCsatReply(c.in); got != c.want {
			t.Errorf("ParseCsatReply(%v) = %d, want %d", c.in, got, c.want)
		}
	}
}
