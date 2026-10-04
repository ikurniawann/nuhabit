package kit

import (
	"math"
	"strconv"
	"strings"
)

// JSRound is Math.round: halves round toward +Infinity.
func JSRound(v float64) float64 { return math.Floor(v + 0.5) }

// FormatRupiah mirrors formatRupiah in lib/format.ts ("Rp1.234.567", id-ID
// grouping, rounded to whole rupiah).
func FormatRupiah(v float64) string {
	n := int64(JSRound(v))
	sign := ""
	if n < 0 {
		sign = "-"
		n = -n
	}
	return sign + "Rp" + GroupThousands(n)
}

// GroupThousands formats n with "." thousands separators (id-ID).
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
