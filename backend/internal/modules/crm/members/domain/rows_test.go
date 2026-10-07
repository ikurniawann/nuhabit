package domain

import (
	"math"
	"testing"
)

func ptr[T any](v T) *T { return &v }

// Carries member-rows.test.ts.
func TestNormalizeCustomer(t *testing.T) {
	c := Customer{ID: "c0ffee00-0000-4000-8000-000000000001", ArkCoinBalance: ptr(15000.0), TotalXP: ptr(120.0), VisitCount: ptr(3.0)}
	got := NormalizeCustomer(c)
	want := NormalizedCustomer{ID: c.ID, MembershipTier: "regular", ArkCoinBalance: 15000, TotalXP: 120, VisitCount: 3, IsActive: true}
	if got != want {
		t.Fatalf("got %+v want %+v", got, want)
	}
	base := NewSyntheticBase(got)
	if base.ID != "pos-"+c.ID || base.MemberCode != "c0ffee00" || base.Tier != (SyntheticTier{"regular", "regular"}) || base.LifetimeXP != 120 {
		t.Fatalf("synthetic %+v", base)
	}
	c.Phone = ptr("0812")
	if NewSyntheticBase(NormalizeCustomer(c)).MemberCode != "0812" {
		t.Fatal("member code from phone")
	}
	c.IsActive = ptr(false)
	if ActiveStatus(NormalizeCustomer(c)) != "inactive" {
		t.Fatal("inactive status")
	}
}

func TestNormalizePhoneDigits(t *testing.T) {
	cases := map[string]string{
		"0812-3456-789":      "628123456789",
		"+62 812 3456 789":   "628123456789",
		"":                   "",
		"0812":               "",
		"628123456789012345": "",
	}
	for in, want := range cases {
		if got := NormalizePhoneDigits(in); got != want {
			t.Errorf("NormalizePhoneDigits(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestIDHelpers(t *testing.T) {
	if !IsUUIDv1to5("550e8400-e29b-41d4-a716-446655440000") || IsUUIDv1to5("550e8400-e29b-71d4-a716-446655440000") {
		t.Fatal("uuid v1-5 check")
	}
	if CustomerIDOf("pos-abc") != "abc" || CustomerIDOf("abc") != "abc" {
		t.Fatal("customerIdOf")
	}
}

func TestListLimit(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", "50"}, {"10", "10"}, {"500", "200"}, {"0", "0"}, {"abc", "NaN"}, {"2.5", "2.5"},
		{" 7 ", "7"}, {"0x10", "16"}, {"1e2", "100"}, {"-5", "-5"}, {"Infinity", "200"},
	}
	for _, c := range cases {
		if got := JSString(ListLimit(c.in)); got != c.want {
			t.Errorf("ListLimit(%q) = %s, want %s", c.in, got, c.want)
		}
	}
	if !math.IsNaN(JSNumber("1,5")) {
		t.Fatal("comma is not a number")
	}
}
