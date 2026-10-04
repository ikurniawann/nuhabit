package pdfgen

import (
	"math"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
)

// Thousands is Intl.NumberFormat("id-ID").format(v) and v.toLocaleString(
// "id-ID"): "." groups thousands, "," separates up to three decimals.
func Thousands(v float64) string {
	if math.IsNaN(v) {
		return "NaN"
	}
	s := strconv.FormatFloat(math.Abs(v), 'f', 3, 64)
	whole, frac, _ := strings.Cut(s, ".")
	frac = strings.TrimRight(frac, "0")
	var b strings.Builder
	if v < 0 && (whole != "0" || frac != "") {
		b.WriteByte('-')
	}
	for i, c := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	if frac != "" {
		b.WriteString("," + frac)
	}
	return b.String()
}

// Rupiah is formatRupiah in lib/format.ts: "Rp1.250.000", "-Rp5.000",
// rounded with Math.round.
func Rupiah(v float64) string {
	n := jsmath.Round(v)
	sign := ""
	if n < 0 {
		sign = "-"
	}
	return sign + "Rp" + Thousands(math.Abs(n))
}

// RupiahSpaced is the payslip's rupiah(): "Rp 1.250.000", "Rp -5.000".
func RupiahSpaced(v float64) string {
	if math.IsNaN(v) {
		v = 0
	}
	return "Rp " + Thousands(jsmath.Round(v))
}

var satuan = []string{"", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"}

func terbilang(n int64) string {
	join := func(a, b string) string { return strings.TrimSpace(a + " " + b) }
	switch {
	case n < 12:
		return satuan[n]
	case n < 20:
		return terbilang(n-10) + " belas"
	case n < 100:
		return join(terbilang(n/10)+" puluh", terbilang(n%10))
	case n < 200:
		return join("seratus", terbilang(n-100))
	case n < 1000:
		return join(terbilang(n/100)+" ratus", terbilang(n%100))
	case n < 2000:
		return join("seribu", terbilang(n-1000))
	case n < 1_000_000:
		return join(terbilang(n/1000)+" ribu", terbilang(n%1000))
	case n < 1_000_000_000:
		return join(terbilang(n/1_000_000)+" juta", terbilang(n%1_000_000))
	case n < 1_000_000_000_000:
		return join(terbilang(n/1_000_000_000)+" miliar", terbilang(n%1_000_000_000))
	}
	return join(terbilang(n/1_000_000_000_000)+" triliun", terbilang(n%1_000_000_000_000))
}

// Terbilang is terbilangRupiah in lib/hris/terbilang.ts: 4500000 is "empat
// juta lima ratus ribu rupiah"; fractions are dropped, zero, negative and
// non-finite amounts are "nol rupiah".
func Terbilang(amount float64) string {
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return "nol rupiah"
	}
	return strings.Join(strings.Fields(terbilang(int64(amount))), " ") + " rupiah"
}
