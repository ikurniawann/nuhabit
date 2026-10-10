package domain

import (
	"time"

	"nuhabit/backend/internal/platform/jsmath"
)

// Product sale pricing and the stock badges of the storefront catalog.

// Sale is a product's sale terms from shop.product_settings: the sale
// price and when it ends (nil = open-ended).
type Sale struct {
	Price *float64
	Until *time.Time
}

// Active reports whether the sale applies at now: a price below the
// regular base price and an end date not yet reached.
func (s Sale) Active(base float64, now time.Time) bool {
	return s.Price != nil && base > 0 && *s.Price < base && (s.Until == nil || s.Until.After(now))
}

// Pricing is a sellable unit's price for the buyer: the effective price,
// the regular price to strike through and the percentage off (both nil
// without an active sale).
type Pricing struct {
	Price     float64
	CompareAt *float64
	Percent   *int
}

// PriceWithSale prices a regular price under the product's sale. base is
// the product's regular price the sale price was set against; a SKU
// with its own regular price keeps the same percentage off, rounded to
// the rupiah. Checkout, promo preview, invoice and WhatsApp texts all
// price through here.
func PriceWithSale(regular, base float64, sale Sale, now time.Time) Pricing {
	if !sale.Active(base, now) {
		return Pricing{Price: regular}
	}
	price := *sale.Price
	if regular != base {
		price = jsmath.Round(regular * *sale.Price / base)
	}
	percent := int(jsmath.Round((base - *sale.Price) / base * 100))
	return Pricing{Price: price, CompareAt: &regular, Percent: &percent}
}

// LowStock is the "Low stock" badge: some stock, at or under the
// storefront's threshold (0 disables the badge).
func LowStock(stock float64, threshold int) bool {
	return threshold > 0 && stock > 0 && stock <= float64(threshold)
}

// BackInStockWindow is how long the "Back in stock" badge shows after a
// restock.
const BackInStockWindow = 7 * 24 * time.Hour

// BackInStock is the "Back in stock" badge: in stock and restocked
// within the window.
func BackInStock(stock float64, restockedAt *time.Time, now time.Time) bool {
	return stock > 0 && restockedAt != nil && now.Sub(*restockedAt) <= BackInStockWindow
}
