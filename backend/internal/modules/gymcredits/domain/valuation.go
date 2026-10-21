package domain

import "math"

// Lot valuation in sen. A lot's deferred revenue is an integer number of
// sen; every move of credits is valued as the difference of two cumulative
// shares, so the journals of a lot add up to its value exactly when the last
// credit leaves it (used, expired, refunded or transferred). Three credits
// bought for 100,000 post 33,333.33, 33,333.34 and 33,333.33.

// LotValueSen converts a purchase total in rupiah to sen.
func LotValueSen(totalIdr float64) int64 {
	if totalIdr <= 0 {
		return 0
	}
	return int64(math.Round(totalIdr * 100))
}

// CumulativeSen is the value of the first used credits of a lot of
// lotCredits credits worth valueSen: the lot's share rounded to the sen,
// the whole value once every credit is used.
func CumulativeSen(valueSen int64, lotCredits, used int) int64 {
	switch {
	case lotCredits <= 0 || valueSen <= 0 || used <= 0:
		return 0
	case used >= lotCredits:
		return valueSen
	}
	return int64(math.Round(float64(valueSen) * float64(used) / float64(lotCredits)))
}

// MoveValueSen values a move of amount credits (negative leaves the lot,
// positive comes back) when usedBefore credits had already left it.
func MoveValueSen(valueSen int64, lotCredits, usedBefore, amount int) int64 {
	before := CumulativeSen(valueSen, lotCredits, usedBefore)
	after := CumulativeSen(valueSen, lotCredits, usedBefore-amount)
	if after >= before {
		return after - before
	}
	return before - after
}

// SenToIdr is sen as rupiah with two decimals.
func SenToIdr(sen int64) float64 { return float64(sen) / 100 }

// UnusedValueSen is the deferred revenue left in a lot after used credits.
func UnusedValueSen(valueSen int64, lotCredits, used int) int64 {
	return valueSen - CumulativeSen(valueSen, lotCredits, used)
}

// UsedIn is how many credits have left lotID so far (0 when unknown).
func UsedIn(remainders []LotRemainder, lotID string) int {
	for _, r := range remainders {
		if r.Lot.ID == lotID {
			return r.Lot.Credits - r.Remaining
		}
	}
	return 0
}
