package domain

import (
	"math"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
)

// QuotationStatuses is QUOTATION_STATUSES.
var QuotationStatuses = []string{"draft", "terkirim", "diterima", "ditolak"}

// MaxLineTotal bounds a quotation line (numeric(14,2)).
const MaxLineTotal = 999_999_999_999

// QuotationItem is one validated quotationItemSchema row.
type QuotationItem struct {
	ItemType    string
	ProductID   *string
	Description string
	Qty         float64
	UnitPrice   float64
	LineTotal   float64
}

// QuotationTerm is one validated quotationTermSchema row.
type QuotationTerm struct {
	Label   string
	Percent float64
	DueDate *string // nil for absent, null or ""
}

// QuotationPayload is quotationPayloadSchema's output.
type QuotationPayload struct {
	UsePpn          bool
	PpnPersen       float64
	DiscountPercent float64
	Notes           *string
	ValidUntil      *string
	Items           []QuotationItem
	Terms           []QuotationTerm
}

// Totals is computeTotals' result (line totals are written into Items).
type Totals struct {
	Subtotal, DiscountNominal, PpnNominal, Total float64
}

// ComputeTotals is computeTotals: line totals and subtotal to the cent, the
// discount from the subtotal, PPN from the base after discount.
func ComputeTotals(p *QuotationPayload) Totals {
	sum := 0.0
	for i := range p.Items {
		it := &p.Items[i]
		it.LineTotal = jsmath.Round(float64(it.Qty*it.UnitPrice)*100) / 100
		sum += it.LineTotal
	}
	subtotal := jsmath.Round(float64(sum*100)) / 100
	pct := math.Min(100, math.Max(0, p.DiscountPercent))
	discount := jsmath.Round(float64(subtotal*pct)) / 100
	dpp := jsmath.Round(float64((subtotal-discount)*100)) / 100
	ppn := 0.0
	if p.UsePpn {
		ppn = jsmath.Round(float64(dpp*p.PpnPersen)) / 100
	}
	total := jsmath.Round(float64((dpp+ppn)*100)) / 100
	return Totals{Subtotal: subtotal, DiscountNominal: discount, PpnNominal: ppn, Total: total}
}

// TermsSumTo100 is the terms refine: no terms, or Σ percent within 0.01 of 100.
func TermsSumTo100(terms []QuotationTerm) bool {
	if len(terms) == 0 {
		return true
	}
	sum := 0.0
	for _, t := range terms {
		sum += t.Percent
	}
	return math.Abs(sum-100) <= 0.01
}

// AllocateTermAmounts is allocateTermAmounts: cumulative 2dp rounding, so
// the amounts always add up to the total.
func AllocateTermAmounts(total float64, percents []float64) []float64 {
	amounts := []float64{}
	cumAssigned, cumPercent := 0.0, 0.0
	for i, p := range percents {
		cumPercent += p
		var cumTarget float64
		if i == len(percents)-1 {
			cumTarget = jsmath.Round(float64(total*100)) / 100
		} else {
			cumTarget = jsmath.Round(float64(float64(total*cumPercent)/100)*100) / 100
		}
		amount := jsmath.Round(float64((cumTarget-cumAssigned)*100)) / 100
		amounts = append(amounts, amount)
		cumAssigned = jsmath.Round(float64((cumAssigned+amount)*100)) / 100
	}
	return amounts
}

// TermProgress is one term's payment progress.
type TermProgress struct {
	Label   string  `json:"label"`
	DueDate *string `json:"due_date"`
	Percent float64 `json:"percent"`
	Amount  float64 `json:"amount"`
	Paid    float64 `json:"paid"`
	Status  string  `json:"status"`
}

// TermInput is a term as loaded for progress.
type TermInput struct {
	Label   string
	DueDate *string
	Percent float64
}

