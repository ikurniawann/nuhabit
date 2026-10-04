package domain

import (
	"fmt"
	"math"
	"slices"
	"strings"
	"time"
	"unicode"
)

// PO statuses. "partial" is the legacy alias of partially_received.
const (
	PoDraft             = "draft"
	PoApproved          = "approved"
	PoSent              = "sent"
	PoPartiallyReceived = "partially_received"
	PoReceived          = "received"
	PoCancelled         = "cancelled"
	PoClosed            = "closed"
)

// poTransitions is PO_TRANSITIONS.
var poTransitions = map[string][]string{
	PoDraft:             {PoApproved, PoCancelled},
	PoApproved:          {PoSent, PoCancelled},
	PoSent:              {PoPartiallyReceived, PoReceived, PoCancelled},
	PoPartiallyReceived: {PoReceived, PoCancelled, PoClosed},
	PoReceived:          {PoClosed},
	PoCancelled:         {},
	PoClosed:            {},
}

// NormalizePoStatus maps the legacy "partial" to partially_received.
func NormalizePoStatus(status string) string {
	if status == "partial" {
		return PoPartiallyReceived
	}
	return status
}

// CanTransitionPo is canTransition.
func CanTransitionPo(from, to string) bool {
	return slices.Contains(poTransitions[NormalizePoStatus(from)], to)
}

// PoTransitionError is validateTransition's message, "" when allowed.
func PoTransitionError(from, to string) string {
	from = NormalizePoStatus(from)
	if CanTransitionPo(from, to) {
		return ""
	}
	allowed := strings.Join(poTransitions[from], ", ")
	if allowed == "" {
		allowed = "none"
	}
	return fmt.Sprintf("Invalid state transition: %s → %s. Allowed: %s", from, to, allowed)
}

// HoldsOnOrderQty: a sent PO not fully received keeps qty_on_order.
func HoldsOnOrderQty(status string) bool {
	return status == PoSent || status == "partial" || status == PoPartiallyReceived
}

// OpenQty is max(0, ordered − received).
func OpenQty(ordered, received float64) float64 { return math.Max(0, ordered-received) }

// PoLine is the part of a PO line the totals read.
type PoLine struct {
	Qty, Price, Discount float64
}

// SumPoLines is Σ (qty × price − line discount).
func SumPoLines(lines []PoLine) float64 {
	sum := 0.0
	for _, l := range lines {
		sum += l.Qty*l.Price - l.Discount
	}
	return sum
}

// PoTotals is computePoTotals' result.
type PoTotals struct {
	Subtotal, DiskonNominal, PpnNominal, Total float64
}

// ComputePoTotals: a positive discount percent wins over the nominal
// discount; PPN applies to max(0, subtotal − discount). A nil PPN percent is
// the 11% default; an explicit 0 stays 0 (no PPN).
func ComputePoTotals(subtotal float64, diskonPersen, diskonNominal, ppnPersen *float64) PoTotals {
	persen := deref(diskonPersen)
	discount := deref(diskonNominal)
	if persen > 0 {
		discount = subtotal * persen / 100
	}
	taxable := math.Max(0, subtotal-discount)
	ppnRate := 11.0
	if ppnPersen != nil {
		ppnRate = *ppnPersen
	}
	ppn := taxable * ppnRate / 100
	return PoTotals{Subtotal: subtotal, DiskonNominal: discount, PpnNominal: ppn, Total: taxable + ppn}
}

