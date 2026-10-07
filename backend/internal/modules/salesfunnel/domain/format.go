package domain

import (
	"math"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/jsmath"
)

// ToNumber is format.ts toNumber for a node-postgres value: Number(v),
// NaN and ±Inf as 0.
func ToNumber(v any) float64 {
	var f float64
	switch x := v.(type) {
	case float64:
		f = x
	case int64:
		f = float64(x)
	case int:
		f = float64(x)
	case string:
		f = JSNumber(x)
	}
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}

// FormatRupiah is formatRupiah: "Rp1.250.000", rounded to whole rupiah.
func FormatRupiah(v float64) string {
	n := jsmath.Round(v)
	if math.IsNaN(n) || math.IsInf(n, 0) {
		n = 0
	}
	sign := ""
	if n < 0 {
		sign, n = "-", -n
	}
	return sign + "Rp" + group(strconv.FormatFloat(n, 'f', 0, 64))
}

func group(intPart string) string {
	var b strings.Builder
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return b.String()
}

// FormatNumber is formatNumber (toLocaleString "id-ID" with at most
// maxFractionDigits decimals, half away from zero).
func FormatNumber(v float64, maxFractionDigits int) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		v = 0
	}
	scale := math.Pow10(maxFractionDigits)
	rounded := math.Round(float64(v*scale)) / scale
	sign := ""
	if rounded < 0 {
		sign, rounded = "-", -rounded
	}
	intPart, frac, _ := strings.Cut(strconv.FormatFloat(rounded, 'f', maxFractionDigits, 64), ".")
	frac = strings.TrimRight(frac, "0")
	out := sign + group(intPart)
	if frac != "" {
		out += "," + frac
	}
	return out
}

// JSNumberString is String(Number(x)) for a finite number.
func JSNumberString(x float64) string {
	if abs := math.Abs(x); x == 0 || (abs >= 1e-6 && abs < 1e21) {
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	mant, exp, _ := strings.Cut(strconv.FormatFloat(x, 'e', -1, 64), "e")
	sign, digits := exp[:1], strings.TrimLeft(exp[1:], "0")
	return mant + "e" + sign + digits
}

var (
	monthsLong = [...]string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}
	weekdays   = [...]string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}
)

// FormatDateLong is formatDateLong for a calendar date "YYYY-MM-DD":
// "Sabtu, 7 November 2026" (fallback when empty or invalid).
func FormatDateLong(date, fallback string) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return fallback
	}
	return weekdays[t.Weekday()] + ", " + strconv.Itoa(t.Day()) + " " + monthsLong[t.Month()-1] + " " + strconv.Itoa(t.Year())
}
