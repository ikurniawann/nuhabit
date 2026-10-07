package domain

import (
	"math"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/jsmath"
)

// Wholesale rules: partner pricing, order minimums, payment terms and the
// login brake.

const (
	// WholesaleSessionCookie is the httpOnly cookie of a partner session.
	WholesaleSessionCookie = "nh_wholesale"
	// WholesaleSessionTTL is how long a partner stays signed in.
	WholesaleSessionTTL = 30 * 24 * time.Hour
	// PayLaterDays is the due date of a pay_later order, counted from
	// placement.
	PayLaterDays = 30

	// WholesaleLoginWindow and the two limits brake credential guessing;
	// only failed attempts count.
	WholesaleLoginWindow     = 15 * time.Minute
	WholesaleLoginEmailLimit = 5
	WholesaleLoginIPLimit    = 20
)

// PaymentTerms are the accepted wholesale_accounts.payment_terms values.
var PaymentTerms = []string{"invoice", "pay_later"}

// WholesaleUnitPrice is the partner price of one unit: the product's
// wholesale price when set, else the retail price minus the account's
// discount, rounded to whole rupiah.
func WholesaleUnitPrice(retail float64, override *float64, discountPct float64) float64 {
	if override != nil {
		return math.Max(0, *override)
	}
	pct := math.Min(100, math.Max(0, discountPct))
	return math.Max(0, jsmath.Round(float64(retail*(100-pct))/100))
}

// WholesaleLine is one line of a partner order as the rules see it.
type WholesaleLine struct {
	Name     string
	Quantity float64
	MinQty   float64
	Subtotal float64
}

// WholesaleOrderError is the first rule a partner order breaks, "" when it
// passes: every line meets its product's minimum quantity and the subtotal
// meets the account's minimum order.
func WholesaleOrderError(lines []WholesaleLine, minOrder float64) string {
	subtotal := 0.0
	for _, l := range lines {
		if l.Quantity < l.MinQty {
			return "Minimal pesanan " + l.Name + " adalah " + formatJSNumber(l.MinQty) + " pcs"
		}
		subtotal += l.Subtotal
	}
	if subtotal < minOrder {
		return "Minimal nilai pesanan Rp " + thousands(minOrder)
	}
	return ""
}

// thousands writes 1500000 as 1.500.000.
func thousands(n float64) string {
	s := formatJSNumber(math.Round(n))
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}

// NormalizeEmail is the stored and compared form of a partner email.
func NormalizeEmail(s string) string { return strings.ToLower(JSTrim(s)) }
