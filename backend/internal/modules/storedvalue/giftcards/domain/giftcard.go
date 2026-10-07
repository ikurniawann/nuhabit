// Package domain holds the pure gift card rules of lib/giftcard/giftcard.ts:
// bearer codes, balance math for issue, redeem, reload and correction, the
// preset/expiry configuration and phone matching. No database, no HTTP.
package domain

import (
	"crypto/rand"
	"errors"
	"math"
	"math/big"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	svdomain "nuhabit/backend/internal/modules/storedvalue/domain"
)

// Card statuses (giftcard.gift_cards.status).
const (
	StatusPending   = "pending"
	StatusActive    = "active"
	StatusDisabled  = "disabled"
	StatusExhausted = "exhausted"
	StatusExpired   = "expired"
)

// MaxValue is MAX_GIFT_CARD_VALUE: the ceiling of one card's balance.
const MaxValue = 100_000_000

// codeCharset leaves out 0/O/1/I so codes read back without ambiguity.
const (
	codeCharset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	codeLength  = 12
)

// GenerateCode is generateGiftCardCode: 12 characters from a CSPRNG. The
// code is a bearer credential, so it never comes from math/rand.
func GenerateCode() string {
	b := make([]byte, codeLength)
	limit := big.NewInt(int64(len(codeCharset)))
	for i := range b {
		n, err := rand.Int(rand.Reader, limit)
		if err != nil {
			panic("giftcard: crypto/rand failed: " + err.Error())
		}
		b[i] = codeCharset[n.Int64()]
	}
	return string(b)
}

var codeFormat = regexp.MustCompile(`^[A-Z0-9]{8,20}$`)

// IsValidCodeFormat is isValidGiftCardCodeFormat.
func IsValidCodeFormat(code string) bool { return codeFormat.MatchString(code) }