// TermProgressOf is termProgress: payments fill the terms in order.
func TermProgressOf(terms []TermInput, total, paidTotal float64) []TermProgress {
	percents := make([]float64, len(terms))
	for i, t := range terms {
		percents[i] = t.Percent
	}
	amounts := AllocateTermAmounts(total, percents)
	remaining := jsmath.Round(float64(paidTotal*100)) / 100
	out := []TermProgress{}
	for i, t := range terms {
		amount := amounts[i]
		paid := jsmath.Round(float64(math.Min(amount, math.Max(0, remaining))*100)) / 100
		remaining = jsmath.Round(float64((remaining-paid)*100)) / 100
		status := "belum"
		switch {
		case paid >= amount && amount > 0:
			status = "lunas"
		case paid > 0:
			status = "sebagian"
		}
		out = append(out, TermProgress{Label: t.Label, DueDate: t.DueDate, Percent: t.Percent, Amount: amount, Paid: paid, Status: status})
	}
	return out
}

// QuotationWaSummary is the quotation header of the WhatsApp summary.
type QuotationWaSummary struct {
	QuoteNumber string
	BranchName  *string
	PicName     string
	DealTitle   string
	OrgName     string
	UsePpn      bool
	PpnPersen   float64
	Subtotal    float64
	PpnNominal  float64
	Total       float64
	EventDate   *string // YYYY-MM-DD
	ValidUntil  *string // YYYY-MM-DD
	Notes       *string
}

// QuotationWaItem is one line of the WhatsApp summary.
type QuotationWaItem struct {
	Description string
	ItemType    string
	Qty         float64
	UnitPrice   float64
	LineTotal   float64
}

// BuildQuotationWaMessage is buildQuotationWaMessage.
func BuildQuotationWaMessage(q QuotationWaSummary, items []QuotationWaItem) string {
	var lines []string
	add := func(s string) { lines = append(lines, s) }
	add("*PENAWARAN " + q.QuoteNumber + "*")
	if q.BranchName != nil && *q.BranchName != "" {
		add("_" + *q.BranchName + "_")
	}
	add("")
	add("Halo " + q.PicName + ", berikut ringkasan penawaran untuk *" + q.DealTitle + "* (" + q.OrgName + "):")
	add("")
	for _, it := range items {
		unit := "x"
		if it.ItemType == "produk" {
			unit = " pax"
		}
		add("• " + it.Description + " — " + FormatNumber(it.Qty, 3) + unit + " @ " + FormatRupiah(it.UnitPrice) + " = *" + FormatRupiah(it.LineTotal) + "*")
	}
	add("")
	add("Subtotal: " + FormatRupiah(q.Subtotal))
	if q.UsePpn {
		add("PPN " + JSNumberString(q.PpnPersen) + "%: " + FormatRupiah(q.PpnNominal))
	}
	add("*TOTAL: " + FormatRupiah(q.Total) + "*")
	add("")
	if q.EventDate != nil {
		add("Tanggal acara: " + FormatDateLong(*q.EventDate, "-"))
	}
	if q.ValidUntil != nil {
		add("Penawaran berlaku s.d. " + FormatDateLong(*q.ValidUntil, "-"))
	}
	if q.Notes != nil && *q.Notes != "" {
		add("Catatan: " + *q.Notes)
	}
	add("")
	add("Bila sudah sesuai, mohon konfirmasinya ya 🙏")
	return strings.Join(lines, "\n")
}

// PaymentStatus is derivePaymentStatus.
func PaymentStatus(paid, amount float64) string {
	switch {
	case amount > 0 && paid >= amount:
		return "lunas"
	case paid > 0:
		return "sebagian"
	}
	return "belum"
}

// ReferenceTotal is resolveReferenceTotal: an accepted quotation, then the
// deal's final value, then the latest quotation, then the estimate.
// Arguments are the raw column values (numeric strings or nil).
func ReferenceTotal(refStatus string, refTotal any, hasRef bool, valueFinal, valueEstimate any) float64 {
	switch {
	case hasRef && refStatus == "diterima":
		return ToNumber(refTotal)
	case valueFinal != nil:
		return ToNumber(valueFinal)
	case hasRef:
		return ToNumber(refTotal)
	case valueEstimate != nil:
		return ToNumber(valueEstimate)
	}
	return 0
}

// RoundCents is roundCents.
func RoundCents(v float64) float64 { return jsmath.RoundTo(v, 2) }
