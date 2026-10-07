package domain

import (
	"math"
	"strconv"
	"strings"
)

// JSNum formats a number like String(n) in JS.
func JSNum(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	abs := math.Abs(f)
	if abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(f, 'e', -1, 64)
		// Go writes e-07 / e+21; JS writes e-7 / e+21.
		mant, exp, _ := strings.Cut(s, "e")
		return mant + "e" + exp[:1] + strings.TrimLeft(exp[1:], "0")
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

func jsNum(f float64) string { return JSNum(f) }
