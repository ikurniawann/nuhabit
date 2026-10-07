package domain

import (
	"bytes"
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
)

// SalesTargetKey is SALES_TARGET_SETTING_KEY (lib/dashboard/sales-target.ts).
const SalesTargetKey = "sales_target_config"

// SalesTarget is SalesTargetConfig: daily and monthly revenue targets in
// rupiah, 0 when unset.
type SalesTarget struct {
	HarianRp  float64 `json:"harianRp"`
	BulananRp float64 `json:"bulananRp"`
}

// salesTargetCap is the 100 billion rupiah sanity ceiling.
const salesTargetCap = 100_000_000_000

var digitsOnly = regexp.MustCompile(`^[0-9]+$`)

// cleanAmount is cleanAmount: a number, or a string with only format
// separators ("Rp", dots, commas, spaces) around digits.
func cleanAmount(v any) (float64, bool) {
	var n float64
	switch x := v.(type) {
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return 0, false
		}
		n = f
	case float64:
		n = x
	case string:
		stripped := strings.Map(func(r rune) rune {
			if strings.ContainsRune("rRpP.,", r) || isJSSpace(r) {
				return -1
			}
			return r
		}, x)
		if !digitsOnly.MatchString(stripped) {
			return 0, false
		}
		n, _ = strconv.ParseFloat(stripped, 64)
	default:
		return 0, false
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > salesTargetCap {
		return 0, false
	}
	return jsmath.Round(n), true
}

// ParseSalesTarget is parseSalesTarget: the stored JSON, each field falling
// back to 0 on its own when missing or invalid.
func ParseSalesTarget(raw *string) SalesTarget {
	var out SalesTarget
	if raw == nil || *raw == "" {
		return out
	}
	dec := json.NewDecoder(bytes.NewReader([]byte(*raw)))
	dec.UseNumber()
	var obj map[string]any
	if dec.Decode(&obj) != nil {
		return out
	}
	if n, ok := cleanAmount(obj["harianRp"]); ok {
		out.HarianRp = n
	}
	if n, ok := cleanAmount(obj["bulananRp"]); ok {
		out.BulananRp = n
	}
	return out
}

// ApplySalesTargetInput is sanitizeSalesTargetInput merged over current:
// fields absent from body stay untouched; any sent field that does not
// clean rejects the whole input (ok false).
func ApplySalesTargetInput(current SalesTarget, body map[string]any) (SalesTarget, bool) {
	next := current
	for key, dst := range map[string]*float64{"harianRp": &next.HarianRp, "bulananRp": &next.BulananRp} {
		v, sent := body[key]
		if !sent {
			continue
		}
		n, ok := cleanAmount(v)
		if !ok {
			return current, false
		}
		*dst = n
	}
	return next, true
}
