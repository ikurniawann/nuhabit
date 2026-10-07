package domain

import (
	"math"
	"strings"
)

// The amount bags and event codes operational modules post through journal
// mappings (lib/pos/accounting-amounts.ts, lib/purchasing/accounting-amounts.ts,
// lib/pos/member-bill.ts, lib/inventory/accounting-posting.ts).

func pos0(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	return v
}

// PosAmountsInput are the order (or split) money columns.
type PosAmountsInput struct {
	Subtotal, Discount, Tax, ServiceCharge, OtherCharges float64
	Total                                                *float64 // nil = derive from the parts
	AmountPaid                                           float64
	Cogs                                                 float64
}

// PosAmounts is computePosAccountingAmounts.
func PosAmounts(in PosAmountsInput) Amounts {
	subtotal := Round2(pos0(in.Subtotal))
	discount := Round2(pos0(in.Discount))
	tax := Round2(pos0(in.Tax))
	service := Round2(pos0(in.ServiceCharge))
	other := Round2(pos0(in.OtherCharges))
	serviceCharge := Round2(service + other)
	var total float64
	if in.Total != nil && !math.IsNaN(*in.Total) && !math.IsInf(*in.Total, 0) {
		total = Round2(math.Max(0, *in.Total))
	} else {
		total = Round2(math.Max(0, subtotal-discount+tax+serviceCharge))
	}
	paid := total
	if !math.IsNaN(in.AmountPaid) && !math.IsInf(in.AmountPaid, 0) && in.AmountPaid > 0 {
		paid = Round2(in.AmountPaid)
	}
	return Amounts{
		"SUBTOTAL":       subtotal,
		"DISCOUNT":       discount,
		"TAX":            tax,
		"SERVICE_CHARGE": serviceCharge,
		"TOTAL":          total,
		"PAID":           paid,
		"COGS":           Round2(pos0(in.Cogs)),
	}
}

// SplitInput is one paid split of an order (buildSplitAccountingAmounts).
type SplitInput struct {
	Subtotal, Discount, Tax, Total, AmountPaid float64
	OrderTotal, OrderCogs                      float64
	OrderServiceCharge, OrderOtherCharges      float64
}

// SplitAmounts prorates the order's charges and COGS by the split's share
// of the order total.
func SplitAmounts(in SplitInput) Amounts {
	ratio := 0.0
	if in.OrderTotal > 0 {
		ratio = math.Max(0, in.Total) / in.OrderTotal
	}
	total := in.Total
	return PosAmounts(PosAmountsInput{
		Subtotal:      in.Subtotal,
		Discount:      in.Discount,
		Tax:           in.Tax,
		ServiceCharge: in.OrderServiceCharge * ratio,
		OtherCharges:  in.OrderOtherCharges * ratio,
		Total:         &total,
		AmountPaid:    in.AmountPaid,
		Cogs:          in.OrderCogs * ratio,
	})
}

// SkipNFCTab marks an nfc_tab sale, journaled by ticketing AR instead.
const SkipNFCTab = "SKIP_NFC_TAB"

// SaleEventForMethod is mapPaymentMethodToSaleEvent: the POS sale event
// code, SkipNFCTab, or "" when the method has no mapping.
func SaleEventForMethod(method string) string {
	switch strings.ToLower(strings.TrimFunc(method, IsJSSpace)) {
	case "nfc_tab":
		return SkipNFCTab
	case "cash":
		return "POS_SALE_CASH"
	case "qris":
		return "POS_SALE_QRIS"
	case "debit":
		return "POS_SALE_DEBIT"
	case "credit", "credit_card":
		return "POS_SALE_CREDIT"
	case "ark_coin":
		return "POS_SALE_ARK_COIN"
	case "gift_card":
		return "POS_SALE_GIFT_CARD"
	case "member_bill":
		return "POS_SALE_MEMBER_BILL"
	}
	return ""
}

