package domain

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

/* ── batches & expiry (frontend/src/lib/inventory/batches.ts) ────────── */

func dateDays(date string) (int, bool) {
	if len(date) < 10 {
		return 0, false
	}
	t, err := time.Parse("2006-01-02", date[:10])
	if err != nil {
		return 0, false
	}
	return int(t.Unix() / 86400), true
}

// DaysBetween is to - from in calendar days.
func DaysBetween(from, to string) int {
	f, _ := dateDays(from)
	t, _ := dateDays(to)
	return t - f
}

// ExpiryState is none, fresh, near or expired.
func ExpiryState(expiryDate *string, today string, warningDays int) string {
	if expiryDate == nil {
		return "none"
	}
	days := DaysBetween(today, *expiryDate)
	switch {
	case days < 0:
		return "expired"
	case days <= warningDays:
		return "near"
	}
	return "fresh"
}

// ExpiryBatch is the input of SummarizeExpiry.
type ExpiryBatch struct {
	ExpiryDate   *string
	QtyRemaining float64
	ValueCost    float64
}

// ExpirySummary is the summary block of GET /api/inventory/expiry.
type ExpirySummary struct {
	NearBatches    int     `json:"nearBatches"`
	NearQty        float64 `json:"nearQty"`
	NearValue      float64 `json:"nearValue"`
	ExpiredBatches int     `json:"expiredBatches"`
	ExpiredQty     float64 `json:"expiredQty"`
	ExpiredValue   float64 `json:"expiredValue"`
}

// SummarizeExpiry is summarizeExpiry.
func SummarizeExpiry(batches []ExpiryBatch, today string, warningDays int) ExpirySummary {
	var s ExpirySummary
	for _, b := range batches {
		if b.QtyRemaining <= 0 {
			continue
		}
		value := b.QtyRemaining * b.ValueCost
		switch ExpiryState(b.ExpiryDate, today, warningDays) {
		case "near":
			s.NearBatches++
			s.NearQty += b.QtyRemaining
			s.NearValue += value
		case "expired":
			s.ExpiredBatches++
			s.ExpiredQty += b.QtyRemaining
			s.ExpiredValue += value
		}
	}
	s.NearQty = RoundQty(s.NearQty)
	s.ExpiredQty = RoundQty(s.ExpiredQty)
	s.NearValue = RoundMoney(s.NearValue)
	s.ExpiredValue = RoundMoney(s.ExpiredValue)
	return s
}

/* ── reorder (frontend/src/lib/inventory/reorder.ts) ─────────────────── */

// StockLevel feeds the reorder suggestion.
type StockLevel struct {
	OnHand, OnOrder, Minimum float64
	Maximum                  *float64
}

// ReorderQuantity orders up to max(minimum, maximum) minus stock and orders.
func ReorderQuantity(l StockLevel) float64 {
	maxv := 0.0
	if l.Maximum != nil {
		maxv = *l.Maximum
	}
	needed := math.Max(l.Minimum, maxv) - (l.OnHand + l.OnOrder)
	if needed <= 0 {
		return 0
	}
	return RoundQty(needed)
}

// ReorderSuggestion is suggestReorder's result.
type ReorderSuggestion struct {
	Shortage, SuggestedQty float64
	Basis                  string
}

// SuggestReorder is suggestReorder.
func SuggestReorder(l StockLevel) ReorderSuggestion {
	shortage := math.Max(0, RoundQty(l.Minimum-l.OnHand))
	if l.Maximum != nil && *l.Maximum > 0 {
		return ReorderSuggestion{shortage, ReorderQuantity(l), "maximum"}
	}
	suggested := l.Minimum
	if shortage > 0 {
		suggested = math.Ceil(shortage * 1.5)
	}
	return ReorderSuggestion{shortage, suggested, "minimum_buffer"}
}

/* ── stock status (warehouse-stock.ts) ───────────────────────────────── */

// StockStatus is computeStockStatus: HABIS, MENIPIS or AMAN.
func StockStatus(qtyOnhand, minStock float64) string {
	switch {
	case qtyOnhand <= 0:
		return "HABIS"
	case qtyOnhand <= minStock:
		return "MENIPIS"
	}
	return "AMAN"
}

/* ── opname rules (opname-rules.ts) ──────────────────────────────────── */

// Rejection is a 400 with a TS message.
type Rejection string

func (r Rejection) Error() string { return string(r) }

// AssertOpnameEditable rejects completed and cancelled opnames.
func AssertOpnameEditable(status string) error {
	switch status {
	case "completed":
		return Rejection("Stock opname yang sudah selesai tidak dapat diubah")
	case "cancelled":
		return Rejection("Stock opname yang dibatalkan tidak dapat diubah")
	}
	return nil
}

// AssertOpnameCompletable also requires every line to be counted.
func AssertOpnameCompletable(status string, counted []bool) error {
	switch status {
	case "completed":
		return Rejection("Stock opname sudah diselesaikan sebelumnya")
	case "cancelled":
		return Rejection("Stock opname yang dibatalkan tidak dapat diselesaikan")
	}
	uncounted := 0
	for _, c := range counted {
		if !c {
			uncounted++
		}
	}
	if uncounted > 0 {
		return Rejection(fmt.Sprintf("Masih ada %d baris yang belum dihitung", uncounted))
	}
	return nil
}

