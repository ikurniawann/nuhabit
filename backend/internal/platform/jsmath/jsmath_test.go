package jsmath

import (
	"math"
	"testing"
)

// Expected values come from Node: Math.round(x) and Math.round(x*10**n)/10**n.
func TestRound(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{0.5, 1}, {1.5, 2}, {2.5, 3}, {-0.5, 0}, {-1.5, -1}, {-2.5, -2},
		{0.49999999999999994, 0}, {4503599627370497, 4503599627370497},
	}
	for _, c := range cases {
		if got := Round(c.in); got != c.want {
			t.Errorf("Round(%v) = %v, want %v", c.in, got, c.want)
		}
	}
	if got := Round(-0.4); got != 0 || !math.Signbit(got) {
		t.Errorf("Round(-0.4) = %v, want -0", got)
	}
	if !math.IsNaN(Round(math.NaN())) || !math.IsInf(Round(math.Inf(1)), 1) {
		t.Error("NaN and Inf pass through")
	}
}

func TestRoundTo(t *testing.T) {
	cases := []struct {
		in     float64
		places int
		want   float64
	}{
		{10.555, 2, 10.56}, // 10.555*100 is 1055.5 in float64; fused it would be 1055.4999…
		{1.005, 2, 1},      // 1.005*100 is 100.49999999999999
		{2.345, 2, 2.35},
		{0.1 + 0.2, 1, 0.3},
		{1234.5678, 3, 1234.568},
		{-1.005, 2, -1},
	}
	for _, c := range cases {
		if got := RoundTo(c.in, c.places); got != c.want {
			t.Errorf("RoundTo(%v, %d) = %v, want %v", c.in, c.places, got, c.want)
		}
	}
}
