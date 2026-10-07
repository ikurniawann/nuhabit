package domain

import (
	"regexp"
	"strings"
	"unicode/utf16"
)

// Guest is GuestIdentity: a normalized WhatsApp number and name.
type Guest struct {
	Name  string
	Phone string
}

var (
	nonDigits   = regexp.MustCompile(`\D`)
	mobilePhone = regexp.MustCompile(`^628\d{8,12}$`)
	spaces      = regexp.MustCompile(`[\s\p{Zs}\x{feff}\x{2028}\x{2029}]+`) // JS \s
)

// NormalizeGuestPhone is normalizeGuestPhone: 08xx / +62 8xx / 8xx → 628xx,
// "" when it is not an Indonesian mobile number.
func NormalizeGuestPhone(raw string) string {
	digits := nonDigits.ReplaceAllString(raw, "")
	if digits == "" {
		return ""
	}
	switch {
	case strings.HasPrefix(digits, "0"):
		digits = "62" + digits[1:]
	case !strings.HasPrefix(digits, "62"):
		digits = "62" + digits
	}
	if !mobilePhone.MatchString(digits) {
		return ""
	}
	return digits
}

// guestNameMax is GUEST_NAME_MAX (UTF-16 units).
const guestNameMax = 80

// NormalizeGuestName is normalizeGuestName: collapsed spaces, trimmed, then
// cut to 80 characters; "" when shorter than 2.
func NormalizeGuestName(raw string) string {
	units := utf16.Encode([]rune(JSTrim(spaces.ReplaceAllString(raw, " "))))
	if len(units) > guestNameMax {
		units = units[:guestNameMax]
	}
	if len(units) < 2 {
		return ""
	}
	return string(utf16.Decode(units))
}

// ValidateGuest is validateGuest: the guest or the error the route answers
// with 400.
func ValidateGuest(name, phone string) (Guest, string) {
	p := NormalizeGuestPhone(phone)
	if p == "" {
		return Guest{}, "Masukkan nomor WhatsApp yang valid (contoh 0812xxxxxxx)"
	}
	n := NormalizeGuestName(name)
	if n == "" {
		return Guest{}, "Masukkan nama pemesan (minimal 2 huruf)"
	}
	return Guest{Name: n, Phone: p}, ""
}

var paymentMarker = regexp.MustCompile(`(?i)payment=([a-z_]+)`)

// PaymentFlowFrom is paymentFlowFrom: the payment=<flow> marker of a
// self-order's special_requests, else payment_method, else "cashier".
func PaymentFlowFrom(specialRequests, paymentMethod *string) string {
	if specialRequests != nil {
		if m := paymentMarker.FindStringSubmatch(*specialRequests); m != nil {
			return strings.ToLower(m[1])
		}
	}
	if paymentMethod != nil && *paymentMethod != "" {
		return *paymentMethod
	}
	return "cashier"
}

// PaymentMethodText is paymentMethodText.
func PaymentMethodText(method string) string {
	switch strings.ToLower(method) {
	case "qris":
		return "QRIS"
	case "static_qris":
		return "Static QRIS"
	case "ark_coin":
		return "ARK Coin"
	case "cashier":
		return "Bayar di kasir"
	}
	if method == "" {
		return "—"
	}
	return method
}

// LoyaltyFlag is toBool in lib/crm/loyalty-features.ts for a crm_settings
// jsonb value: booleans, "true"/"false", 1/0 and "1"/"0"; anything else is
// the default (enabled).
func LoyaltyFlag(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		if x == "false" || x == "0" {
			return false
		}
	case float64:
		if x == 0 {
			return false
		}
	}
	return true
}

var paidQRStatuses = map[string]bool{"SUCCEEDED": true, "SUCCESS": true, "COMPLETED": true, "PAID": true}

// IsXenditQRPaid is isXenditQrPaid: the QR or payment status, or any row of
// payments/data, is a paid status.
func IsXenditQRPaid(payload map[string]any) bool {
	if paidQRStatuses[strings.ToUpper(JSOr(payload["status"]))] || paidQRStatuses[strings.ToUpper(JSOr(payload["payment_status"]))] {
		return true
	}
	// paymentRowsFromPayload: payments, else data.
	rows, isList := payload["payments"].([]any)
	if !isList {
		rows, _ = payload["data"].([]any)
	}
	for _, item := range rows {
		if row, isMap := item.(map[string]any); isMap && paidQRStatuses[strings.ToUpper(JSOr(row["status"]))] {
			return true
		}
	}
	return false
}

// QRAmount is `Number(value != null ? value : fallback) || fallback`.
func QRAmount(v any, fallback float64) float64 {
	if v == nil {
		return fallback
	}
	if n := ToNumber(v); n != 0 {
		return n
	}
	return fallback
}
