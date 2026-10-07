// Package jsmath reproduces JavaScript number rounding for money and
// quantities ported from the TS routes.
//
// The Go spec lets the compiler fuse x*y+z into one fused multiply-add,
// which arm64 does, skipping the rounding of x*y that JavaScript performs.
// Math.round(10.555*100) is 1056 in JS but a fused floor(10.555*100+0.5)
// gives 1055. An explicit float64 conversion forces the rounding, so every
// helper here converts the product before using it. Write new money
// arithmetic the same way: float64(price*qty) + fee, not price*qty + fee.
package jsmath

import "math"

// Round is Math.round: the nearest integer, halves toward +Infinity,
// Math.round(-0.4) is -0, and NaN and ±Infinity pass through.
func Round(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	if r == 0 {
		return math.Copysign(0, x)
	}
	return r
}

// RoundTo is Math.round(x * 10**places) / 10**places, with the product
// rounded to float64 first as JavaScript does.
func RoundTo(x float64, places int) float64 {
	p := math.Pow10(places)
	return Round(float64(x*p)) / p
}
