package domain

import (
	"fmt"
	"math"

	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/pdfgen"
)

// Order statuses (manufacturing.production_orders.status).
const (
	StatusDraft      = "DRAFT"
	StatusReleased   = "RELEASED"
	StatusInProgress = "IN_PROGRESS"
	StatusCompleted  = "COMPLETED"
	StatusCancelled  = "CANCELLED"
)

// RuleError is a broken production rule, safe to show (a 400).
type RuleError string

func (e RuleError) Error() string { return string(e) }

// CheckIssue guards a material issue: the order must be released or
// running. The first issue on a released order starts it.
func CheckIssue(status string) error {
	if status != StatusReleased && status != StatusInProgress {
		return RuleError("Bahan hanya bisa dikeluarkan untuk order RELEASED atau IN_PROGRESS")
	}
	return nil
}

// CheckReceipt guards an output receipt.
func CheckReceipt(status string, issues int, qtyGood, qtyScrap float64) error {
	switch {
	case status != StatusInProgress:
		return RuleError("Hasil produksi hanya bisa diterima saat order IN_PROGRESS")
	case issues == 0:
		return RuleError("Keluarkan bahan ke produksi dulu sebelum menerima hasil")
	case qtyGood+qtyScrap <= 0:
		return RuleError("Isi jumlah hasil baik atau scrap")
	}
	return nil
}

// IssueNumber is the n-th issue of an order: PROD-202610-0001-I01.
func IssueNumber(orderNumber string, n int) string { return fmt.Sprintf("%s-I%02d", orderNumber, n) }

// BatchNumber is the n-th batch of an order: PROD-202610-0001-B01, the
// number the one-shot completion also uses for its single batch.
func BatchNumber(orderNumber string, n int) string { return fmt.Sprintf("%s-B%02d", orderNumber, n) }

// Line is one material line of an order with what was issued so far.
type Line struct {
	QtyPlanned float64
	UnitCost   float64 // planned average cost
	QtyIssued  float64
	IssuedCost float64
}

// IssuedUnitCost is the average cost of what was issued, else the planned
// cost.
func (l Line) IssuedUnitCost() float64 {
	if l.QtyIssued > 0 {
		return l.IssuedCost / l.QtyIssued
	}
	return l.UnitCost
}

// StdMaterialPerUnit is the material cost of one planned output unit:
// planned quantities valued at the issued unit costs.
func StdMaterialPerUnit(lines []Line, plannedQty float64) float64 {
	if plannedQty <= 0 {
		return 0
	}
	total := 0.0
	for _, l := range lines {
		total += float64(l.QtyPlanned * l.IssuedUnitCost())
	}
	return total / plannedQty
}

// DefaultScrapTolerancePct is the normal scrap of an order, in percent of
// its planned quantity, when its recipe sets none.
const DefaultScrapTolerancePct = 5.0

// ScrapAllowance is the normal scrap quantity of an order.
func ScrapAllowance(plannedQty, tolerancePct float64) float64 {
	return RoundQty(math.Max(0, plannedQty*tolerancePct/100))
}

// SplitScrap splits a batch's scrap into normal (within what is left of the
// order's allowance after earlier scrap) and abnormal (the rest).
func SplitScrap(earlierScrap, qtyScrap, allowance float64) (normal, abnormal float64) {
	normal = math.Min(qtyScrap, math.Max(0, RoundQty(allowance-earlierScrap)))
	return normal, RoundQty(qtyScrap - normal)
}

// ReceiptInput is the state of an order when a batch comes in.
type ReceiptInput struct {
	PlannedQty           float64
	StdMaterialPerUnit   float64
	IssuedCost           float64 // all issues
	ReceivedMaterialCost float64 // material cost of earlier batches
	ScrapCost            float64 // WIP written off by earlier batches, normal and abnormal material
	Conversion           float64 // overhead + labor + packaging + waste of the order
	AppliedConversion    float64 // conversion cost of earlier batches, abnormal scrap included
	QtyGood              float64
	QtyScrap             float64
	QtyAbnormal          float64 // the part of QtyScrap above the tolerance
	Final                bool
}

// ReceiptCost is the cost split of one batch, rupiah with 2 decimals.
// Total = Material + Conversion is what goes into stock. Abnormal scrap is
// costed like a good unit and expensed: AbnormalMaterial leaves WIP,
// AbnormalConversion is applied to WIP and leaves it with the scrap.
type ReceiptCost struct {
	Material           float64
	Conversion         float64
	Scrap              float64
	AbnormalMaterial   float64
	AbnormalConversion float64
	Total              float64
	HppPerUnit         float64
}

// Abnormal is the expensed cost of the abnormal scrap.
func (c ReceiptCost) Abnormal() float64 { return round2(c.AbnormalMaterial + c.AbnormalConversion) }

func round2(v float64) float64 { return jsmath.RoundTo(v, 2) }

// WipBalance is the material value still in production.
func WipBalance(issued, received, scrapped float64) float64 {
	return math.Max(0, round2(issued-received-scrapped))
}

