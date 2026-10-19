package domain

import (
	"regexp"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
)

// The WIP material code and the COGS estimate helpers
// (lib/purchasing/cogs-estimate.ts). The production order rules live in
// the production module.

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

func round2(v float64) float64 { return jsmath.RoundTo(v, 2) }

// Round2 is Math.round(v * 100) / 100.
func Round2(v float64) float64 { return round2(v) }
