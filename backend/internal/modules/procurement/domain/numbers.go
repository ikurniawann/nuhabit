package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// MaxNumeric152 is the largest numeric(15,2).
const MaxNumeric152 = 9_999_999_999_999.99

// MaxInt4 is the largest PostgreSQL integer.
const MaxInt4 = 2_147_483_647

// JSRound is Math.round: halves round toward +Infinity.
func JSRound(x float64) float64 { return math.Floor(x + 0.5) }

// RoundMoney rounds to cents (roundMoney / roundAmount).
func RoundMoney(v float64) float64 { return JSRound(v*100) / 100 }

// ClampMoney rounds to cents and clamps into [0, MaxNumeric152].
func ClampMoney(v float64) float64 {
	r := RoundMoney(v)
	switch {
	case r < 0:
		return 0
	case r > MaxNumeric152:
		return MaxNumeric152
	}
	return r
}

// NormalizePrQty rounds a PR quantity into [1, MaxInt4].
func NormalizePrQty(v float64) float64 {
	r := JSRound(v)
	if math.IsNaN(r) || math.IsInf(r, 0) || r < 1 {
		return 1
	}
	return math.Min(r, MaxInt4)
}

var nonNumeric = regexp.MustCompile(`[^\d.,]`)

// ParseLocaleNumber is parseLocaleNumber: Indonesian-formatted input
// ("1.500.000,50") or a PostgreSQL numeric string ("287985.600000"). ok is
// false where the TS returns undefined.
func ParseLocaleNumber(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, !math.IsInf(x, 0) && !math.IsNaN(x)
	case json.Number:
		f, err := x.Float64()
		return f, err == nil && !math.IsInf(f, 0)
	case string:
		return parseLocaleString(x)
	}
	return 0, false
}

func parseLocaleString(value string) (float64, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, false
	}
	negative := strings.HasPrefix(trimmed, "-")
	if negative {
		trimmed = trimmed[1:]
	}
	raw := nonNumeric.ReplaceAllString(trimmed, "")
	if raw == "" {
		return 0, false
	}
	var normalized string
	switch {
	case strings.Contains(raw, ","):
		normalized = strings.Replace(strings.ReplaceAll(raw, ".", ""), ",", ".", 1)
	case strings.Count(raw, ".") > 1:
		normalized = strings.ReplaceAll(raw, ".", "")
	case strings.Count(raw, ".") == 1:
		left, right, _ := strings.Cut(raw, ".")
		if len(right) == 3 && len(left) <= 3 {
			normalized = left + right
		} else {
			normalized = left + "." + right
		}
	default:
		normalized = raw
	}
	if negative {
		normalized = "-" + normalized
	}
	// Number("1.") and Number(".5") are valid in JS; ParseFloat accepts both.
	f, err := strconv.ParseFloat(normalized, 64)
	if err != nil || math.IsInf(f, 0) {
		return 0, false
	}
	return f, true
}