// CostReceipt costs a batch. A non-final batch takes the standard material
// cost of its good units (capped by the WIP balance) and its share of the
// conversion cost. The final batch takes everything left, so the batches of
// an order add up to what was issued; with no good units the rest is scrap.
// Normal scrap carries no cost of its own and raises the HPP of the good
// units. Abnormal scrap units cost what a good unit of the batch costs: the
// standard unit cost on a non-final batch, an even share of what is left
// with the good units on the final one.
func CostReceipt(in ReceiptInput) ReceiptCost {
	wip := WipBalance(in.IssuedCost, in.ReceivedMaterialCost, in.ScrapCost)
	convLeft := math.Max(0, round2(in.Conversion-in.AppliedConversion))
	abnormal := math.Min(math.Max(0, in.QtyAbnormal), in.QtyScrap)
	share := func(total, units float64) float64 {
		if units <= 0 {
			return 0
		}
		return round2(total * abnormal / units)
	}
	var c ReceiptCost
	switch {
	case in.Final && in.QtyGood <= 0:
		c.AbnormalMaterial = share(wip, in.QtyScrap)
		c.AbnormalConversion = share(convLeft, in.QtyScrap)
		c.Scrap = round2(wip - c.AbnormalMaterial)
	case in.Final:
		c.AbnormalMaterial = share(wip, in.QtyGood+abnormal)
		c.AbnormalConversion = share(convLeft, in.QtyGood+abnormal)
		c.Material, c.Conversion = round2(wip-c.AbnormalMaterial), round2(convLeft-c.AbnormalConversion)
	default:
		c.Material = math.Min(wip, round2(float64(in.QtyGood*in.StdMaterialPerUnit)))
		c.AbnormalMaterial = math.Min(round2(wip-c.Material), round2(float64(abnormal*in.StdMaterialPerUnit)))
		if in.PlannedQty > 0 {
			c.Conversion = math.Min(convLeft, round2(float64(in.Conversion*in.QtyGood)/in.PlannedQty))
			c.AbnormalConversion = math.Min(round2(convLeft-c.Conversion), round2(float64(in.Conversion*abnormal)/in.PlannedQty))
		}
	}
	c.Total = round2(c.Material + c.Conversion)
	if in.QtyGood > 0 {
		c.HppPerUnit = round2(c.Total / in.QtyGood)
	}
	return c
}

// Yield is good / (good + scrap) in percent, nil when nothing came out.
func Yield(good, scrap float64) *float64 {
	if good+scrap <= 0 {
		return nil
	}
	y := round2(good / (good + scrap) * 100)
	return &y
}

// PlannedYield is good / planned in percent, nil without a plan.
func PlannedYield(good, planned float64) *float64 {
	if planned <= 0 {
		return nil
	}
	y := round2(good / planned * 100)
	return &y
}

// Allocate splits total by weights, rounding to 2 decimals; the last
// weighted share takes the rounding remainder.
func Allocate(total float64, weights []float64) []float64 {
	out := make([]float64, len(weights))
	sum := 0.0
	last := -1
	for i, w := range weights {
		sum += w
		if w != 0 {
			last = i
		}
	}
	if sum == 0 || last < 0 {
		return out
	}
	given := 0.0
	for i, w := range weights {
		if i == last {
			out[i] = round2(total - given)
			break
		}
		out[i] = round2(total * w / sum)
		given += out[i]
	}
	return out
}

// Variant is one SKU's share of a finished goods batch.
type Variant struct {
	SkuID string
	Qty   float64
}

// CheckVariants validates the split of qtyGood over the active SKUs of a
// merchandise product: every row a known SKU once, quantities above zero
// that add up to qtyGood (to 0.01). Quantities round to 2 decimals.
func CheckVariants(qtyGood float64, rows []Variant, activeSkuIDs []string) ([]Variant, error) {
	if len(rows) == 0 {
		return nil, RuleError("Rincian varian wajib diisi")
	}
	active := map[string]bool{}
	for _, id := range activeSkuIDs {
		active[id] = true
	}
	seen := map[string]bool{}
	out := make([]Variant, 0, len(rows))
	sum := 0.0
	for _, r := range rows {
		switch {
		case !active[r.SkuID]:
			return nil, RuleError("Varian tidak dikenal / tidak aktif")
		case seen[r.SkuID]:
			return nil, RuleError("Varian ganda")
		case !(r.Qty > 0):
			return nil, RuleError("Qty varian harus > 0")
		}
		seen[r.SkuID] = true
		q := round2(r.Qty)
		out = append(out, Variant{r.SkuID, q})
		sum += q
	}
	if math.Abs(round2(sum)-round2(qtyGood)) > 0.01 {
		return nil, RuleError(fmt.Sprintf("Rincian varian harus berjumlah sama dengan hasil baik (%s vs %s)",
			pdfgen.Thousands(round2(sum)), pdfgen.Thousands(round2(qtyGood))))
	}
	return out, nil
}
