package kit

import (
	"math"
	"testing"
)

func TestNumberFromString(t *testing.T) {
	for in, want := range map[string]float64{
		"": 0, " 2 ": 2, "1.0": 1, "1e2": 100, ".5": 0.5, "-3": -3, "0x10": 16, "0b11": 3, "0o7": 7, "Infinity": math.Inf(1),
	} {
		if got := NumberFromString(in); got != want {
			t.Errorf("Number(%q) = %v, want %v", in, got, want)
		}
	}
	for _, in := range []string{"abc", "1,5", "1_000", "inf", "0x", "--1", "1e"} {
		if got := NumberFromString(in); !math.IsNaN(got) {
			t.Errorf("Number(%q) = %v, want NaN", in, got)
		}
	}
}

func TestIsEmail(t *testing.T) {
	for in, want := range map[string]bool{
		"budi@example.com": true, "a.b+c@sub.example.co": true, ".a@example.com": false,
		"a..b@example.com": false, "a.@example.com": false, "a@example": false, "a@-x.com": false, "budi": false,
	} {
		if got := IsEmail(in); got != want {
			t.Errorf("IsEmail(%q) = %v", in, got)
		}
	}
}

func TestMaskSecret(t *testing.T) {
	s := func(v string) *string { return &v }
	if MaskSecret(nil) != nil || MaskSecret(s("")) != nil {
		t.Fatal("empty secret must stay null")
	}
	if got := *MaskSecret(s("12345678")); got != "••••" {
		t.Fatalf("short = %s", got)
	}
	if got := *MaskSecret(s("sk-abcdefgh1234")); got != "sk-a••••••••1234" {
		t.Fatalf("long = %s", got)
	}
}