// OpnameLineCount is one line's counted state for SummarizeOpnameCounts.
type OpnameLineCount struct {
	Counted  *float64
	Variance *float64
}

// SummarizeOpnameCounts returns lines_counted, lines_with_variance and the
// next status (draft becomes in_progress once a line is counted).
func SummarizeOpnameCounts(status string, lines []OpnameLineCount) (counted, withVariance int, next string) {
	for _, l := range lines {
		if l.Counted != nil {
			counted++
		}
		if l.Variance != nil && *l.Variance != 0 {
			withVariance++
		}
	}
	next = status
	if status == "draft" && counted > 0 {
		next = "in_progress"
	}
	return counted, withVariance, next
}

/* ── scrap (scrap.ts, scrap-reasons.ts) ──────────────────────────────── */

// ScrapReasons are the allowed reasons with their labels, in schema order.
var ScrapReasons = []struct{ Value, Label string }{
	{"expired", "Kedaluwarsa"},
	{"damaged", "Rusak"},
	{"spoiled", "Basi / busuk"},
	{"sample", "Sampel / R&D"},
	{"other", "Lainnya"},
}

// ScrapReasonLabel returns the label of a reason.
func ScrapReasonLabel(reason string) string {
	for _, r := range ScrapReasons {
		if r.Value == reason {
			return r.Label
		}
	}
	return ""
}

// EvaluateScrap is evaluateScrap: "" when the scrap may proceed.
func EvaluateScrap(qty, qtyAvailable float64, batchRemaining *float64) string {
	qty = RoundQty(qty)
	if !(qty > 0) {
		return "Qty scrap harus lebih dari 0"
	}
	if qty > RoundQty(qtyAvailable) {
		return "Stok gudang tidak cukup (tersedia " + jsNum(RoundQty(qtyAvailable)) + ")"
	}
	if batchRemaining != nil && qty > RoundQty(*batchRemaining) {
		return "Qty melebihi sisa batch (" + jsNum(RoundQty(*batchRemaining)) + ")"
	}
	return ""
}

/* ── transfers (stock-transfer.ts, stall-labels.ts) ──────────────────── */

var stallCode = regexp.MustCompile(`(?i)^STALL-0*\d+$`)

// IsMainStorageCode reports the MAIN code.
func IsMainStorageCode(code string) bool { return strings.ToUpper(strings.TrimSpace(code)) == "MAIN" }

// IsStallCode reports STALL-NN codes.
func IsStallCode(code string) bool { return stallCode.MatchString(strings.TrimSpace(code)) }

// InferTransferKind is inferTransferKind (nil when the pair fits no kind).
func InferTransferKind(sourceCode, destCode string) *string {
	sm, dm := IsMainStorageCode(sourceCode), IsMainStorageCode(destCode)
	ss, ds := IsStallCode(sourceCode), IsStallCode(destCode)
	var k string
	switch {
	case sm && ds:
		k = "main_to_stall"
	case ss && ds:
		k = "stall_to_stall"
	case ss && dm:
		k = "stall_to_main"
	default:
		return nil
	}
	return &k
}

// TransferWarehouse is the part of a warehouse a transfer checks.
type TransferWarehouse struct {
	ID, Code, BranchID string
}

// ValidateTransferWarehouses is validateTransferWarehouses ("" = valid).
func ValidateTransferWarehouses(kind string, source, dest TransferWarehouse) string {
	if source.ID == dest.ID {
		return "Source and destination must be different"
	}
	if source.BranchID != dest.BranchID {
		return "Source and destination must belong to the same branch"
	}
	sm, dm := IsMainStorageCode(source.Code), IsMainStorageCode(dest.Code)
	ss, ds := IsStallCode(source.Code), IsStallCode(dest.Code)
	switch kind {
	case "main_to_stall":
		if !sm {
			return "Source must be Main Storage"
		}
		if !ds {
			return "Destination must be a stall"
		}
	case "stall_to_stall":
		if !ss {
			return "Source must be a stall"
		}
		if !ds {
			return "Destination must be a stall"
		}
	case "stall_to_main":
		if !ss {
			return "Source must be a stall"
		}
		if !dm {
			return "Destination must be Main Storage"
		}
	}
	return ""
}

// WeightedAverage is the moving average cost after adding qty at cost
// ((before*prev + qty*cost) / total, or cost when the total is not
// positive).
func WeightedAverage(qtyBefore, prevCost, qty, cost float64) float64 {
	total := qtyBefore + qty
	if total > 0 {
		return (qtyBefore*prevCost + qty*cost) / total
	}
	return cost
}

// SignedDiff renders a quantity change as the TS template
// `${diff > 0 ? "+" : ""}${diff}`.
func SignedDiff(diff float64) string {
	if diff > 0 {
		return "+" + jsNum(diff)
	}
	return jsNum(diff)
}
