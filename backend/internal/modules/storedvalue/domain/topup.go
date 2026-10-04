package domain

import (
	"math"
	"net/url"
	"sort"
	"strings"
)

// Top-up rules: loyalty settings (lib/pos/loyalty-settings.ts), packages
// (lib/wallet/packages.ts) and the Xendit QRIS checks (lib/payments/xendit.ts,
// lib/pos/topup-qris-reconcile.ts).

// QRISMinAmount is the smallest QRIS top-up (Rp 1.500).
const QRISMinAmount = 1_500

// ArkCoinDisabledMessage is ARK_COIN_DISABLED_MESSAGE.
const ArkCoinDisabledMessage = "Fitur ARK Coin sedang dinonaktifkan di pengaturan CRM"

// LoyaltySettings is the normalized pos_loyalty_settings row
// (normalizeLoyaltySettings).
type LoyaltySettings struct {
	ArkRate           float64
	TopupMinAmount    float64
	TopupXPEnabled    bool
	TopupXPMode       string // fixed | per_amount
	TopupXPValue      float64
	TopupXPAmountStep float64
}

// DefaultLoyaltySettings mirrors DEFAULT_POS_LOYALTY_SETTINGS.
func DefaultLoyaltySettings() LoyaltySettings {
	return LoyaltySettings{
		ArkRate: 1000, TopupMinAmount: 10_000, TopupXPEnabled: true,
		TopupXPMode: "per_amount", TopupXPValue: 1, TopupXPAmountStep: 10_000,
	}
}

// LoyaltyRow is the raw settings row; nil fields fall back to defaults.
type LoyaltyRow struct {
	ArkRate           *float64
	TopupMinAmount    *float64
	TopupXPEnabled    *bool
	TopupXPMode       *string
	TopupXPValue      *float64
	TopupXPAmountStep *float64
}

// NormalizeLoyaltySettings mirrors normalizeLoyaltySettings; row nil means
// no active row.
func NormalizeLoyaltySettings(row *LoyaltyRow) LoyaltySettings {
	d := DefaultLoyaltySettings()
	if row == nil {
		return d
	}
	or := func(v *float64, def float64) float64 {
		if v == nil {
			return def
		}
		return *v
	}
	mode := "per_amount"
	if row.TopupXPMode != nil && strings.ToLower(*row.TopupXPMode) == "fixed" {
		mode = "fixed"
	}
	enabled := d.TopupXPEnabled
	if row.TopupXPEnabled != nil {
		enabled = *row.TopupXPEnabled
	}
	return LoyaltySettings{
		ArkRate:           math.Max(1, or(row.ArkRate, d.ArkRate)),
		TopupMinAmount:    math.Max(0, or(row.TopupMinAmount, d.TopupMinAmount)),
		TopupXPEnabled:    enabled,
		TopupXPMode:       mode,
		TopupXPValue:      math.Max(0, or(row.TopupXPValue, d.TopupXPValue)),
		TopupXPAmountStep: math.Max(1, or(row.TopupXPAmountStep, d.TopupXPAmountStep)),
	}
}

// IdrToArk converts stored rupiah to ARK units.
func IdrToArk(amountIdr, arkRate float64) float64 {
	rate := arkRate
	if rate == 0 {
		rate = 1000
	}
	return amountIdr / math.Max(1, rate)
}

// CalculateTopupXP mirrors calculateTopupXp.
func CalculateTopupXP(amountIdr float64, s LoyaltySettings) float64 {
	if !s.TopupXPEnabled {
		return 0
	}
	amount := math.Max(0, amountIdr)
	if amount <= 0 {
		return 0
	}
	if s.TopupXPMode == "fixed" {
		return math.Max(0, math.Floor(s.TopupXPValue))
	}
	step := math.Max(1, s.TopupXPAmountStep)
	return math.Max(0, math.Floor(amount/step)*math.Max(0, s.TopupXPValue))
}

// ResolvePaymentMethod maps a cashier top-up method to cash, qris, credit
// or foc (default qris).
func ResolvePaymentMethod(raw any) string {
	value := "qris"
	if s := JSOr(raw); s != "" {
		value = strings.ToLower(s)
	}
	switch value {
	case "cash":
		return "cash"
	case "foc":
		return "foc"
	case "credit", "credit_card":
		return "credit"
	}
	return "qris"
}

// JSOr is `String(v || "")`: falsy JSON values (null, "", 0, false) are "".
func JSOr(v any) string {
	if !truthy(v) {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return JSNumber(x)
	case bool:
		return "true"
	}
	return JSStringOrEmpty(v)
}

// QRImageURL is buildQrImageUrl.
func QRImageURL(qrString string) string {
	return "https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=" + EncodeURIComponent(qrString)
}

// EncodeURIComponent mirrors the JS function.
func EncodeURIComponent(s string) string {
	e := url.QueryEscape(s)
	e = strings.ReplaceAll(e, "+", "%20")
	for _, keep := range []string{"!", "'", "(", ")", "*", "~"} {
		e = strings.ReplaceAll(e, url.QueryEscape(keep), keep)
	}
	return e
}

var paidStatuses = map[string]bool{"SUCCEEDED": true, "SUCCESS": true, "COMPLETED": true, "PAID": true}

func isPaid(v any) bool { return paidStatuses[strings.ToUpper(JSOr(v))] }

// PickPaidXenditPayment returns the first succeeded payment of a QR.
func PickPaidXenditPayment(rows []map[string]any) (id string, amount float64, ok bool) {
	for _, row := range rows {
		if !isPaid(row["status"]) {
			continue
		}
		id = JSOr(row["id"])
		if id == "" {
			id = JSOr(row["payment_id"])
		}
		return id, ToNumber(row["amount"]), true
	}
	return "", 0, false
}

// IsXenditQrPaid reports a paid QR from its status, payment_status or the
// payments/data rows it carries.
func IsXenditQrPaid(payload map[string]any) bool {
	if isPaid(payload["status"]) || isPaid(payload["payment_status"]) {
		return true
	}
	for _, key := range []string{"payments", "data"} {
		if arr, isList := payload[key].([]any); isList {
			for _, item := range arr {
				if m, isMap := item.(map[string]any); isMap && isPaid(m["status"]) {
					return true
				}
			}
			return false
		}
	}
	return false
}

// PackageBonus is credit minus price, never negative.
func PackageBonus(priceIdr, creditIdr float64) float64 { return math.Max(0, creditIdr-priceIdr) }

// PackageAvailableAt: an active package without a branch list sells
// everywhere; otherwise only at the listed branches.
func PackageAvailableAt(isActive bool, branchIDs []string, branchID *string) bool {
	if !isActive {
		return false
	}
	if len(branchIDs) == 0 {
		return true
	}
	if branchID == nil {
		return false
	}
	for _, id := range branchIDs {
		if id == *branchID {
			return true
		}
	}
	return false
}

// SortedUnique returns the distinct values in ascending order.
func SortedUnique(values []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, v := range values {
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return out
}
