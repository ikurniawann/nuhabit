package domain

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

/* ── chart of accounts defaults (lib/purchasing/raw-material-coa.ts) ─── */

var coaNoise = regexp.MustCompile(`[\s\-_.]`)
var sevenDigits = regexp.MustCompile(`^\d{7}$`)

// NormalizeCoaAccountCode is normalizeCoaAccountCode: "1 3 01 001" →
// "1301001"; anything but 7 digits is "".
func NormalizeCoaAccountCode(raw string) string {
	d := coaNoise.ReplaceAllString(strings.TrimSpace(raw), "")
	if !sevenDigits.MatchString(d) {
		return ""
	}
	return d
}

var marketCategoryAsset = map[string]string{
	"st dry goods": "1301001", "st dairy & eggs": "1301002", "st dairy and eggs": "1301002",
	"st sauce, syrup & condiment": "1301003", "st sauce syrup & condiment": "1301003",
	"st frozen ingredients": "1301004", "st rtd": "1301005", "st koh wip": "1301006", "st foh wip": "1301007",
	"st other": "1301008", "st protein": "1301008", "fruit & vegetable": "1301008",
	"fruit and vegetable": "1301008", "fruit and vegetables": "1301008",
	"production supplies": "6201001", "production fuel": "6201005",
}

var systemCategoryAsset = map[string]string{
	"KERING": "1301001", "BUMBU": "1301001", "BAKERY": "1301001", "OIL": "1301001", "DAIRY": "1301002",
	"SAUS": "1301003", "MINUMAN": "1301003", "BEKU": "1301004", "DAGING": "1301008", "SEAFOOD": "1301008",
	"PROTEIN": "1301008", "SAYUR": "1301008", "LAIN": "1301008", "NONPANG": "6201001", "KEMASAN": "6201001",
	"BAKAR": "6201005",
}

var systemCategoryProduction = map[string]string{
	"KERING": "5101001", "BUMBU": "5101001", "BAKERY": "5101001", "OIL": "5101001", "DAIRY": "5101001",
	"SAUS": "5101001", "BEKU": "5101001", "DAGING": "5101001", "SEAFOOD": "5101001", "PROTEIN": "5101001",
	"SAYUR": "5101003", "MINUMAN": "5201001", "LAIN": "5101001", "NONPANG": "6201001", "KEMASAN": "6201001",
	"BAKAR": "6201005",
}

var underscoreSlash = regexp.MustCompile(`[_/]+`)
var spaces = regexp.MustCompile(`\s+`)

// DefaultCoa is resolveDefaultCoaForCategory's account codes ("" = null).
func DefaultCoa(kategori string) (asset, production string) {
	raw := strings.TrimSpace(kategori)
	upper := strings.ToUpper(raw)
	key := spaces.ReplaceAllString(underscoreSlash.ReplaceAllString(strings.ToLower(raw), " "), " ")
	asset = systemCategoryAsset[upper]
	if asset == "" {
		asset = marketCategoryAsset[key]
	}
	if asset == "" && (strings.Contains(upper, "WIP") || strings.Contains(key, "wip")) {
		asset = "1301006"
	}
	production = systemCategoryProduction[upper]
	if production == "" {
		switch {
		case asset == "1301008" && strings.Contains(key, "fruit"):
			production = "5101003"
		case strings.HasPrefix(asset, "13"):
			production = "5101001"
		case strings.HasPrefix(asset, "62"):
			production = asset
		}
	}
	if strings.Contains(key, "fruit") && systemCategoryProduction[upper] == "" {
		production = "5101003"
	}
	if asset == "1301006" || asset == "1301007" {
		production = "5101001"
	}
	if asset == "1301005" {
		production = "5201001"
	}
	return asset, production
}

// LegacyCoaEnum is deriveLegacyCoaEnum ("" = null).
func LegacyCoaEnum(production, rnd, asset string) string {
	switch {
	case production != "":
		return "PRODUCTION"
	case rnd != "":
		return "RND"
	case asset != "":
		return "ASSET"
	}
	return ""
}

/* ── unit conversions (raw-material-api-rules.ts) ─────────────────────── */

