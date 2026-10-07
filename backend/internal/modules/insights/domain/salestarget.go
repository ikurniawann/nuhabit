package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"

	"nuhabit/backend/internal/platform/jsmath"
)

// SalesTargetSettingKey is SALES_TARGET_SETTING_KEY in configuration.app_settings.
const SalesTargetSettingKey = "sales_target_config"

// SalesTarget is the omzet target (lib/dashboard/sales-target.ts); 0 means unset.
type SalesTarget struct {
	HarianRp  float64 `json:"harianRp"`
	BulananRp float64 `json:"bulananRp"`
}

var (
	amountNoise  = regexp.MustCompile(`(?i)[rp` + jsSpace + `.,]`)
	amountDigits = regexp.MustCompile(`^\d+$`)
)

// cleanAmount accepts a number or a formatted rupiah string; negatives,
// junk and anything above Rp 100 M are rejected.
func cleanAmount(raw json.RawMessage) (float64, bool) {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return 0, false
	}
	var n float64
	switch x := v.(type) {
	case float64:
		n = x
	case string:
		stripped := amountNoise.ReplaceAllString(x, "")
		if !amountDigits.MatchString(stripped) {
			return 0, false
		}
		f, err := strconv.ParseFloat(stripped, 64)
		if err != nil {
			return 0, false
		}
		n = f
	default:
		return 0, false
	}
	if math.IsInf(n, 0) || math.IsNaN(n) || n < 0 || n > 100_000_000_000 {
		return 0, false
	}
	return jsmath.Round(n), true
}

// ParseSalesTarget reads the stored JSON; missing or broken fields are 0.
func ParseSalesTarget(raw *string) SalesTarget {
	var out SalesTarget
	if raw == nil || *raw == "" {
		return out
	}
	var o map[string]json.RawMessage
	if json.Unmarshal([]byte(*raw), &o) != nil {
		return out
	}
	if n, ok := cleanAmount(o["harianRp"]); ok {
		out.HarianRp = n
	}
	if n, ok := cleanAmount(o["bulananRp"]); ok {
		out.BulananRp = n
	}
	return out
}
