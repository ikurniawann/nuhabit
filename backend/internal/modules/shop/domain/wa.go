package domain

import (
	"math"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
)

// WhatsApp texts for shop orders (lib/shop/shop-wa.ts).

// OrderShippedMessage is the waybill message (sendShopOrderShippedWa).
func OrderShippedMessage(origin, orderNumber, accessToken, waybill, courierLabel string) string {
	msg := "*Order shipped* 📦\n\n" + "Order: *" + orderNumber + "*\n"
	if courierLabel != "" {
		msg += "Courier: " + courierLabel + "\n"
	}
	return msg + "Tracking number: *" + waybill + "*\n\n" +
		"Track your order here:\n" + origin + "/shop/order/" + accessToken
}

// OrderPaidMessage is the payment confirmation (sendShopOrderPaidWa).
func OrderPaidMessage(origin, orderNumber, customerName, accessToken string, total float64) string {
	return "*Payment received* ✅\n\n" +
		"Order: *" + orderNumber + "*\n" +
		"Name: " + customerName + "\n" +
		"Total: " + FormatRupiah(total) + "\n\n" +
		"Your order is being prepared. Check its status and tracking number here:\n" + origin + "/shop/order/" + accessToken
}

// FormatRupiah is formatRupiah: "Rp1.250.000", rounded to the rupiah.
func FormatRupiah(value float64) string {
	n := jsmath.Round(value)
	sign := ""
	if n < 0 {
		sign = "-"
	}
	digits := strconv.FormatFloat(math.Abs(n), 'f', 0, 64)
	var b strings.Builder
	for i, c := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return sign + "Rp" + b.String()
}
