package domain

import (
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ARK Coin top-up rules (lib/wallet/{topup,packages,member-topup}.ts and
// lib/pos/loyalty-settings.ts).
const (
	QRISMinAmount        = 1_500
	MaxOpenMemberTopups  = 3
	QRDisplayTTL         = 30 * time.Minute
	DefaultArkRate       = 1000
	ArkCoinDisabledError = "Fitur ARK Coin sedang dinonaktifkan di pengaturan CRM"
)

// DefaultTopupPresets are used when the settings row has none.
var DefaultTopupPresets = []float64{50000, 100000, 200000, 500000, 1000000}

// RoundIdr rounds to 2 decimals (numeric(12,2) columns), like Math.round.
func RoundIdr(v float64) float64 { return jsRound(v*100) / 100 }

func jsRound(v float64) float64 { return math.Floor(v + 0.5) }

// FormatRupiah mirrors formatRupiah: "Rp10.000", "-Rp1.500".
func FormatRupiah(v float64) string {
	n := int64(jsRound(v))
	sign := ""
	if n < 0 {
		sign = "-"
		n = -n
	}
	return sign + "Rp" + groupThousands(n)
}

func groupThousands(n int64) string {
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return b.String()
}

// CheckFreeAmount validates a free top-up amount; "" means valid.
func CheckFreeAmount(amount float64, min, max float64) string {
	if amount != math.Trunc(amount) || amount <= 0 || math.IsInf(amount, 0) || math.IsNaN(amount) {
		return "Nominal top-up tidak valid"
	}
	if amount < min {
		return "Minimal top-up " + FormatRupiah(min)
	}
	if max > 0 && amount > max {
		return "Maksimal top-up " + FormatRupiah(max)
	}
	return ""
}

// PackageBonus is credit minus price, never negative.
func PackageBonus(priceIdr, creditIdr float64) float64 { return math.Max(0, creditIdr-priceIdr) }

// ExpiresAtFor adds validity days to from; nil when there is no validity.
func ExpiresAtFor(validityDays *float64, from time.Time) *time.Time {
	if validityDays == nil || !(*validityDays > 0) {
		return nil
	}
	t := from.Add(time.Duration(*validityDays * float64(24*time.Hour)))
	return &t
}

// IdrToArk converts stored rupiah to ARK display units.
func IdrToArk(amountIdr, arkRate float64) float64 {
	rate := arkRate
	if rate == 0 {
		rate = DefaultArkRate
	}
	return amountIdr / math.Max(1, rate)
}

// LoyaltySettings is the normalized pos_loyalty_settings row.
type LoyaltySettings struct {
	ArkRate           float64
	TopupMinAmount    float64
	TopupPresets      []float64
	TopupXPEnabled    bool
	TopupXPMode       string
	TopupXPValue      float64
	TopupXPAmountStep float64
}

// DefaultLoyaltySettings mirrors DEFAULT_POS_LOYALTY_SETTINGS.
func DefaultLoyaltySettings() LoyaltySettings {
	return LoyaltySettings{
		ArkRate:           DefaultArkRate,
		TopupMinAmount:    10000,
		TopupPresets:      append([]float64(nil), DefaultTopupPresets...),
		TopupXPEnabled:    true,
		TopupXPMode:       "per_amount",
		TopupXPValue:      1,
		TopupXPAmountStep: 10000,
	}
}

// NormalizeTopupPresets parses the jsonb presets: positive, rounded, unique,
// ascending; the defaults when nothing usable remains.
func NormalizeTopupPresets(raw json.RawMessage) []float64 {
	var list []any
	if err := json.Unmarshal(raw, &list); err != nil {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			_ = json.Unmarshal([]byte(s), &list)
		}
	}
	seen := map[float64]bool{}
	out := []float64{}
	for _, item := range list {
		v := jsRound(ToNumber(item))
		if v > 0 && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Float64s(out)
	if len(out) == 0 {
		return append([]float64(nil), DefaultTopupPresets...)
	}
	return out
}

// ToNumber is Number(v) || 0 for a decoded JSON value.
func ToNumber(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return 0
		}
		return f
	case bool:
		if x {
			return 1
		}
	}
	return 0
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
	value := math.Max(0, s.TopupXPValue)
	return math.Max(0, math.Floor(amount/step)*value)
}

// ParseFeatureFlag reads a crm_settings jsonb flag with the default on.
func ParseFeatureFlag(raw json.RawMessage, fallback bool) bool {
	var v any
	if len(raw) == 0 || json.Unmarshal(raw, &v) != nil {
		return fallback
	}
	switch x := v.(type) {
	case bool:
		return x
	case string:
		switch x {
		case "true", "1":
			return true
		case "false", "0":
			return false
		}
	case float64:
		switch x {
		case 1:
			return true
		case 0:
			return false
		}
	}
	return fallback
}

// FilterPresets keeps presets within [min, max]; max <= 0 means no cap.
func FilterPresets(presets []float64, min, max float64) []float64 {
	out := []float64{}
	for _, v := range presets {
		if v >= min && (max <= 0 || v <= max) {
			out = append(out, v)
		}
	}
	return out
}

// PickPaidXenditPayment returns the first succeeded payment of a QR.
func PickPaidXenditPayment(rows []map[string]any) (id string, amount float64, ok bool) {
	for _, row := range rows {
		if !isPaidStatus(row["status"]) {
			continue
		}
		id = JSString(row["id"])
		if id == "" {
			id = JSString(row["payment_id"])
		}
		return id, ToNumber(row["amount"]), true
	}
	return "", 0, false
}

// IsXenditQrPaid reports a paid QR from its status, payment_status or payments.
func IsXenditQrPaid(payload map[string]any) bool {
	if isPaidStatus(payload["status"]) || isPaidStatus(payload["payment_status"]) {
		return true
	}
	for _, row := range XenditPaymentRows(payload) {
		if isPaidStatus(row["status"]) {
			return true
		}
	}
	return false
}

// XenditPaymentRows reads "payments" or "data" arrays of objects.
func XenditPaymentRows(payload map[string]any) []map[string]any {
	for _, key := range []string{"payments", "data"} {
		if arr, ok := payload[key].([]any); ok {
			rows := []map[string]any{}
			for _, item := range arr {
				if m, ok := item.(map[string]any); ok {
					rows = append(rows, m)
				}
			}
			return rows
		}
	}
	return nil
}

func isPaidStatus(v any) bool {
	switch strings.ToUpper(JSString(v)) {
	case "SUCCEEDED", "SUCCESS", "COMPLETED", "PAID":
		return true
	}
	return false
}

// JSString is String(v || "") for a decoded JSON value.
func JSString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		if x == 0 {
			return ""
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		if !x {
			return ""
		}
		return "true"
	}
	return ""
}
