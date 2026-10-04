// Package domain holds the pure rules of the CRM members area: the member
// row shapes of lib/crm/member-rows.ts and the small helpers the member
// detail pages share (phone normalization, id checks, JS Number()).
package domain

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// CustomerColumns is POS_CUSTOMER_COLUMNS read with numbers as float8, the
// value toNumber() would produce.
const CustomerColumns = `id::text, name, phone, email, membership_tier, ark_coin_balance::float8,
	total_xp::float8, total_spent::float8, visit_count::float8, is_active`

// Customer is one pos_customers row (CustomerRow). Nil numbers are NULL.
type Customer struct {
	ID             string
	Name           *string
	Phone          *string
	Email          *string
	MembershipTier *string
	ArkCoinBalance *float64
	TotalXP        *float64
	TotalSpent     *float64
	VisitCount     *float64
	IsActive       *bool
	// Detail-only columns.
	IsKol              *bool
	KolMonthlyLimitIdr *float64
}

// ScanTargets returns the scan destinations for CustomerColumns.
func (c *Customer) ScanTargets() []any {
	return []any{&c.ID, &c.Name, &c.Phone, &c.Email, &c.MembershipTier, &c.ArkCoinBalance,
		&c.TotalXP, &c.TotalSpent, &c.VisitCount, &c.IsActive}
}

// NormalizedCustomer mirrors normalizeCustomer's result.
type NormalizedCustomer struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Phone          string  `json:"phone"`
	Email          string  `json:"email"`
	MembershipTier string  `json:"membership_tier"`
	ArkCoinBalance float64 `json:"ark_coin_balance"`
	TotalXP        float64 `json:"total_xp"`
	TotalSpent     float64 `json:"total_spent"`
	VisitCount     float64 `json:"visit_count"`
	IsActive       bool    `json:"is_active"`
}

// DetailCustomer mirrors detailCustomer: the KOL flag and monthly limit
// follow the normalized fields.
type DetailCustomer struct {
	NormalizedCustomer
	IsKol              bool     `json:"is_kol"`
	KolMonthlyLimitIdr *float64 `json:"kol_monthly_limit_idr"`
}

func str(p *string, def string) string {
	if p == nil {
		return def
	}
	return *p
}

func num(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// NormalizeCustomer fills the defaults the member screens expect.
func NormalizeCustomer(c Customer) NormalizedCustomer {
	return NormalizedCustomer{
		ID:             c.ID,
		Name:           str(c.Name, ""),
		Phone:          str(c.Phone, ""),
		Email:          str(c.Email, ""),
		MembershipTier: str(c.MembershipTier, "regular"),
		ArkCoinBalance: num(c.ArkCoinBalance),
		TotalXP:        num(c.TotalXP),
		TotalSpent:     num(c.TotalSpent),
		VisitCount:     num(c.VisitCount),
		IsActive:       c.IsActive == nil || *c.IsActive,
	}
}

// NewDetailCustomer mirrors detailCustomer.
func NewDetailCustomer(c Customer) DetailCustomer {
	return DetailCustomer{
		NormalizedCustomer: NormalizeCustomer(c),
		IsKol:              c.IsKol != nil && *c.IsKol,
		KolMonthlyLimitIdr: c.KolMonthlyLimitIdr,
	}
}

// SyntheticTier is the {code, name} tier of a member without a CRM profile.
type SyntheticTier struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// SyntheticBase mirrors syntheticMemberBase: a POS customer shown as member
// "pos-<id>".
type SyntheticBase struct {
	ID           string        `json:"id"`
	CustomerID   string        `json:"customer_id"`
	MemberCode   string        `json:"member_code"`
	Tier         SyntheticTier `json:"tier"`
	LifetimeXP   float64       `json:"lifetime_xp"`
	LoyaltyScore float64       `json:"loyalty_score"`
}

// NewSyntheticBase mirrors syntheticMemberBase.
func NewSyntheticBase(c NormalizedCustomer) SyntheticBase {
	code := c.Phone
	if code == "" {
		code = firstUTF16Units(c.ID, 8)
	}
	return SyntheticBase{
		ID:           "pos-" + c.ID,
		CustomerID:   c.ID,
		MemberCode:   code,
		Tier:         SyntheticTier{Code: c.MembershipTier, Name: c.MembershipTier},
		LifetimeXP:   c.TotalXP,
		LoyaltyScore: c.TotalXP,
	}
}

// ActiveStatus is the synthetic member status.
func ActiveStatus(c NormalizedCustomer) string {
	if c.IsActive {
		return "active"
	}
	return "inactive"
}

// firstUTF16Units is s.slice(0, n) for the ASCII ids it is used on.
func firstUTF16Units(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// uuidV1to5 is UUID_V1_5 in member-profile-server.ts.
var uuidV1to5 = regexp.MustCompile(`^(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// IsUUIDv1to5 reports whether id is a version 1-5 UUID.
func IsUUIDv1to5(id string) bool { return uuidV1to5.MatchString(id) }

// CustomerIDOf mirrors customerIdOf: "pos-<id>" becomes <id>.
func CustomerIDOf(id string) string {
	if strings.HasPrefix(id, "pos-") {
		return strings.Replace(id, "pos-", "", 1)
	}
	return id
}

var nonDigit = regexp.MustCompile(`\D`)

// NormalizePhoneDigits mirrors normalizePhoneDigits (member-portal/phone.ts):
// digits in 62xxx form, or "" when the length is not 10 to 15 digits.
func NormalizePhoneDigits(phone string) string {
	digits := nonDigit.ReplaceAllString(phone, "")
	if digits == "" {
		return ""
	}
	if strings.HasPrefix(digits, "0") {
		digits = "62" + digits[1:]
	}
	if len(digits) < 10 || len(digits) > 15 {
		return ""
	}
	return digits
}

// SamePhoneSQL mirrors samePhoneSql (campaigns-server.ts): both sides
// compared in 62xxx digit form.
func SamePhoneSQL(a, b string) string {
	norm := func(col string) string {
		return `regexp_replace(regexp_replace(` + col + `, '\D', '', 'g'), '^0', '62')`
	}
	return norm(a) + " = " + norm(b)
}

var jsDecimal = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)

// JSNumber is Number(s) for a query-string value: NaN when it is not a
// number literal.
func JSNumber(s string) float64 {
	s = strings.TrimSpace(s)
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(s) > 2 && s[0] == '0' {
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]
		if base != 0 {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	if !jsDecimal.MatchString(s) {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// JSString is String(n) for the values a LIMIT can take.
func JSString(n float64) string {
	switch {
	case math.IsNaN(n):
		return "NaN"
	case math.IsInf(n, 1):
		return "Infinity"
	case math.IsInf(n, -1):
		return "-Infinity"
	}
	return strconv.FormatFloat(n, 'f', -1, 64)
}

// ListLimit mirrors Math.min(Number(limit || 50), 200).
func ListLimit(raw string) float64 {
	if raw == "" {
		return 50
	}
	n := JSNumber(raw)
	if math.IsNaN(n) {
		return n
	}
	return math.Min(n, 200)
}