// PlannedConversion is one conversion row to write. Has* mark the
// attributes the payload sent (they are written only then on update).
type PlannedConversion struct {
	SatuanID          string
	QtyInBaseUnit     any // number, or the master's konversi_factor as text
	IsBase            bool
	IsPurchaseDefault *bool
	IsIssueDefault    *bool
	HasBarcode        bool
	Barcode           *string
}

// PlanUnitConversions is planUnitConversions: satuan kecil (base), satuan
// besar (× konversi, or base without a small unit), then the payload packs;
// the legacy units win over a pack for the same unit, pack attributes stay.
// konversi is the stored konversi_factor (text or number), nil when NULL.
func PlanUnitConversions(besar, kecil *string, konversi any, packs []PlannedConversion) []PlannedConversion {
	var all []PlannedConversion
	if kecil != nil && *kecil != "" {
		all = append(all, PlannedConversion{SatuanID: *kecil, QtyInBaseUnit: 1.0, IsBase: true})
	}
	if besar != nil && *besar != "" {
		qty := any(1.0)
		if kecil != nil && *kecil != "" {
			qty = jsOr(konversi, 1.0)
		}
		all = append(all, PlannedConversion{SatuanID: *besar, QtyInBaseUnit: qty, IsBase: kecil == nil || *kecil == ""})
	}
	all = append(all, packs...)
	var order []string
	byUnit := map[string]PlannedConversion{}
	for _, c := range all {
		existing, ok := byUnit[c.SatuanID]
		if !ok {
			order = append(order, c.SatuanID)
			byUnit[c.SatuanID] = c
			continue
		}
		// { ...conversion, ...existing }: existing values win, keys the new
		// one has but the existing lacks are kept.
		merged := existing
		if merged.IsPurchaseDefault == nil {
			merged.IsPurchaseDefault = c.IsPurchaseDefault
		}
		if merged.IsIssueDefault == nil {
			merged.IsIssueDefault = c.IsIssueDefault
		}
		if !merged.HasBarcode && c.HasBarcode {
			merged.HasBarcode, merged.Barcode = true, c.Barcode
		}
		byUnit[c.SatuanID] = merged
	}
	out := make([]PlannedConversion, len(order))
	for i, id := range order {
		out[i] = byUnit[id]
	}
	return out
}

// jsOr is `value || def` for a numeric-ish value (0, "", null → def).
func jsOr(v any, def float64) any {
	switch x := v.(type) {
	case nil:
		return def
	case string:
		if x == "" {
			return def
		}
		return x
	case float64:
		if x == 0 || math.IsNaN(x) {
			return def
		}
	}
	return v
}

// PackDefaultFlagsToReset is packDefaultFlagsToReset: the default flags the
// payload sets, or a rejection when one is set on more than one pack.
func PackDefaultFlagsToReset(packs []PlannedConversion) ([]string, error) {
	var out []string
	for _, key := range []string{"is_purchase_default", "is_issue_default"} {
		n := 0
		for _, p := range packs {
			v := p.IsPurchaseDefault
			if key == "is_issue_default" {
				v = p.IsIssueDefault
			}
			if v != nil && *v {
				n++
			}
		}
		if n > 1 {
			return nil, Rejection("Hanya satu pack yang boleh menjadi bawaan pembelian/pengeluaran")
		}
		if n == 1 {
			out = append(out, key)
		}
	}
	return out, nil
}

// StockStatusSummary is summarizeStockStatus.
type StockStatusSummary struct {
	Total   int `json:"total"`
	Aman    int `json:"aman"`
	Menipis int `json:"menipis"`
	Habis   int `json:"habis"`
}

// SummarizeStockStatus counts statuses; empty counts as AMAN.
func SummarizeStockStatus(statuses []string) StockStatusSummary {
	var s StockStatusSummary
	for _, st := range statuses {
		s.Total++
		switch st {
		case "MENIPIS":
			s.Menipis++
		case "HABIS":
			s.Habis++
		default:
			s.Aman++
		}
	}
	return s
}

// PurchaseCostSummary is summarizePurchaseCosts.
type PurchaseCostSummary struct {
	Months        float64  `json:"months"`
	PurchaseCount int      `json:"purchase_count"`
	LastCost      *float64 `json:"last_cost"`
	MinCost       *float64 `json:"min_cost"`
	MaxCost       *float64 `json:"max_cost"`
	AvgCost       *float64 `json:"avg_cost"`
}

