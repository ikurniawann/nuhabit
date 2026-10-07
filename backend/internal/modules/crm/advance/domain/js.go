// Package domain holds the pure rules of the CRM advance area: workflow
// conditions, templates and triggers, lead scoring, approval steps and the
// JavaScript value semantics the TypeScript implementation relied on.
//
// Values follow what JSON.parse and node-postgres produce, converted by the
// caller: nil (null), Undefined, string, float64, bool, time.Time,
// []any and map[string]any.
package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"
)

// undefined is JavaScript's undefined (a missing key), distinct from null.
type undefined struct{}

// Undefined is the value of a missing key.
var Undefined any = undefined{}

// IsNullish reports v === null || v === undefined.
func IsNullish(v any) bool { return v == nil || v == Undefined }

// Lookup is record[key]: Undefined when the key is absent.
func Lookup(m map[string]any, key string) any {
	if v, ok := m[key]; ok {
		return v
	}
	return Undefined
}

// FormatJSNumber is Number.prototype.toString (JSON.stringify for finite
// numbers).
func FormatJSNumber(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	}
	b, _ := json.Marshal(f)
	return string(b)
}

// Jakarta is Asia/Jakarta, the zone the TypeScript server runs in.
var Jakarta = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}()

// JSString is String(v).
func JSString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case undefined:
		return "undefined"
	case string:
		return x
	case float64:
		return FormatJSNumber(x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	case time.Time:
		// Date.prototype.toString on a server running in Asia/Jakarta.
		return x.In(Jakarta).Format("Mon Jan 02 2006 15:04:05") + " GMT+0700 (Western Indonesia Time)"
	case []any:
		parts := make([]string, len(x))
		for i, e := range x {
			if !IsNullish(e) {
				parts[i] = JSString(e)
			}
		}
		return strings.Join(parts, ",")
	case map[string]any:
		return "[object Object]"
	}
	return ""
}

var (
	decimalLiteral = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)
	radixLiteral   = regexp.MustCompile(`^0([xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)$`)
)

// JSNumber is Number(v).
func JSNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case undefined:
		return math.NaN()
	case float64:
		return x
	case bool:
		if x {
			return 1
		}
		return 0
	case time.Time:
		return float64(x.UnixMilli())
	case string:
		return stringToNumber(x)
	case []any:
		return stringToNumber(JSString(x))
	}
	return math.NaN()
}

func stringToNumber(s string) float64 {
	s = JSTrim(s)
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if radixLiteral.MatchString(s) {
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]
		f := 0.0
		for _, c := range s[2:] {
			d, _ := strconv.ParseInt(string(c), base, 64)
			f = f*float64(base) + float64(d)
		}
		return f
	}
	if !decimalLiteral.MatchString(s) {
		return math.NaN()
	}
	f, _ := strconv.ParseFloat(s, 64) // out of range yields ±Inf like JS
	return f
}

// JSTrim is String.prototype.trim.
func JSTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF })
}

// SliceUTF16 is s.slice(0, n): n counts UTF-16 code units.
func SliceUTF16(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}

// FormatNumber mirrors formatNumber (toLocaleString "id-ID"): "." groups
// thousands, "," separates decimals, at most maxFractionDigits decimals
// rounded half away from zero.
func FormatNumber(v float64, maxFractionDigits int) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		v = 0
	}
	scale := math.Pow(10, float64(maxFractionDigits))
	rounded := math.Round(v*scale) / scale
	sign := ""
	if rounded < 0 {
		sign, rounded = "-", -rounded
	}
	intPart, frac, _ := strings.Cut(strconv.FormatFloat(rounded, 'f', maxFractionDigits, 64), ".")
	frac = strings.TrimRight(frac, "0")
	var b strings.Builder
	b.WriteString(sign)
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	if frac != "" {
		b.WriteByte(',')
		b.WriteString(frac)
	}
	return b.String()
}

// EncodeURIComponent is encodeURIComponent.
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

// NormalizePhone mirrors normalizePhone in lib/sales-funnel/server.ts:
// digits only, 0812/812 become 62812.
func NormalizePhone(raw string) string {
	var b strings.Builder
	for _, c := range raw {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	digits := b.String()
	switch {
	case strings.HasPrefix(digits, "0"):
		return "62" + digits[1:]
	case strings.HasPrefix(digits, "8"):
		return "62" + digits
	}
	return digits
}

// IsValidNormalizedPhone mirrors isValidNormalizedPhone.
func IsValidNormalizedPhone(phone string) bool {
	return len(phone) >= 10 && strings.HasPrefix(phone, "62")
}
