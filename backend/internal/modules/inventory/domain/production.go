package domain

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/jsmath"
)

// Production rules: lib/purchasing/production-calc.ts,
// lib/manufacturing/variant-output.ts and lib/purchasing/cogs-estimate.ts.

// CoverageMode picks actual quantities once an order is running.
func CoverageMode(status string) string {
	if status == "IN_PROGRESS" || status == "COMPLETED" {
		return "actual"
	}
	return "planned"
}

// NextProductionStep is nextProductionStep.
func NextProductionStep(status string) string {
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

// BatchNumber is the deterministic single batch of an order.
func BatchNumber(orderNumber string) string { return orderNumber + "-B01" }

var nonAlnum = regexp.MustCompile(`[^A-Za-z0-9]`)

// WipCode is buildWipCode.
func WipCode(productCode string) string {
	base := productCode
	if base == "" {
		base = "WIP"
	}
	base = nonAlnum.ReplaceAllString(base, "")
	if len(base) > 17 {
		base = base[:17]
	}
	code := "WP" + base
	if len(code) > 20 {
		code = code[:20]
	}
	return strings.ToUpper(code)
}

// ProductionNumberPrefix is PROD-YYYYMM on the server clock (UTC).
func ProductionNumberPrefix(now time.Time) string { return "PROD-" + now.UTC().Format("200601") }

// NextProductionNumber is nextProductionNumber: the last sequence + 1.
func NextProductionNumber(prefix, last string) string {
	next := 1
	if last != "" {
		parts := strings.Split(last, "-")
		if n := jsNumber(parts[len(parts)-1]); !math.IsNaN(n) && !math.IsInf(n, 0) {
			next = int(n) + 1
		}
	}
	return fmt.Sprintf("%s-%04d", prefix, next)
}

func jsNumber(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// CompletionMessage is completionMessage (margin nil = not synced to POS).
func CompletionMessage(orderNumber string, hppPerUnit float64, margin *float64) string {
	base := "Produksi " + orderNumber + " selesai. HPP aktual " + FormatRupiah(hppPerUnit)
	if margin == nil {
		return base
	}
	return base + " tersinkron ke POS. Margin POS " + JSNum(*margin) + "%."
}

/* ── variant split (variant-output.ts) ───────────────────────────────── */

// VariantRow is one SKU's share of a batch.
type VariantRow struct {
	PosSkuID string
	Qty      float64
}

func round2(v float64) float64 { return jsmath.RoundTo(v, 2) }

func qtyForMessage(v float64) string {
	r := round2(v)
	if r == math.Trunc(r) {
		return JSNum(r)
	}
	return strconv.FormatFloat(r, 'f', 2, 64)
}

// ValidateVariantSplit is validateVariantSplit ("" error = valid rows).
func ValidateVariantSplit(actualQty float64, rows []VariantRow, activeSkuIDs []string) ([]VariantRow, string) {
	if len(rows) == 0 {
		return nil, "Rincian varian wajib diisi"
	}
	active := map[string]bool{}
	for _, id := range activeSkuIDs {
		active[id] = true
	}
	seen := map[string]bool{}
	var out []VariantRow
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
		out = append(out, VariantRow{r.PosSkuID, q})
		sum += q
	}
	sum = round2(sum)
	target := round2(actualQty)
	if math.Abs(sum-target) > 0.01 {
		return nil, "Rincian varian harus berjumlah sama dengan jumlah aktual (" + qtyForMessage(sum) + " vs " + qtyForMessage(target) + ")"
	}
	return out, ""
}

/* ── COGS estimate (cogs-estimate.ts) ────────────────────────────────── */

// MarginLabel is marginLabel.
func MarginLabel(pct *float64) any {
	switch {
	case pct == nil:
		return nil
	case *pct > 30:
		return "Healthy"
	case *pct > 15:
		return "Acceptable"
	}
	return "Thin"
}

// Round3 is Math.round(v * 1000) / 1000.
func Round3(v float64) float64 { return RoundQty(v) }

// Round2 is Math.round(v * 100) / 100.
func Round2(v float64) float64 { return round2(v) }
