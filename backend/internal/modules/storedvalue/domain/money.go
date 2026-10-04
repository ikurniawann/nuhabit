// Package domain holds the pure stored-value rules: the ARK Coin wallet
// ledger and its corrections, top-up packages, member bills, card unlink and
// refund requests, gift cards and promo codes. No database, no HTTP.
package domain

import (
	"math"
	"strconv"
	"strings"
)

// JSRound is Math.round: halves round towards +Infinity.
func JSRound(v float64) float64 { return math.Floor(v + 0.5) }

// RoundIdr rounds to 2 decimals (numeric(12,2) columns), like
// Math.round(v * 100) / 100.
func RoundIdr(v float64) float64 { return JSRound(v*100) / 100 }

// FormatRupiah mirrors formatRupiah in lib/format.ts: "Rp10.000",
// "-Rp1.500", rounded to whole rupiah.
func FormatRupiah(v float64) string {
	n := int64(JSRound(v))
	sign := ""
	if n < 0 {
		sign = "-"
		n = -n
	}
	return sign + "Rp" + GroupThousands(n)
}

// GroupThousands is toLocaleString("id-ID") of a non-negative integer.
func GroupThousands(n int64) string {
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return b.String()
}

// ToNumber is `Number(v)` for a decoded JSON or SQL value, with NaN and
// non-finite results mapped to 0 (the `Number(v) || 0` idiom).
func ToNumber(v any) float64 {
	var f float64
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		f = x
	case float32:
		f = float64(x)
	case int:
		f = float64(x)
	case int32:
		f = float64(x)
	case int64:
		f = float64(x)
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		t := strings.TrimSpace(x)
		if t == "" {
			return 0
		}
		p, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return 0
		}
		f = p
	case interface{ String() string }:
		return ToNumber(x.String())
	default:
		return 0
	}
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}

// JSString is `String(v ?? "")` for a decoded JSON value (numbers in their
// shortest JS form).
func JSString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return JSNumber(x)
	}
	return ""
}

// JSNumber prints a float the way String(number) does for the values money
// code produces (integers without a decimal point).
func JSNumber(v float64) string {
	if v == math.Trunc(v) && math.Abs(v) < 1e21 {
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return strconv.FormatFloat(v, 'g', -1, 64)
}
