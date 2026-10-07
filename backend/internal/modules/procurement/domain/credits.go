package domain

import (
	"math"
	"sort"
)

// VendorCredit is VendorCreditBalance: an approved credit and what is used.
type VendorCredit struct {
	ID, CreditNumber, CreditDate string // CreditDate YYYY-MM-DD
	TotalAmount, AppliedAmount   float64
	Status                       string
	ExpiryDate                   *string // YYYY-MM-DD, nil = no expiry
}

// CreditAllocation is one credit's share of an application.
type CreditAllocation struct {
	CreditID     string  `json:"credit_id"`
	CreditNumber string  `json:"credit_number"`
	Amount       float64 `json:"amount"`
}

// CreditRemaining is creditRemaining: 0 unless approved.
func CreditRemaining(c VendorCredit) float64 {
	if c.Status != "approved" {
		return 0
	}
	return RoundMoney(math.Max(0, c.TotalAmount-c.AppliedAmount))
}

// IsCreditExpired: an expiry before today (YYYY-MM-DD) has passed.
func IsCreditExpired(c VendorCredit, today string) bool {
	return c.ExpiryDate != nil && *c.ExpiryDate < today
}

// AllocateCredits is allocateCredits: oldest usable credit first, expired
// credits skipped; it returns the allocations and the uncovered rest.
func AllocateCredits(credits []VendorCredit, amount float64, today string) ([]CreditAllocation, float64) {
	remaining := RoundMoney(amount)
	allocations := []CreditAllocation{}
	if remaining <= 0 {
		return allocations, 0
	}
	var usable []VendorCredit
	for _, c := range credits {
		if CreditRemaining(c) > 0 && !IsCreditExpired(c, today) {
			usable = append(usable, c)
		}
	}
	sort.SliceStable(usable, func(i, j int) bool { return usable[i].CreditDate < usable[j].CreditDate })
	for _, c := range usable {
		if remaining <= 0 {
			break
		}
		take := RoundMoney(math.Min(CreditRemaining(c), remaining))
		if take <= 0 {
			continue
		}
		allocations = append(allocations, CreditAllocation{CreditID: c.ID, CreditNumber: c.CreditNumber, Amount: take})
		remaining = RoundMoney(remaining - take)
	}
	return allocations, remaining
}
