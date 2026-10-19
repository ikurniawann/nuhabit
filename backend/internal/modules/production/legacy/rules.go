package legacy

import (
	"math"
	"strconv"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/pdfgen"
)

// Order rules of the TS routes: lib/purchasing/production-calc.ts and
// lib/manufacturing/variant-output.ts.

// coverageMode picks actual quantities once an order is running.
func coverageMode(status string) string {
	if status == "IN_PROGRESS" || status == "COMPLETED" {
		return "actual"
	}
	return "planned"
}

// nextProductionStep is nextProductionStep.
func nextProductionStep(status string) string {
	switch status {
	case "DRAFT":
		return "Production order bisa di-release."
	case "RELEASED":
		return "Production order bisa dimulai."
	case "IN_PROGRESS":
		return "Production order bisa diselesaikan."
	case "COMPLETED":
		return "Production order sudah selesai."
	case "CANCELLED":
		return "Production order sudah dibatalkan."
	}
	return "Production order bisa dilanjutkan."
}

// batchNumber is the deterministic single batch of an order.
func batchNumber(orderNumber string) string { return orderNumber + "-B01" }

// completionMessage is completionMessage (margin nil = not synced to POS).
func completionMessage(orderNumber string, hppPerUnit float64, margin *float64) string {
	base := "Produksi " + orderNumber + " selesai. HPP aktual " + pdfgen.Rupiah(hppPerUnit)
	if margin == nil {
		return base
	}
	return base + " tersinkron ke POS. Margin POS " + kit.JSNum(*margin) + "%."
}

// variantRow is one SKU's share of a batch.
type variantRow struct {
	PosSkuID string
	Qty      float64
}

func round2(v float64) float64 { return jsmath.RoundTo(v, 2) }

func qtyForMessage(v float64) string {
	r := round2(v)
	if r == math.Trunc(r) {
		return kit.JSNum(r)
	}
	return strconv.FormatFloat(r, 'f', 2, 64)
}

// validateVariantSplit is validateVariantSplit ("" error = valid rows).
func validateVariantSplit(actualQty float64, rows []variantRow, activeSkuIDs []string) ([]variantRow, string) {
	if len(rows) == 0 {
		return nil, "Rincian varian wajib diisi"
	}
	active := map[string]bool{}
	for _, id := range activeSkuIDs {
		active[id] = true
	}
	seen := map[string]bool{}
	var out []variantRow
	sum := 0.0
	for _, r := range rows {
		if r.PosSkuID == "" || !active[r.PosSkuID] {
			return nil, "Varian tidak dikenal / tidak aktif"
		}
		if seen[r.PosSkuID] {
			return nil, "Varian ganda"
		}
		seen[r.PosSkuID] = true
		if math.IsNaN(r.Qty) || math.IsInf(r.Qty, 0) || r.Qty <= 0 {
			return nil, "Qty varian harus > 0"
		}
		q := round2(r.Qty)
		out = append(out, variantRow{r.PosSkuID, q})
		sum += q
	}
	sum = round2(sum)
	target := round2(actualQty)
	if math.Abs(sum-target) > 0.01 {
		return nil, "Rincian varian harus berjumlah sama dengan jumlah aktual (" + qtyForMessage(sum) + " vs " + qtyForMessage(target) + ")"
	}
	return out, ""
}
