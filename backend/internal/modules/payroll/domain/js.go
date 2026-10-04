// Package domain holds the payroll rules as pure Go: the calculator, the
// rate configuration, period arithmetic, loans, run lifecycle, KPI and
// feedback math. Ported from frontend/src/lib/payroll, lib/kpi and lib/hris.
// Numbers are float64 because the TS computes with JS numbers.
package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// Round is JS Math.round: halves go toward +Infinity.
func Round(x float64) float64 { return math.Floor(x + 0.5) }

// JSNumber is JS Number(value) for database text and decoded JSON: nil
// (null) is 0, strings parse as JS numeric literals ("" is 0), booleans
// are 0/1, a one-element array converts through its string form, anything
// else is NaN.
func JSNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case json.Number:
		return jsStringNumber(x.String())
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		return jsStringNumber(x)
	case []any:
		switch len(x) {
		case 0:
			return 0
		case 1: // Number([e]) is Number(String(e))
			switch x[0].(type) {
			case bool, map[string]any:
				return math.NaN()
			}
			return JSNumber(x[0])
		}
	}
	return math.NaN()
}

var decimalLiteral = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)

func jsStringNumber(s string) float64 {
	s = strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == '\uFEFF' })
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(s) > 2 && s[0] == '0' {
		if base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]; base != 0 {
			if n, err := strconv.ParseUint(s[2:], base, 64); err == nil {
				return float64(n)
			}
			return math.NaN()
		}
	}
	if !decimalLiteral.MatchString(s) {
		return math.NaN()
	}
	f, _ := strconv.ParseFloat(s, 64)
	return f
}

// Finite reports Number.isFinite.
func Finite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }

// OrZero is `Number(v) || 0`.
func OrZero(v any) float64 {
	n := JSNumber(v)
	if math.IsNaN(n) {
		return 0
	}
	return n
}

// groupThousands formats a non-negative integer with "." separators
// (toLocaleString("id-ID") for whole numbers).
func groupThousands(n int64) string {
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

// FormatRupiah is formatRupiah in lib/format.ts: "Rp1.500.000".
func FormatRupiah(v float64) string {
	n := Round(v)
	sign := ""
	if n < 0 {
		sign = "-"
	}
	return sign + "Rp" + groupThousands(int64(math.Abs(n)))
}

// EncodeURIComponent is the JS global of the same name.
func EncodeURIComponent(s string) string {
	const unreserved = "-_.!~*'()"
	var b strings.Builder
	for _, c := range []byte(s) {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte(unreserved, c) >= 0 {
			b.WriteByte(c)
			continue
		}
		b.WriteString("%" + strings.ToUpper(strconv.FormatInt(int64(c)>>4, 16)) + strings.ToUpper(strconv.FormatInt(int64(c)&15, 16)))
	}
	return b.String()
}

// BuildWaLink is buildWaLink in lib/recruitment/wa.ts: wa.me link from a
// local Indonesian number, nil when the number has no digits.
func BuildWaLink(phone *string, message string) *string {
	var digits strings.Builder
	if phone != nil {
		for _, c := range *phone {
			if c >= '0' && c <= '9' {
				digits.WriteRune(c)
			}
		}
	}
	d := digits.String()
	if d == "" {
		return nil
	}
	if strings.HasPrefix(d, "0") {
		d = "62" + d[1:]
	}
	link := "https://wa.me/" + d + "?text=" + EncodeURIComponent(message)
	return &link
}