// SummarizePurchaseCosts summarizes costs ordered newest first.
func SummarizePurchaseCosts(costs []float64, months float64) PurchaseCostSummary {
	s := PurchaseCostSummary{Months: months, PurchaseCount: len(costs)}
	if len(costs) == 0 {
		return s
	}
	minV, maxV, sum := costs[0], costs[0], 0.0
	for _, c := range costs {
		minV, maxV, sum = math.Min(minV, c), math.Max(maxV, c), sum+c
	}
	avg := sum / float64(len(costs))
	s.LastCost, s.MinCost, s.MaxCost, s.AvgCost = &costs[0], &minV, &maxV, &avg
	return s
}

/* ── products (product-hpp-review.ts, pos/kitchen-station.ts) ────────── */

// HppReview is buildProductHppReview.
type HppReview struct {
	HargaModal, HppEstimasi, HppTersimpan, HppResep, HppSelisih float64
	PerluReview                                                 bool
}

// BuildHppReview compares the stored cost with the recipe estimate.
func BuildHppReview(hargaModal, hppEstimasi, totalBahan float64) HppReview {
	r := HppReview{HargaModal: hargaModal, HppEstimasi: hppEstimasi}
	r.HppTersimpan = math.Floor(hargaModal + 0.5)
	r.HppResep = math.Floor(hppEstimasi + 0.5)
	r.HppSelisih = r.HppResep - r.HppTersimpan
	r.PerluReview = totalBahan > 0 && r.HppResep > 0 && math.Abs(r.HppSelisih) >= 1
	return r
}

// PosStations are the KDS stations.
var PosStations = []string{"kitchen", "bar", "bakery", "dessert", "merchandise", "photobooth"}

var barWords = regexp.MustCompile(`kopi|coffee|tea|teh|minuman|drink|juice|jus|soda|es|latte|cappuccino|mocktail|milkshake|bar`)
var bakeryWords = regexp.MustCompile(`roti|bread|pastry|cake|kue|croissant|donut|dessert|ice cream|gelato|bakery`)

// ResolvePosStation is resolvePosStation.
func ResolvePosStation(explicit, kategori string) string {
	lower := strings.ToLower(strings.TrimSpace(explicit))
	if slices.Contains(PosStations, lower) {
		return lower
	}
	hay := strings.ToLower(kategori + " ")
	switch {
	case barWords.MatchString(hay):
		return "bar"
	case bakeryWords.MatchString(hay):
		return "bakery"
	}
	return "kitchen"
}

/* ── codes and money ─────────────────────────────────────────────────── */

var trailingSeq = regexp.MustCompile(`-(\d+)$`)

// NextSequentialCode is nextSequentialCode: prefix-NNN after lastCode.
func NextSequentialCode(prefix, lastCode string, pad int) string {
	seq := 1
	if m := trailingSeq.FindStringSubmatch(lastCode); m != nil {
		if n, err := strconv.Atoi(m[1]); err == nil {
			seq = n + 1
		}
	}
	return fmt.Sprintf("%s-%0*d", prefix, pad, seq)
}

// FormatRupiah is formatRupiah: "Rp1.234.567" (id-ID grouping, rounded).
func FormatRupiah(v float64) string {
	n := math.Floor(v + 0.5)
	sign := ""
	if n < 0 {
		sign, n = "-", -n
	}
	digits := strconv.FormatFloat(n, 'f', 0, 64)
	var b strings.Builder
	for i, c := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return sign + "Rp" + b.String()
}

/* ── BOM costing (lib/purchasing/bom-cost.ts) ───────────────────────── */

// SmallUnitCost is normalizeToSmallUnit: the master cost per satuan besar
// divided by konversi when the material has a small unit.
func SmallUnitCost(cost, konversi float64, hasSmallUnit bool) float64 {
	if hasSmallUnit && konversi > 0 {
		return cost / konversi
	}
	return cost
}

// QtyWithWaste is qty × (1 + waste).
func QtyWithWaste(qty, waste float64) float64 { return qty * (1 + waste) }
