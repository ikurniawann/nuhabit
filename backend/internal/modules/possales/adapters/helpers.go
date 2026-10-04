package adapters

import (
	"math"
	"strconv"
	"strings"
)

// nullable maps "" to SQL NULL.
func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// round2 is Math.round(n * 100) / 100.
func round2(n float64) float64 { return math.Floor(n*100+0.5) / 100 }

// localeID is Number.prototype.toLocaleString("id-ID") with its default
// options: "." grouping, "," decimals, at most three fraction digits.
func localeID(n float64) string {
	s := strconv.FormatFloat(math.Abs(n), 'f', 3, 64)
	whole, frac, _ := strings.Cut(s, ".")
	frac = strings.TrimRight(frac, "0")
	var b strings.Builder
	if n < 0 && (whole != "0" || frac != "") {
		b.WriteByte('-')
	}
	head := len(whole) % 3
	if head == 0 {
		head = 3
	}
	b.WriteString(whole[:head])
	for i := head; i < len(whole); i += 3 {
		b.WriteByte('.')
		b.WriteString(whole[i : i+3])
	}
	if frac != "" {
		b.WriteByte(',')
		b.WriteString(frac)
	}
	return b.String()
}
