package domain

import "math"

func round2(n float64) float64 { return RoundHalfUp(n*100) / 100 }

// SplitAmountsInput is buildSplitAccountingAmounts' input.
type SplitAmountsInput struct {
	Subtotal, Discount, Tax, Total, AmountPaid float64
	OrderTotal, OrderCogs                      float64
	ServiceCharge, OtherCharges                float64
}

// SplitAccountingAmounts is buildSplitAccountingAmounts: the split's share
// of the order's service/other charges and COGS, as a JournalAmountMap.
func SplitAccountingAmounts(in SplitAmountsInput) map[string]float64 {
	ratio := 0.0
	if in.OrderTotal > 0 {
		ratio = math.Max(0, Or0(in.Total)) / in.OrderTotal
	}
	subtotal := round2(math.Max(0, Or0(in.Subtotal)))
	discount := round2(math.Max(0, Or0(in.Discount)))
	tax := round2(math.Max(0, Or0(in.Tax)))
	service := round2(math.Max(0, Or0(Or0(in.ServiceCharge)*ratio)))
	other := round2(math.Max(0, Or0(Or0(in.OtherCharges)*ratio)))
	total := round2(math.Max(0, in.Total))
	paid := total
	if Finite(in.AmountPaid) && in.AmountPaid > 0 {
		paid = round2(in.AmountPaid)
	}
	return map[string]float64{
		"SUBTOTAL": subtotal, "DISCOUNT": discount, "TAX": tax, "SERVICE_CHARGE": round2(service + other),
		"TOTAL": total, "PAID": paid, "COGS": round2(math.Max(0, Or0(Or0(in.OrderCogs)*ratio))),
	}
}
