package domain

import (
	"net/url"
	"strings"
)

// Storefront checkout rules: promo rejection copy, the WhatsApp chat link
// and the storefront settings defaults.

// promoMessages are the storefront's English texts for the promo engine's
// RejectReason values (the engine's own messages are for the cashier).
var promoMessages = map[string]string{
	"nonaktif":            "This promo code is not valid",
	"belum-mulai":         "This promo code is not active yet",
	"kedaluwarsa":         "This promo code has expired",
	"scope":               "This promo code does not apply to online orders",
	"khusus-member":       "This promo code is for members only",
	"bukan-member-baru":   "This promo code is for new members only",
	"produk-tidak-sesuai": "This promo code does not apply to the items in your cart",
	"min-pembelian":       "Your order does not reach the minimum for this promo code",
	"kuota-habis":         "This promo code has been fully used",
	"limit-nomor":         "This promo code has already been used with your phone number",
}

// PromoMessage is the buyer-facing text of a promo rejection.
func PromoMessage(reason string) string {
	if msg, ok := promoMessages[reason]; ok {
		return msg
	}
	return promoMessages["nonaktif"]
}

// WhatsAppLink is the wa.me chat link for the store's number with the
// order number prefilled; nil when the store has no number.
func WhatsAppLink(number *string, orderNumber string) *string {
	if number == nil {
		return nil
	}
	digits := PhoneDigits(*number)
	if strings.HasPrefix(digits, "0") {
		digits = "62" + digits[1:]
	}
	if len(digits) < 8 {
		return nil
	}
	link := "https://wa.me/" + digits + "?text=" + url.QueryEscape("Hi, I have a question about order "+orderNumber)
	return &link
}

// ShippingCost is the courier rate, or 0 once the subtotal (before any
// discount) reaches the storefront's free-shipping threshold, the rule
// the cart shows as "Free".
func ShippingCost(rate, subtotal float64, threshold *float64) float64 {
	if threshold != nil && *threshold > 0 && subtotal >= *threshold {
		return 0
	}
	return rate
}

// StorefrontSettings is the storefront settings form and the public
// catalog's settings block.
type StorefrontSettings struct {
	PickupEnabled         bool     `json:"pickupEnabled"`
	FreeShippingThreshold *float64 `json:"freeShippingThreshold"`
	LowStockThreshold     int      `json:"lowStockThreshold"`
	WhatsappNumber        *string  `json:"whatsappNumber"`
}

// DefaultStorefrontSettings are the settings of a storefront without a
// settings row.
func DefaultStorefrontSettings() StorefrontSettings {
	return StorefrontSettings{PickupEnabled: true, LowStockThreshold: 3}
}
