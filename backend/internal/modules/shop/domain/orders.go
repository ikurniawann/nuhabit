// Package domain holds the pure online-shop rules: order status
// transitions, the back-office list filter, the public order view, courier
// quotes with the shop markup, shipping settings patches, the Biteship and
// Shopee status maps, and the public rate limiter. Port of
// frontend/src/lib/shop/{orders,order-status,shipping/quotes,
// shipping/settings,marketplace/sync}.ts. No DB, no HTTP.
package domain

import (
	"math"
	"strconv"
	"strings"
	"unicode"
)

// Delivery methods and payment methods of shop.orders.
const (
	DeliveryShip   = "ship"
	DeliveryPickup = "pickup"
	PaymentXendit  = "xendit"
	PaymentArkCoin = "arkcoin"
)

// orderTransitions are ORDER_TRANSITIONS: paid→packing, shipped→completed,
// cancel from pending/paid/packing, and for pickup orders
// paid→ready_for_pickup→picked_up. Shipping goes through /shipment.
var orderTransitions = map[string][]string{
	"packing":          {"paid"},
	"completed":        {"shipped"},
	"cancelled":        {"pending", "paid", "packing", "ready_for_pickup"},
	"ready_for_pickup": {"paid"},
	"picked_up":        {"ready_for_pickup"},
}

// AllowedFromStatuses is allowedFromStatuses: the statuses an order may
// leave for next; ok is false for an unknown transition.
func AllowedFromStatuses(next string) (from []string, ok bool) {
	from, ok = orderTransitions[next]
	return from, ok
}

// TransitionFitsDelivery reports whether next belongs to the order's
// delivery method: packing is for shipped orders, the pickup steps for
// pickup orders; cancelling fits both.
func TransitionFitsDelivery(next, deliveryMethod string) bool {
	switch next {
	case "packing":
		return deliveryMethod != DeliveryPickup
	case "ready_for_pickup", "picked_up":
		return deliveryMethod == DeliveryPickup
	}
	return true
}

// OrderTotal is subtotal minus the discount plus shipping, never below 0.
func OrderTotal(subtotal, discount, shipping float64) float64 {
	return math.Max(0, subtotal-discount+shipping)
}

// CanShipOrder is canShipOrder: a paid order not yet shipped.
func CanShipOrder(status string) bool { return status == "paid" || status == "packing" }

// PayLaterFromPending reports whether a pending pay_later order may move to
// next without a payment: packing (goods ship before payment) or paid
// (staff record the transfer).
func PayLaterFromPending(next string) bool { return next == "packing" || next == "paid" }

// OrderListFilter is ShopOrderListFilter.
type OrderListFilter struct {
	Status string
	Search string
	Limit  float64
}

// ParseOrderListFilter is parseShopOrderListFilter: trimmed status and
// search, limit = min(200, max(1, Number(limit) || 100)).
func ParseOrderListFilter(status, search, limit string, limitSent bool) OrderListFilter {
	n := 0.0
	if limitSent {
		n = JSNumber(limit)
	}
	if n == 0 || math.IsNaN(n) {
		n = 100
	}
	return OrderListFilter{
		Status: JSTrim(status),
		Search: JSTrim(search),
		Limit:  math.Min(200, math.Max(1, n)),
	}
}

// JSTrim is String.prototype.trim.
func JSTrim(s string) string {
	return strings.TrimFunc(s, isJSSpace)
}

func isJSSpace(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF }

// JSNumber is Number(s): trimmed, "" is 0, junk is NaN.
func JSNumber(s string) float64 {
	s = JSTrim(s)
	if s == "" {
		return 0
	}
	switch s {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	lower := strings.ToLower(s)
	for prefix, base := range map[string]int{"0x": 16, "0o": 8, "0b": 2} {
		if strings.HasPrefix(lower, prefix) {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	if strings.ContainsAny(lower, "_inx") {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// OrFinite is `Number(x) || 0` for an already converted number.
func OrFinite(n float64) float64 {
	if math.IsNaN(n) {
		return 0
	}
	return n
}

// JoinNonEmpty is [a, b].filter(Boolean).join(sep).
func JoinNonEmpty(sep string, parts ...*string) string {
	var kept []string
	for _, p := range parts {
		if p != nil && *p != "" {
			kept = append(kept, *p)
		}
	}
	return strings.Join(kept, sep)
}

// PublicOrderItem is one line of the public order page. Reviewable is
// true when the buyer may still review the product from this order.
type PublicOrderItem struct {
	Name       string  `json:"name"`
	Quantity   float64 `json:"quantity"`
	UnitPrice  float64 `json:"unit_price"`
	Total      float64 `json:"total"`
	ProductID  *string `json:"productId"`
	Reviewable bool    `json:"reviewable"`
}

// OrderItemRow is an order_items row as the public page reads it (numeric
// columns as node-postgres strings).
type OrderItemRow struct {
	ProductName string
	SkuName     *string
	Quantity    string
	UnitPrice   string
	Total       string
	ProductID   *string
	Reviewable  bool
}

// PublicItem is the toPublicOrderStatus line: the variant joined to the
// product name, numbers as Number().
func PublicItem(i OrderItemRow) PublicOrderItem {
	name := i.ProductName
	if i.SkuName != nil && *i.SkuName != "" {
		name += " — " + *i.SkuName
	}
	return PublicOrderItem{Name: name, Quantity: JSNumber(i.Quantity), UnitPrice: JSNumber(i.UnitPrice), Total: JSNumber(i.Total),
		ProductID: i.ProductID, Reviewable: i.Reviewable}
}

// InvoiceURLWhilePending is the invoice link only while the order waits for
// payment.
func InvoiceURLWhilePending(status string, url *string) *string {
	if status == "pending" {
		return url
	}
	return nil
}
