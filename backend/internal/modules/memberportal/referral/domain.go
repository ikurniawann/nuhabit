// Package referral is the member referral program of the member portal:
// every member gets a code, a friend who signs up with it and makes a first
// paid gym purchase earns both sides a reward once the purchase has stayed
// unrefunded through the hold window. The rules here are pure; store.go
// holds the SQL and service.go the use cases.
package referral

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math/big"
	"regexp"
	"strings"
	"time"
)

// Status of a referral.
const (
	// StatusJoined: the friend signed up with the code, no paid purchase yet.
	StatusJoined = "joined"
	// StatusHeld: the first paid purchase is in, waiting out the hold window.
	StatusHeld = "held"
	// StatusRewarded: both sides got their reward.
	StatusRewarded = "rewarded"
	// StatusCapped: the friend got their reward, the referrer was over the
	// monthly cap.
	StatusCapped = "capped"
	// StatusVoid: the purchase was refunded inside the hold window.
	StatusVoid = "void"
	// StatusBlocked: a fraud guard refused it at sign-up.
	StatusBlocked = "blocked"
)

// Statuses lists every status, for filters.
var Statuses = []string{StatusJoined, StatusHeld, StatusRewarded, StatusCapped, StatusVoid, StatusBlocked}

// Block and void reasons.
const (
	ReasonSelf        = "self_referral"
	ReasonSameContact = "same_contact"
	ReasonSameDevice  = "same_device"
	ReasonRefunded    = "refunded"
)

// Settings is the program configuration (crm.referral_settings).
type Settings struct {
	Active             bool    `json:"is_active"`
	ReferrerCredits    int     `json:"referrer_credits"`
	ReferrerArkIdr     float64 `json:"referrer_ark_idr"`
	RefereeCredits     int     `json:"referee_credits"`
	RefereeCampaignID  *string `json:"referee_campaign_id"`
	CreditValidityDays int     `json:"credit_validity_days"`
	HoldDays           int     `json:"hold_days"`
	MonthlyCap         int     `json:"monthly_cap"`
}

// DefaultSettings is the program before anyone configures it: off.
var DefaultSettings = Settings{CreditValidityDays: 30, HoldDays: 7, MonthlyCap: 10}

// Problem returns why the settings cannot be saved, "" when they can. The
// limits match the table's CHECK constraints.
func (s Settings) Problem() string {
	switch {
	case s.ReferrerCredits < 0 || s.ReferrerCredits > 100 || s.RefereeCredits < 0 || s.RefereeCredits > 100:
		return "Kredit bonus harus 0 sampai 100"
	case s.ReferrerArkIdr < 0 || s.ReferrerArkIdr > 10_000_000:
		return "ARK Coin harus 0 sampai 10.000.000"
	case s.CreditValidityDays < 1 || s.CreditValidityDays > 365:
		return "Masa berlaku kredit bonus harus 1 sampai 365 hari"
	case s.HoldDays < 0 || s.HoldDays > 90:
		return "Masa tahan harus 0 sampai 90 hari"
	case s.MonthlyCap < 0 || s.MonthlyCap > 1000:
		return "Batas hadiah per bulan harus 0 sampai 1000"
	case s.Active && s.ReferrerCredits == 0 && s.ReferrerArkIdr == 0 && s.RefereeCredits == 0 && s.RefereeCampaignID == nil:
		return "Program aktif butuh minimal satu hadiah"
	}
	return ""
}

// Party is a member as the fraud guards see it.
type Party struct {
	CustomerID  string
	PhoneDigits string
	Email       string
}

// Screen returns why a referral must be blocked, or "" to accept it:
// a member cannot refer themselves, share a phone number or email with the
// referrer, or sign up from a device the referrer (or an earlier referral)
// used.
func Screen(referrer, referee Party, deviceSeen bool) string {
	switch {
	case referrer.CustomerID == referee.CustomerID:
		return ReasonSelf
	case referrer.PhoneDigits != "" && referrer.PhoneDigits == referee.PhoneDigits,
		referrer.Email != "" && strings.EqualFold(referrer.Email, referee.Email):
		return ReasonSameContact
	case deviceSeen:
		return ReasonSameDevice
	}
	return ""
}

// codeAlphabet leaves out 0, 1, I and O, which read alike.
const codeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

// NewCode is a random member code: NH plus six characters.
func NewCode() (string, error) {
	var b strings.Builder
	b.WriteString("NH")
	for range 6 {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(codeAlphabet))))
		if err != nil {
			return "", err
		}
		b.WriteByte(codeAlphabet[n.Int64()])
	}
	return b.String(), nil
}

var codeShape = regexp.MustCompile(`^[A-Z0-9]{4,16}$`)

// NormalizeCode upper-cases a typed code; "" when it cannot be a code.
func NormalizeCode(raw string) string {
	code := strings.ToUpper(strings.Join(strings.Fields(raw), ""))
	if !codeShape.MatchString(code) {
		return ""
	}
	return code
}

// HashDevice is the stored form of the app's device id; "" for none.
func HashDevice(id string) string {
	id = strings.TrimSpace(id)
	if id == "" || len(id) > 200 {
		return ""
	}
	sum := sha256.Sum256([]byte("referral-device:" + id))
	return hex.EncodeToString(sum[:])
}

// wib is the zone the monthly cap counts in.
var wib = time.FixedZone("WIB", 7*60*60)

// MonthBounds is the WIB calendar month containing t, as [start, end).
func MonthBounds(t time.Time) (start, end time.Time) {
	w := t.In(wib)
	start = time.Date(w.Year(), w.Month(), 1, 0, 0, 0, 0, wib)
	return start, start.AddDate(0, 1, 0)
}

// ParseMonth reads "2026-10" as that WIB month; ok is false otherwise.
func ParseMonth(s string) (start, end time.Time, ok bool) {
	t, err := time.ParseInLocation("2006-01", s, wib)
	if err != nil {
		return time.Time{}, time.Time{}, false
	}
	start, end = MonthBounds(t)
	return start, end, true
}

// CapReached reports whether a referrer with rewarded rewards this month
// gets no more; cap 0 means no cap.
func CapReached(rewarded, monthlyCap int) bool {
	return monthlyCap > 0 && rewarded >= monthlyCap
}

// ShortName is the first name plus the initial of the second, so friends
// lists do not show full names: "Budi Santoso" is "Budi S.".
func ShortName(name string) string {
	parts := strings.Fields(name)
	switch len(parts) {
	case 0:
		return "Member"
	case 1:
		return parts[0]
	}
	return parts[0] + " " + string([]rune(parts[1])[:1]) + "."
}
