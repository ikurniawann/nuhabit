package domain

import (
	"regexp"
	"strings"
	"time"
)

// PassField is the ticketing.ticket_season_passes column a scanned code
// matches.
type PassField string

const (
	ByAccessToken PassField = "access_token"
	ByPassCode    PassField = "pass_code"
	ByBandUID     PassField = "band_uid"
)

// PassKey is a normalised scan: which column to match and the value.
type PassKey struct {
	Field PassField
	Value string
}

var (
	hex64     = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
	passCode  = regexp.MustCompile(`(?i)^SP-`)
	nonHexRun = regexp.MustCompile(`[^0-9a-fA-F]`)
)

// ParsePassCode classifies a trimmed, non-empty scan: a 64-hex QR access
// token (lower-cased), an "SP-" pass code (upper-cased), or else a wristband
// UID with every non-hex character removed (upper-cased).
func ParsePassCode(raw string) PassKey {
	switch {
	case hex64.MatchString(raw):
		return PassKey{ByAccessToken, strings.ToLower(raw)}
	case passCode.MatchString(raw):
		return PassKey{ByPassCode, strings.ToUpper(raw)}
	}
	return PassKey{ByBandUID, strings.ToUpper(nonHexRun.ReplaceAllString(raw, ""))}
}

// SeasonPass is the pass row the lookup reads; dates are YYYY-MM-DD.
type SeasonPass struct {
	PassCode              string
	HolderName            string
	Status                string
	ValidFrom, ValidUntil *string
	MemberDiscountPercent float64
	ProductName           string
}

// PassDenied is a lookup that grants no discount.
type PassDenied struct {
	Found    bool    `json:"found"`
	Reason   string  `json:"reason"`
	PassCode *string `json:"pass_code,omitempty"`
}

// PassFound is an active pass inside its validity window.
type PassFound struct {
	Found           bool    `json:"found"`
	PassCode        string  `json:"pass_code"`
	HolderName      string  `json:"holder_name"`
	ProductName     string  `json:"product_name"`
	DiscountPercent float64 `json:"discount_percent"`
	ValidUntil      *string `json:"valid_until"`
}

// TodayInJakarta is todayInJakarta: the Asia/Jakarta calendar date.
func TodayInJakarta(now time.Time) string { return now.In(WIB).Format(time.DateOnly) }

// EvaluatePass grants the member discount only to an active pass whose
// validity window contains today (YYYY-MM-DD). It returns a PassDenied or a
// PassFound.
func EvaluatePass(p *SeasonPass, today string) any {
	switch {
	case p == nil:
		return PassDenied{Reason: "Pass tidak ditemukan"}
	case p.Status != "active":
		return PassDenied{Reason: "Pass " + p.Status, PassCode: &p.PassCode}
	case p.ValidFrom != nil && *p.ValidFrom != "" && today < *p.ValidFrom,
		p.ValidUntil != nil && *p.ValidUntil != "" && today > *p.ValidUntil:
		return PassDenied{Reason: "Pass di luar masa berlaku", PassCode: &p.PassCode}
	}
	return PassFound{
		Found:           true,
		PassCode:        p.PassCode,
		HolderName:      p.HolderName,
		ProductName:     p.ProductName,
		DiscountPercent: p.MemberDiscountPercent,
		ValidUntil:      p.ValidUntil,
	}
}
