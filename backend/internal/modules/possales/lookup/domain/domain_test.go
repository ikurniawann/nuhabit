package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestCheckQrToken(t *testing.T) {
	now := time.Date(2026, 10, 4, 7, 0, 0, 0, time.UTC)
	in := func(h float64) time.Time { return now.Add(time.Duration(h * float64(time.Hour))) }
	cases := []struct {
		name  string
		token *QrToken
		want  QrProblem
	}{
		{"valid", &QrToken{ExpiresAt: in(0.01)}, ""},
		{"unknown", nil, QrNotFound},
		{"consumed wins over a live expiry", &QrToken{ExpiresAt: in(1), ConsumedAt: &now}, QrConsumed},
		{"expired", &QrToken{ExpiresAt: in(-0.01)}, QrExpired},
		{"same millisecond is still valid", &QrToken{ExpiresAt: now.Add(100 * time.Microsecond)}, ""},
	}
	for _, c := range cases {
		if got := CheckQrToken(c.token, now.Add(400*time.Microsecond)); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
	for _, p := range []QrProblem{QrNotFound, QrExpired, QrConsumed} {
		if QrProblemLabel[p] == "" {
			t.Errorf("no label for %q", p)
		}
	}
}

// Expected strings come from Node's toLocaleString("id-ID", ...).
func TestFormatWib(t *testing.T) {
	cases := map[string]string{
		"2026-10-04T07:05:00Z": "Min, 4 Okt, 14.05",
		"2026-01-31T16:59:00Z": "Sab, 31 Jan, 23.59",
		"2026-10-01T17:05:00Z": "Jum, 2 Okt, 00.05",
		"2026-08-12T00:00:00Z": "Rab, 12 Agu, 07.00",
		"2026-05-03T23:00:00Z": "Sen, 4 Mei, 06.00",
		"2026-12-15T00:00:00Z": "Sel, 15 Des, 07.00",
	}
	for iso, want := range cases {
		at, _ := time.Parse(time.RFC3339, iso)
		if got := FormatWib(at); got != want {
			t.Errorf("%s: got %q, want %q", iso, got, want)
		}
	}
}

func TestVisitRecordedBody(t *testing.T) {
	at := time.Date(2026, 10, 4, 7, 5, 0, 0, time.UTC)
	ana, empty := "Ana", ""
	if got := VisitRecordedBody(&ana, at); got != "Terima kasih sudah mampir, Ana. Kunjungan Min, 4 Okt, 14.05 sudah tercatat." {
		t.Error(got)
	}
	for _, name := range []*string{nil, &empty} {
		if got := VisitRecordedBody(name, at); got != "Terima kasih sudah mampir. Kunjungan Min, 4 Okt, 14.05 sudah tercatat." {
			t.Error(got)
		}
	}
}

func TestParsePassCode(t *testing.T) {
	token := "ABCDEF0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789"
	cases := map[string]PassKey{
		token:          {ByAccessToken, "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"},
		"sp-2026-0001": {ByPassCode, "SP-2026-0001"},
		"SP-X":         {ByPassCode, "SP-X"},
		"04:a1:b2:c3":  {ByBandUID, "04A1B2C3"},
		token[:63]:     {ByBandUID, "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF012345678"},
		"xyz":          {ByBandUID, ""},
	}
	for raw, want := range cases {
		if got := ParsePassCode(raw); got != want {
			t.Errorf("%q: got %+v, want %+v", raw, got, want)
		}
	}
}

func TestTodayInJakarta(t *testing.T) {
	if got := TodayInJakarta(time.Date(2026, 10, 3, 17, 0, 0, 0, time.UTC)); got != "2026-10-04" {
		t.Error(got)
	}
	if got := TodayInJakarta(time.Date(2026, 10, 3, 16, 59, 59, 0, time.UTC)); got != "2026-10-03" {
		t.Error(got)
	}
}

func TestEvaluatePass(t *testing.T) {
	from, until := "2026-01-01", "2026-12-31"
	pass := func(status string, from, until *string) *SeasonPass {
		return &SeasonPass{PassCode: "SP-1", HolderName: "Ana", Status: status, ValidFrom: from, ValidUntil: until,
			MemberDiscountPercent: 12.5, ProductName: "Pass Tahunan"}
	}
	cases := []struct {
		name  string
		pass  *SeasonPass
		today string
		want  string
	}{
		{"missing", nil, "2026-10-04", `{"found":false,"reason":"Pass tidak ditemukan"}`},
		{"not active", pass("suspended", &from, &until), "2026-10-04", `{"found":false,"reason":"Pass suspended","pass_code":"SP-1"}`},
		{"before window", pass("active", &from, &until), "2025-12-31", `{"found":false,"reason":"Pass di luar masa berlaku","pass_code":"SP-1"}`},
		{"after window", pass("active", &from, &until), "2027-01-01", `{"found":false,"reason":"Pass di luar masa berlaku","pass_code":"SP-1"}`},
		{"last day", pass("active", &from, &until), "2026-12-31",
			`{"found":true,"pass_code":"SP-1","holder_name":"Ana","product_name":"Pass Tahunan","discount_percent":12.5,"valid_until":"2026-12-31"}`},
		{"open window", pass("active", nil, nil), "2030-01-01",
			`{"found":true,"pass_code":"SP-1","holder_name":"Ana","product_name":"Pass Tahunan","discount_percent":12.5,"valid_until":null}`},
	}
	for _, c := range cases {
		raw, _ := json.Marshal(EvaluatePass(c.pass, c.today))
		if string(raw) != c.want {
			t.Errorf("%s:\n got %s\nwant %s", c.name, raw, c.want)
		}
	}
}
