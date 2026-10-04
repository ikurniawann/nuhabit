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
	msg := "*Pesanan dikirim* 📦\n\n" + "Order: *" + orderNumber + "*\n"
	if courierLabel != "" {
		msg += "Kurir: " + courierLabel + "\n"
	}
	return msg + "Resi: *" + waybill + "*\n\n" +
		"Lacak status pengiriman di:\n" + origin + "/shop/order/" + accessToken
}

// OrderPaidMessage is the payment confirmation (sendShopOrderPaidWa).
func OrderPaidMessage(origin, orderNumber, customerName, accessToken string, total float64) string {
	return "*Pembayaran diterima* ✅\n\n" +
		"Order: *" + orderNumber + "*\n" +
		"Atas nama: " + customerName + "\n" +
		"Total: " + FormatRupiah(total) + "\n\n" +
		"Pesananmu sedang disiapkan. Pantau status & resi di:\n" + origin + "/shop/order/" + accessToken
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