// MemberDepositEvent is memberDepositEvent: the journal event of a member
// bill instalment by its base payment method, "" for none.
func MemberDepositEvent(baseMethod string) string {
	switch strings.ToLower(baseMethod) {
	case "cash":
		return "POS_MEMBER_DEPOSIT_CASH"
	case "qris":
		return "POS_MEMBER_DEPOSIT_QRIS"
	case "credit_card", "credit", "debit":
		return "POS_MEMBER_DEPOSIT_CARD"
	}
	return ""
}

// PaymentAmounts is buildPaymentAccountingAmounts.
func PaymentAmounts(amount float64) Amounts {
	paid := Round2(pos0(amount))
	return Amounts{"PAID": paid, "TOTAL": paid, "SUBTOTAL": paid}
}

// ReturnAmounts is buildReturnAccountingAmounts.
func ReturnAmounts(total float64) Amounts {
	t := Round2(pos0(total))
	return Amounts{"TOTAL": t, "SUBTOTAL": t}
}

// GrnLine is one received GRN item valued at its PO price.
type GrnLine struct {
	QtyQcPosted, QtyReceived, UnitPrice float64
}

// GrnAmounts is buildGrnAccountingAmounts: Σ accepted qty (or door qty when
// nothing passed QC yet) × PO price, plus PPN.
func GrnAmounts(lines []GrnLine, ppnPercent float64) Amounts {
	subtotal := 0.0
	for _, l := range lines {
		qty := l.QtyReceived
		if l.QtyQcPosted > 0 {
			qty = l.QtyQcPosted
		}
		if qty <= 0 {
			continue
		}
		subtotal += float64(qty * l.UnitPrice)
	}
	subtotal = Round2(subtotal)
	tax := 0.0
	if subtotal > 0 && ppnPercent > 0 {
		tax = Round2(subtotal * ppnPercent / 100)
	}
	return Amounts{"SUBTOTAL": subtotal, "TAX": tax, "TOTAL": Round2(subtotal + tax)}
}

// VarianceLine is one stock variance (opname, adjustment, scrap).
type VarianceLine struct {
	RawMaterialID string
	QtyDiff       float64
	UnitCost      float64
}

// ValuedVariance is a variance line with its absolute value.
type ValuedVariance struct {
	VarianceLine
	Value float64
}

// ValueVariances keeps the lines of one direction (shortage: qty < 0,
// surplus: qty > 0) with a positive value, and their total.
func ValueVariances(lines []VarianceLine, shortage bool) ([]ValuedVariance, float64) {
	total := 0.0
	out := []ValuedVariance{}
	for _, l := range lines {
		if (shortage && !(l.QtyDiff < 0)) || (!shortage && !(l.QtyDiff > 0)) {
			continue
		}
		value := Round2(math.Abs(l.QtyDiff) * l.UnitCost)
		if !(value > 0) {
			continue
		}
		total = Round2(total + value)
		out = append(out, ValuedVariance{l, value})
	}
	return out, total
}

// LandedCostAmounts splits a landed cost batch into the amount bags of
// PURCHASE_LANDED_COST (the positive parts: SUBTOTAL into inventory, COGS
// expensed) and PURCHASE_LANDED_COST_REVERSAL (the negative parts, as
// positive amounts). TOTAL is the AP side of each; a bag with nothing to
// post is nil.
func LandedCostAmounts(capitalized, expensed float64) (post, reverse Amounts) {
	bag := func(stock, cogs float64) Amounts {
		stock, cogs = Round2(math.Max(stock, 0)), Round2(math.Max(cogs, 0))
		if stock+cogs <= 0 {
			return nil
		}
		a := Amounts{"TOTAL": Round2(stock + cogs)}
		if stock > 0 {
			a["SUBTOTAL"] = stock
		}
		if cogs > 0 {
			a["COGS"] = cogs
		}
		return a
	}
	return bag(capitalized, expensed), bag(-capitalized, -expensed)
}
