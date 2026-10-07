package domain

import "time"

// Jakarta is the calendar of preorder_until dates.
var Jakarta = mustLoad("Asia/Jakarta")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}

// PreorderOpen reports whether a product with zero stock still sells as a
// pre-order: preorder_until is set and today (Jakarta) is not past it.
func PreorderOpen(stock float64, until *time.Time, now time.Time) bool {
	if stock > 0 || until == nil {
		return false
	}
	today := now.In(Jakarta)
	y, m, d := today.Date()
	uy, um, ud := until.In(Jakarta).Date()
	return time.Date(uy, um, ud, 0, 0, 0, 0, Jakarta).Sub(time.Date(y, m, d, 0, 0, 0, 0, Jakarta)) >= 0
}

// DateString is the YYYY-MM-DD form of a date column (nil stays nil).
func DateString(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format("2006-01-02")
	return &s
}
