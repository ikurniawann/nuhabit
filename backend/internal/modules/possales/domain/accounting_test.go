package domain

import (
	"reflect"
	"testing"
)

// buildSplitAccountingAmounts (accounting-posting.ts) wraps
// computePosAccountingAmounts; with OrderTotal == Total the ratio is 1, so the
// accounting-amounts.test.ts cases apply directly.
func TestSplitAccountingAmounts(t *testing.T) {
	cases := []struct {
		name string
		in   SplitAmountsInput
		want map[string]float64
	}{
		{
			"total from parts",
			SplitAmountsInput{Subtotal: 100000, Discount: 10000, Tax: 9000, ServiceCharge: 5000, OtherCharges: 1000, Total: 105000, OrderTotal: 105000},
			map[string]float64{"SUBTOTAL": 100000, "DISCOUNT": 10000, "TAX": 9000, "SERVICE_CHARGE": 6000, "TOTAL": 105000, "PAID": 105000, "COGS": 0},
		},
		{
			"explicit total, paid and COGS rounding",
			SplitAmountsInput{Subtotal: 50, Tax: 5, Total: 55, AmountPaid: 60, OrderTotal: 55, OrderCogs: 18.456},
			map[string]float64{"SUBTOTAL": 50, "DISCOUNT": 0, "TAX": 5, "SERVICE_CHARGE": 0, "TOTAL": 55, "PAID": 60, "COGS": 18.46},
		},
		{
			"negative values ignored",
			SplitAmountsInput{Subtotal: -10, Discount: -5, Total: 0, OrderTotal: 0},
			map[string]float64{"SUBTOTAL": 0, "DISCOUNT": 0, "TAX": 0, "SERVICE_CHARGE": 0, "TOTAL": 0, "PAID": 0, "COGS": 0},
		},
		{
			"split share of service, other and COGS",
			SplitAmountsInput{Subtotal: 40000, Discount: 0, Tax: 4000, Total: 45000, AmountPaid: 50000, OrderTotal: 90000, OrderCogs: 30000, ServiceCharge: 2000, OtherCharges: 1000},
			map[string]float64{"SUBTOTAL": 40000, "DISCOUNT": 0, "TAX": 4000, "SERVICE_CHARGE": 1500, "TOTAL": 45000, "PAID": 50000, "COGS": 15000},
		},
		{
			"thirds round to cents",
			SplitAmountsInput{Subtotal: 100, Total: 100, OrderTotal: 300, OrderCogs: 100, ServiceCharge: 10, OtherCharges: 0.01},
			map[string]float64{"SUBTOTAL": 100, "DISCOUNT": 0, "TAX": 0, "SERVICE_CHARGE": 3.33, "TOTAL": 100, "PAID": 100, "COGS": 33.33},
		},
		{
			"zero order total gives no share",
			SplitAmountsInput{Subtotal: 10, Total: 10, OrderTotal: 0, OrderCogs: 99, ServiceCharge: 99},
			map[string]float64{"SUBTOTAL": 10, "DISCOUNT": 0, "TAX": 0, "SERVICE_CHARGE": 0, "TOTAL": 10, "PAID": 10, "COGS": 0},
		},
		{
			"negative paid falls back to total",
			SplitAmountsInput{Subtotal: 10, Total: 10, AmountPaid: -1, OrderTotal: 10},
			map[string]float64{"SUBTOTAL": 10, "DISCOUNT": 0, "TAX": 0, "SERVICE_CHARGE": 0, "TOTAL": 10, "PAID": 10, "COGS": 0},
		},
	}
	for _, c := range cases {
		if got := SplitAccountingAmounts(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