func deref(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// Ptr returns &v.
func Ptr[T any](v T) *T { return &v }

// SkuLine is one product PO line with its optional SKU.
type SkuLine struct {
	ProductID string
	PosSkuID  *string
}

// SkuOwner is a POS SKU joined to the item product that owns it.
type SkuOwner struct {
	ID              string
	SourceProductID string
	IsActive        bool
}

// ValidatePoLinesAgainstSkus is validatePoLinesAgainstSkus; "" means valid.
func ValidatePoLinesAgainstSkus(items []SkuLine, skus []SkuOwner, variantProducts map[string]bool) string {
	byID := map[string]SkuOwner{}
	for _, s := range skus {
		byID[s.ID] = s
	}
	seen := map[string]bool{}
	for _, item := range items {
		if item.PosSkuID != nil && *item.PosSkuID != "" {
			sku, ok := byID[*item.PosSkuID]
			if !ok || !sku.IsActive || sku.SourceProductID != item.ProductID {
				return "Varian tidak sesuai produk"
			}
			key := item.ProductID + "::" + *item.PosSkuID
			if seen[key] {
				return "Baris SKU ganda"
			}
			seen[key] = true
			continue
		}
		if variantProducts[item.ProductID] {
			return "Produk ber-varian wajib memilih SKU"
		}
	}
	return ""
}

// QtyEpsilon is the cents tolerance of the payment checks.
const QtyEpsilon = 0.01

// InvoiceAmounts is computePoInvoiceAmounts' result.
type InvoiceAmounts struct {
	GrossPayable    float64 `json:"gross_payable_amount"`
	ReturnCredit    float64 `json:"return_credit_amount"`
	RejectCredit    float64 `json:"reject_credit_amount"`
	TotalCredit     float64 `json:"total_credit_amount"`
	Payable         float64 `json:"payable_amount"`
	Paid            float64 `json:"paid_amount"`
	Outstanding     float64 `json:"outstanding_amount"`
	PaymentProgress float64 `json:"payment_progress_pct"`
	PaymentStatus   string  `json:"payment_status"`
}

// ComputePoInvoiceAmounts nets credits off the gross payable. today is the
// local calendar day; nextDueDate is a YYYY-MM-DD local date or "".
func ComputePoInvoiceAmounts(gross, returnCredit, rejectCredit, paid float64, nextDueDate string, today time.Time) InvoiceAmounts {
	gross = math.Max(0, gross)
	returnCredit = math.Max(0, returnCredit)
	rejectCredit = math.Max(0, rejectCredit)
	total := returnCredit + rejectCredit
	paid = math.Max(0, paid)
	payable := math.Max(0, gross-total)
	outstanding := math.Max(0, payable-paid)

	status := "unpaid"
	switch {
	case payable <= QtyEpsilon || outstanding <= QtyEpsilon:
		status = "paid"
	case paid > 0:
		status = "partial"
	case nextDueDate != "" && nextDueDate < today.Format("2006-01-02"):
		status = "overdue"
	}
	progress := 100.0
	if payable > QtyEpsilon {
		progress = math.Min(100, JSRound(paid/payable*10000)/100)
	}
	return InvoiceAmounts{
		GrossPayable: gross, ReturnCredit: returnCredit, RejectCredit: rejectCredit, TotalCredit: total,
		Payable: payable, Paid: paid, Outstanding: outstanding, PaymentProgress: progress, PaymentStatus: status,
	}
}

// ShortageAmount is computePoShortageAmount: Σ max(0, ordered − received) × price.
func ShortageAmount(lines []PoLine, received []float64) float64 {
	sum := 0.0
	for i, l := range lines {
		sum += math.Max(0, l.Qty-received[i]) * l.Price
	}
	return RoundMoney(sum)
}

// OrderProgress is computeOrderProgress.
func OrderProgress(status string) float64 {
	switch strings.ToLower(status) {
	case PoCancelled, PoDraft:
		return 0
	case PoApproved:
		return 50
	}
	return 100
}

// RoundPct clamps into [0, 100] and rounds to 2 decimals.
func RoundPct(v float64) float64 { return JSRound(math.Min(100, math.Max(0, v))*100) / 100 }

// Fulfillment is computePoFulfillmentProgress over summed GRN quantities.
type Fulfillment struct {
	Order, Receipt, QC, Return, Overall float64
	Received, QCPosted, Returned        float64
}

// ComputeFulfillment mirrors computePoFulfillmentProgress.
func ComputeFulfillment(status string, receivingPct, received, qcPosted, returned float64) Fulfillment {
	f := Fulfillment{Order: OrderProgress(status), Receipt: RoundPct(receivingPct), Received: received, QCPosted: qcPosted, Returned: returned}
	if received > 0 {
		f.QC = RoundPct(qcPosted / received * 100)
	}
	switch {
	case qcPosted > 0:
		f.Return = RoundPct(returned / qcPosted * 100)
	case returned > 0:
		f.Return = 100
	}
	f.Overall = RoundPct((f.Order + f.Receipt + f.QC + f.Return) / 4)
	return f
}

// RemainingSchedulable is max(0, payable − Σ active term amounts).
func RemainingSchedulable(payable float64, terms []float64) float64 {
	sum := 0.0
	for _, t := range terms {
		sum += t
	}
	return math.Max(0, payable-sum)
}

// PaymentTermLabel is resolvePaymentTermLabel.
func PaymentTermLabel(amount, outstanding float64, termIndex int) string {
	if amount >= outstanding-QtyEpsilon {
		return "Paid in Full"
	}
	if termIndex <= 1 {
		return "Installment 1"
	}
	return fmt.Sprintf("Installment %d", termIndex)
}

// NormalizeTermDescription is normalizeTermDescription.
func NormalizeTermDescription(description string, amount, payable float64, termNo int) string {
	trimmed := jsTrim(description)
	lower := strings.ToLower(trimmed)
	defaultLike := lower == "down payment" || lower == "termin" || isPaymentTermN(lower)
	if amount >= payable-QtyEpsilon && (defaultLike || termNo == 1) {
		return "Paid in Full"
	}
	if trimmed != "" {
		return trimmed
	}
	return PaymentTermLabel(amount, payable, termNo)
}

func isPaymentTermN(lower string) bool {
	rest, ok := strings.CutPrefix(lower, "payment term ")
	if !ok || rest == "" {
		return false
	}
	for _, c := range rest {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF })
}
