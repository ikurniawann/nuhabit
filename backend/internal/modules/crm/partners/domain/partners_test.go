package domain

import (
	"strings"
	"testing"
)

func p(s string) *string { return &s }

func TestMatchSubject(t *testing.T) {
	candidates := []MatchCandidate{
		{"sari", p("Sari@Mail.com"), p("081234567890")},
		{"budi", nil, p("+62 811-1111-2222")},
	}
	for subject, want := range map[string]string{
		"sari@mail.COM":  "sari",
		"+6281234567890": "sari",
		"0811 1111 2222": "budi",
		"Sari":           "",
		"lain@mail.com":  "",
		"4567890":        "",
		"  ":             "",
	} {
		if got := MatchSubject(subject, candidates); got != want {
			t.Errorf("MatchSubject(%q) = %q, want %q", subject, got, want)
		}
	}
	twins := append(candidates, MatchCandidate{"kembar", nil, p("0899 3456 7890")})
	if got := MatchSubject("081234567890", twins); got != "" {
		t.Fatalf("a phone matching two members stays unmatched, got %q", got)
	}
}

func TestPhoneTail(t *testing.T) {
	if got := PhoneTail("+62 812-3456-7890"); got == nil || *got != "34567890" {
		t.Fatalf("tail %v", got)
	}
	if PhoneTail("a@b.co") != nil || PhoneTail("1234567") != nil {
		t.Fatal("emails and short numbers have no tail")
	}
}

func TestDecideEvent(t *testing.T) {
	partner := Partner{IsActive: true, AwardsXP: true, XPPerEvent: 50}
	cases := []struct {
		p       Partner
		matched bool
		want    Decision
	}{
		{partner, false, Decision{"unmatched", 0}},
		{Partner{IsActive: false, AwardsXP: true, XPPerEvent: 50}, true, Decision{"ignored", 0}},
		{Partner{IsActive: true, AwardsXP: false, XPPerEvent: 50}, true, Decision{"processed", 0}},
		{partner, true, Decision{"processed", 50}},
		{Partner{IsActive: true, AwardsXP: true, XPPerEvent: 1_000_000}, true, Decision{"processed", PartnerXPCap}},
	}
	for _, c := range cases {
		if got := DecideEvent(c.p, c.matched); got != c.want {
			t.Errorf("DecideEvent(%+v, %v) = %+v, want %+v", c.p, c.matched, got, c.want)
		}
	}
}

func TestLedgerChannel(t *testing.T) {
	if LedgerChannel("photobooth") != "photobooth" || LedgerChannel("studio_game") != "studio_game" || LedgerChannel("other") != "manual" {
		t.Fatal("ledger channel")
	}
	if EventChannel("photobooth") != "photobooth" || EventChannel("studio_game") != "studio_game" || EventChannel("kiosk") != "other" {
		t.Fatal("event channel")
	}
}

func TestSecrets(t *testing.T) {
	a, err := GenerateSecret()
	b, _ := GenerateSecret()
	if err != nil || len(a) != 64 || a == b || strings.Trim(a, "0123456789abcdef") != "" {
		t.Fatalf("secret %q %v", a, err)
	}
	if HashSecret("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatal("sha256 hex")
	}
}
