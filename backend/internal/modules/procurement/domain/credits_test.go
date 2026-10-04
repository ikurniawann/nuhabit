package domain

import (
	"reflect"
	"testing"
)

const creditToday = "2026-10-03"

func credit(id, date string, total float64, mod func(*VendorCredit)) VendorCredit {
	c := VendorCredit{ID: id, CreditNumber: "VC-" + id, CreditDate: date, TotalAmount: total, Status: "approved"}
	if mod != nil {
		mod(&c)
	}
	return c
}

func TestAllocateCredits(t *testing.T) {
	got, rest := AllocateCredits([]VendorCredit{credit("baru", "2026-09-20", 500000, nil), credit("lama", "2026-08-01", 300000, nil)}, 400000, creditToday)
	want := []CreditAllocation{{"lama", "VC-lama", 300000}, {"baru", "VC-baru", 100000}}
	if !reflect.DeepEqual(got, want) || rest != 0 {
		t.Fatalf("oldest first: %v %v", got, rest)
	}
	got, rest = AllocateCredits([]VendorCredit{
		credit("hangus", "2026-07-01", 1000000, func(c *VendorCredit) { c.ExpiryDate = sp("2026-10-02") }),
		credit("hari-ini", "2026-08-01", 200000, func(c *VendorCredit) { c.ExpiryDate = sp(creditToday) }),
	}, 500000, creditToday)
	if len(got) != 1 || got[0].CreditID != "hari-ini" || rest != 300000 {
		t.Fatalf("expiry: %v %v", got, rest)
	}
	got, rest = AllocateCredits([]VendorCredit{credit("a", "2026-08-01", 100000, func(c *VendorCredit) { c.AppliedAmount = 70000 })}, 50000, creditToday)
	if got[0].Amount != 30000 || rest != 20000 {
		t.Fatalf("partial: %v %v", got, rest)
	}
	got, rest = AllocateCredits([]VendorCredit{
		credit("draft", "2026-08-01", 100000, func(c *VendorCredit) { c.Status = "draft" }),
		credit("batal", "2026-08-02", 100000, func(c *VendorCredit) { c.Status = "cancelled" }),
	}, 50000, creditToday)
	if len(got) != 0 || rest != 50000 {
		t.Fatalf("unapproved: %v %v", got, rest)
	}
	if got, rest := AllocateCredits([]VendorCredit{credit("a", "2026-08-01", 100, nil)}, 0, creditToday); len(got) != 0 || rest != 0 {
		t.Fatal("zero amount")
	}
	if CreditRemaining(credit("a", "2026-08-01", 100.005, func(c *VendorCredit) { c.AppliedAmount = 0.001 })) != 100 {
		t.Fatal("cents")
	}
}
