package domain

import "testing"

// A one-off addition (a coach incentive) is taxed as the difference between
// the annual tax with and without it, not annualised twelve times over.
func TestCalculateIrregularIncome(t *testing.T) {
	c := DefaultConfig()
	regular := Calculate(baseInput(nil), c)
	oneOff := func(i *Input) { i.Bonus = 30_000_000; i.IrregularIncome = 30_000_000 }
	r := Calculate(baseInput(oneOff), c)

	eq(t, "gross", r.GrossSalary, 42_000_000)
	// Annual base 144,000,000 plus the 30,000,000 once: 174,000,000 less
	// BPJS 8,313,240 and the capped jabatan expense 6,000,000.
	eq(t, "taxable", r.TaxableIncome, 159_686_760)
	// PKP 105,686,000: 5% of 60,000,000 plus 15% of 45,686,000.
	eq(t, "pph annual", r.Pph21Annual, 9_852_900)
	eq(t, "pph on the addition", r.Pph21Irregular, 4_500_000)
	// The month withholds the regular twelfth plus the whole tax on the addition.
	eq(t, "pph withheld", r.Pph21Deduction, regular.Pph21Deduction+4_500_000)
	eq(t, "pph withheld", r.Pph21Deduction, 4_946_075)
	eq(t, "net", r.NetSalary, 42_000_000-(r.TotalDeductions))

	// Annualising the 42,000,000 would have put 185,686,000 in the 25%
	// bracket and withheld 6,493,458 this month.
	annualised := Calculate(baseInput(func(i *Input) { i.Bonus = 30_000_000 }), c)
	eq(t, "annualised bonus", annualised.Pph21Deduction, 6_493_458)
	if annualised.Pph21Deduction <= r.Pph21Deduction {
		t.Fatal("the irregular treatment must withhold less than annualising the addition")
	}

	// Inside one bracket both methods agree: 5,000,000 at 15% is 750,000.
	small := Calculate(baseInput(func(i *Input) { i.Bonus = 5_000_000; i.IrregularIncome = 5_000_000 }), c)
	eq(t, "small addition", small.Pph21Deduction, regular.Pph21Deduction+750_000)
	eq(t, "not taxable", Calculate(baseInput(func(i *Input) { oneOff(i); i.IsTaxable = false }), c).Pph21Deduction, 0)
	eq(t, "no addition", regular.Pph21Irregular, 0)
}
