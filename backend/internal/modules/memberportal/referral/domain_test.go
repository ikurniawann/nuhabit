package referral

import (
	"testing"
	"time"
)

func TestScreen(t *testing.T) {
	referrer := Party{CustomerID: "a", PhoneDigits: "62811", Email: "a@x.id"}
	cases := []struct {
		referee Party
		device  bool
		want    string
	}{
		{Party{CustomerID: "b", PhoneDigits: "62822"}, false, ""},
		{Party{CustomerID: "a"}, false, ReasonSelf},
		{Party{CustomerID: "b", PhoneDigits: "62811"}, false, ReasonSameContact},
		{Party{CustomerID: "b", Email: "A@X.ID"}, false, ReasonSameContact},
		{Party{CustomerID: "b"}, true, ReasonSameDevice},
	}
	for _, c := range cases {
		if got := Screen(referrer, c.referee, c.device); got != c.want {
			t.Errorf("Screen(%+v, %v) = %q, want %q", c.referee, c.device, got, c.want)
		}
	}
	// Empty contacts never match each other.
	if got := Screen(Party{CustomerID: "a"}, Party{CustomerID: "b"}, false); got != "" {
		t.Errorf("empty contacts: %q", got)
	}
}

func TestCodes(t *testing.T) {
	code, err := NewCode()
	if err != nil || len(code) != 8 || code[:2] != "NH" || NormalizeCode(code) != code {
		t.Fatalf("NewCode = %q, %v", code, err)
	}
	for raw, want := range map[string]string{" nh ab 12cd ": "NHAB12CD", "abc": "", "NH-123": "", "": ""} {
		if got := NormalizeCode(raw); got != want {
			t.Errorf("NormalizeCode(%q) = %q, want %q", raw, got, want)
		}
	}
	if HashDevice(" ") != "" || HashDevice("a") == HashDevice("b") || len(HashDevice("a")) != 64 {
		t.Error("HashDevice")
	}
}

func TestMonthAndCap(t *testing.T) {
	// 31 Oct 20:00 UTC is already 1 Nov in WIB.
	start, end := MonthBounds(time.Date(2026, 10, 31, 20, 0, 0, 0, time.UTC))
	if start.Format(time.RFC3339) != "2026-11-01T00:00:00+07:00" || end.Format(time.RFC3339) != "2026-12-01T00:00:00+07:00" {
		t.Fatalf("bounds %v %v", start, end)
	}
	if s, _, ok := ParseMonth("2026-02"); !ok || s.Format("2006-01-02") != "2026-02-01" {
		t.Fatal("ParseMonth")
	}
	if _, _, ok := ParseMonth("2026-13"); ok {
		t.Fatal("ParseMonth accepted month 13")
	}
	if CapReached(5, 0) || CapReached(1, 2) || !CapReached(2, 2) {
		t.Fatal("CapReached")
	}
}

func TestShortName(t *testing.T) {
	for in, want := range map[string]string{"Budi Santoso Putra": "Budi S.", "Budi": "Budi", "  ": "Member", "Ani Ölz": "Ani Ö."} {
		if got := ShortName(in); got != want {
			t.Errorf("ShortName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSettingsProblem(t *testing.T) {
	ok := Settings{Active: true, ReferrerCredits: 2, CreditValidityDays: 30, HoldDays: 7, MonthlyCap: 10}
	if msg := ok.Problem(); msg != "" {
		t.Fatalf("valid settings: %s", msg)
	}
	bad := []Settings{
		{Active: true, CreditValidityDays: 30},
		{ReferrerCredits: 101, CreditValidityDays: 30},
		{ReferrerArkIdr: -1, CreditValidityDays: 30},
		{CreditValidityDays: 0},
		{CreditValidityDays: 30, HoldDays: 91},
		{CreditValidityDays: 30, MonthlyCap: -1},
	}
	for _, s := range bad {
		if s.Problem() == "" {
			t.Errorf("accepted %+v", s)
		}
	}
}