// NormalizeCode is `code.trim().toUpperCase()`.
func NormalizeCode(code string) string {
	return strings.ToUpper(strings.TrimFunc(code, func(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' }))
}

// State is the part of a card the redeem and reload rules read.
type State struct {
	Status    string
	Balance   float64
	ExpiresAt *time.Time // nil = never expires
}

// IsExpired is isGiftCardExpired: strictly past expiresAt.
func IsExpired(expiresAt *time.Time, now time.Time) bool {
	return expiresAt != nil && now.After(*expiresAt)
}

// Redeem reject reasons (GiftCardRejectReason).
const (
	ReasonInactive      = "nonaktif"
	ReasonExpired       = "kedaluwarsa"
	ReasonLowBalance    = "saldo-kurang"
	ReasonInvalidAmount = "nominal-tidak-valid"
	ReasonOverCeiling   = "melebihi-plafon"
)

// RedeemMessages is GIFT_CARD_REJECT_MESSAGES.
var RedeemMessages = map[string]string{
	ReasonInactive:      "Gift card tidak aktif atau belum bisa dipakai",
	ReasonExpired:       "Gift card sudah kedaluwarsa",
	ReasonLowBalance:    "Saldo gift card tidak cukup",
	ReasonInvalidAmount: "Nominal harus lebih dari 0",
}

// ReloadMessages is GIFT_CARD_RELOAD_REJECT_MESSAGES.
var ReloadMessages = map[string]string{
	ReasonInvalidAmount: "Nominal reload harus rupiah bulat di atas 0",
	ReasonInactive:      "Kartu nonaktif atau belum dibayar — tidak bisa di-reload",
	ReasonExpired:       "Kartu sudah kedaluwarsa — tidak bisa di-reload",
	ReasonOverCeiling:   "Saldo setelah reload melebihi plafon Rp" + LocaleID(MaxValue),
}

// RedeemResult is GiftCardRedeemResult; Reason is set when OK is false.
type RedeemResult struct {
	OK           bool
	BalanceAfter float64
	StatusAfter  string
	Reason       string
}

// EvaluateRedeem is evaluateGiftCardRedeem: one card pays amount in full.
func EvaluateRedeem(card State, amount float64, now time.Time) RedeemResult {
	switch {
	case amount <= 0:
		return RedeemResult{Reason: ReasonInvalidAmount}
	case card.Status == StatusDisabled || card.Status == StatusExhausted || card.Status == StatusPending:
		return RedeemResult{Reason: ReasonInactive}
	case card.Status == StatusExpired || IsExpired(card.ExpiresAt, now):
		return RedeemResult{Reason: ReasonExpired}
	case card.Balance < amount:
		return RedeemResult{Reason: ReasonLowBalance}
	}
	after := svdomain.RoundIdr(card.Balance - amount)
	status := StatusActive
	if after <= 0 {
		status = StatusExhausted
	}
	return RedeemResult{OK: true, BalanceAfter: after, StatusAfter: status}
}

// ErrNonPositiveIssue is computeBalanceAfterIssue's guard.
var ErrNonPositiveIssue = errors.New("Nominal isi harus > 0")

// BalanceAfterIssue is computeBalanceAfterIssue (ledger direction 'isi').
func BalanceAfterIssue(current, amount float64) (float64, error) {
	if amount <= 0 {
		return 0, ErrNonPositiveIssue
	}
	return svdomain.RoundIdr(current + amount), nil
}

// ErrNegativeBalance is computeBalanceAfterCorrection's guard.
var ErrNegativeBalance = errors.New("Koreksi membuat saldo negatif")

// BalanceAfterCorrection is computeBalanceAfterCorrection (direction
// 'koreksi'): delta is signed, the result may not go below zero.
func BalanceAfterCorrection(current, delta float64) (float64, error) {
	result := svdomain.RoundIdr(current + delta)
	if result < 0 {
		return 0, ErrNegativeBalance
	}
	return result, nil
}

// StatusAfterRefund is resolveStatusAfterRefund: an exhausted card comes
// back to life, a card an admin disabled or that expired stays as it is.
func StatusAfterRefund(current string, balanceAfter float64) string {
	if current == StatusDisabled || current == StatusExpired {
		return current
	}
	if balanceAfter > 0 {
		return StatusActive
	}
	return StatusExhausted
}

// ReloadResult is GiftCardReloadResult; Reason is set when OK is false.
type ReloadResult struct {
	OK                 bool
	BalanceAfter       float64
	ReloadedTotalAfter float64
	StatusAfter        string
	Reason             string
}

// EvaluateReload is evaluateGiftCardReload: active or exhausted cards take
// whole-rupiah top ups up to MaxValue, and reloaded_total grows with them.
func EvaluateReload(card State, reloadedTotal, amount float64, now time.Time) ReloadResult {
	if amount != math.Trunc(amount) || amount <= 0 {
		return ReloadResult{Reason: ReasonInvalidAmount}
	}
	if card.Status != StatusActive && card.Status != StatusExhausted {
		if card.Status == StatusExpired {
			return ReloadResult{Reason: ReasonExpired}
		}
		return ReloadResult{Reason: ReasonInactive}
	}
	if IsExpired(card.ExpiresAt, now) {
		return ReloadResult{Reason: ReasonExpired}
	}
	after, _ := BalanceAfterIssue(card.Balance, amount)
	if after > MaxValue {
		return ReloadResult{Reason: ReasonOverCeiling}
	}
	return ReloadResult{
		OK:                 true,
		BalanceAfter:       after,
		ReloadedTotalAfter: svdomain.RoundIdr(reloadedTotal + amount),
		StatusAfter:        StatusActive,
	}
}

// ReloadPaymentMethods are the keys of GIFT_CARD_RELOAD_PAYMENT_METHODS in
// declaration order (the z.enum order).
var ReloadPaymentMethods = []string{"cash", "qris", "debit_card", "credit_card", "transfer"}

// ReloadPaymentLabels are the labels of GIFT_CARD_RELOAD_PAYMENT_METHODS.
var ReloadPaymentLabels = map[string]string{
	"cash":        "Tunai",
	"qris":        "QRIS",
	"debit_card":  "Kartu Debit",
	"credit_card": "Kartu Kredit",
	"transfer":    "Transfer Bank",
}

/* ── configuration ───────────────────────────────────────────────────── */

// Config is GiftCardConfig; the JSON keys and order are what the TS
// stores in app_settings and returns.
type Config struct {
	Presets      []float64 `json:"presets"`
	AllowCustom  bool      `json:"allow_custom"`
	ExpiryMonths *int      `json:"expiry_months"`
}

const (
	maxPresets      = 12
	maxExpiryMonths = 120
)

// DefaultConfig is DEFAULT_GIFT_CARD_CONFIG.
func DefaultConfig() Config {
	return Config{Presets: []float64{50_000, 100_000, 200_000, 500_000}, AllowCustom: true}
}

// ParseConfig is parseGiftCardConfig over a decoded JSON value (numbers as
// float64): broken values fall back to the defaults.
func ParseConfig(raw any) Config {
	obj, _ := raw.(map[string]any)
	cfg := DefaultConfig()
	cfg.Presets = nil
	if list, ok := obj["presets"].([]any); ok {
		for _, v := range list {
			if f, ok := v.(float64); ok {
				cfg.Presets = append(cfg.Presets, f)
			}
		}
	}
	if b, ok := obj["allow_custom"].(bool); ok {
		cfg.AllowCustom = b
	}
	if f, ok := obj["expiry_months"].(float64); ok {
		m := int(math.Min(maxExpiryMonths, math.Max(1, math.Floor(f))))
		cfg.ExpiryMonths = &m
	}
	return cfg.Normalized()
}

// Normalized applies parseGiftCardConfig's cleanup: positive presets,
// deduplicated, ascending, at most 12 (none left = the defaults), and
// expiry_months clamped to 1..120.
func (c Config) Normalized() Config {
	presets := []float64{}
	for _, p := range c.Presets {
		if p > 0 && !math.IsInf(p, 0) && !math.IsNaN(p) && !slices.Contains(presets, p) {
			presets = append(presets, p)
		}
	}
	slices.Sort(presets)
	if len(presets) > maxPresets {
		presets = presets[:maxPresets]
	}
	if len(presets) == 0 {
		presets = DefaultConfig().Presets
	}
	out := Config{Presets: presets, AllowCustom: c.AllowCustom}
	if c.ExpiryMonths != nil {
		m := min(maxExpiryMonths, max(1, *c.ExpiryMonths))
		out.ExpiryMonths = &m
	}
	return out
}

// IsAllowedNominal is isAllowedGiftCardNominal: whole rupiah, 1..MaxValue,
// and one of the presets unless custom amounts are allowed.
func IsAllowedNominal(c Config, nominal float64) bool {
	if math.IsNaN(nominal) || math.IsInf(nominal, 0) || nominal != math.Trunc(nominal) {
		return false
	}
	if nominal <= 0 || nominal > MaxValue {
		return false
	}
	return c.AllowCustom || slices.Contains(c.Presets, nominal)
}

// NominalRejection is prepareGiftCardSale's message for a nominal
// IsAllowedNominal refused.
func NominalRejection(c Config) string {
	if c.AllowCustom {
		return "Nominal gift card tidak valid — isi rupiah bulat di atas 0"
	}
	parts := make([]string, len(c.Presets))
	for i, p := range c.Presets {
		parts[i] = "Rp" + LocaleID(p)
	}
	return "Nominal gift card harus salah satu dari: " + strings.Join(parts, ", ")
}

// ResolveExpiry is resolveGiftCardExpiry: issue date plus months in UTC,
// with the day clamped to the target month (31 Jan + 1 = 28/29 Feb).
func ResolveExpiry(months *int, issuedAt time.Time) *time.Time {
	if months == nil {
		return nil
	}
	t := issuedAt.UTC()
	first := time.Date(t.Year(), t.Month()+time.Month(*months), 1, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.UTC)
	lastDay := time.Date(first.Year(), first.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	expiry := time.Date(first.Year(), first.Month(), min(t.Day(), lastDay), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.UTC)
	return &expiry
}

/* ── phone matching ──────────────────────────────────────────────────── */

var (
	nonDigits     = regexp.MustCompile(`[^0-9]`)
	countryPrefix = regexp.MustCompile(`^(62|0)`)
)

// PhoneMatchKey is phoneMatchKey: digits only, without a leading 0 or 62.
func PhoneMatchKey(phone string) string {
	return countryPrefix.ReplaceAllString(nonDigits.ReplaceAllString(phone, ""), "")
}

// PhoneMatchKeySQL is phoneMatchKeySql, the SQL twin of PhoneMatchKey.
func PhoneMatchKeySQL(column string) string {
	return `regexp_replace(regexp_replace(COALESCE(` + column + `, ''), '\D', '', 'g'), '^(62|0)', '')`
}

/* ── formatting ──────────────────────────────────────────────────────── */

// LocaleID is Number#toLocaleString("id-ID") for a non-negative amount:
// "." groups thousands, "," separates up to three decimals.
func LocaleID(v float64) string {
	s := strconv.FormatFloat(math.Round(v*1000)/1000, 'f', 3, 64)
	whole, frac, _ := strings.Cut(s, ".")
	n, _ := strconv.ParseInt(whole, 10, 64)
	out := svdomain.GroupThousands(n)
	if frac = strings.TrimRight(frac, "0"); frac != "" {
		out += "," + frac
	}
	return out
}
