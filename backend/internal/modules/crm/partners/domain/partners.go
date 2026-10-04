// Package domain holds the pure partner loyalty rules (port of
// lib/crm/partners.ts and partner-types.ts): secrets, member matching and
// the fate of an incoming event.
package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"regexp"
	"slices"
	"strings"
)

// PartnerTypes are the allowed partner_type values.
var PartnerTypes = []string{"photobooth", "studio_game", "other"}

// PartnerXPCap is the most XP one event may give: more is a bug or an attack.
const PartnerXPCap = 1000

// GenerateSecret is 32 random bytes as hex, shown to the admin once.
func GenerateSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// HashSecret fills the legacy secret_hash column (identification only).
func HashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// MatchCandidate is a member a subject may point at.
type MatchCandidate struct {
	CustomerID string
	Email      *string
	Phone      *string
}

var nonDigit = regexp.MustCompile(`\D`)

func digits(s string) string { return nonDigit.ReplaceAllString(s, "") }

func tail8(s string) string {
	d := digits(s)
	if len(d) > 8 {
		return d[len(d)-8:]
	}
	return d
}

// MatchSubject finds the member a partner means: email first, then phone by
// the last 8 digits (so +6281… equals 081…), never by name. A phone that
// matches more than one member stays unmatched.
func MatchSubject(subject string, candidates []MatchCandidate) string {
	needle := strings.ToLower(strings.TrimSpace(subject))
	if needle == "" {
		return ""
	}
	for _, c := range candidates {
		if c.Email != nil && strings.ToLower(strings.TrimSpace(*c.Email)) == needle {
			return c.CustomerID
		}
	}
	if strings.Contains(needle, "@") || len(digits(needle)) < 8 {
		return ""
	}
	tail := tail8(needle)
	var found []string
	for _, c := range candidates {
		if c.Phone != nil && tail8(*c.Phone) == tail && !slices.Contains(found, c.CustomerID) {
			found = append(found, c.CustomerID)
		}
	}
	if len(found) == 1 {
		return found[0]
	}
	return ""
}

// PhoneTail is the last 8 digits of a phone subject (the SQL prefilter), or
// nil for emails and short numbers.
func PhoneTail(subject string) *string {
	d := digits(subject)
	if strings.Contains(subject, "@") || len(d) < 8 {
		return nil
	}
	t := d[len(d)-8:]
	return &t
}

// Partner is what an event decision reads.
type Partner struct {
	IsActive   bool
	AwardsXP   bool
	XPPerEvent float64
}

// Decision is the event's status and the XP it earns.
type Decision struct {
	Status string // processed | unmatched | ignored
	XP     int
}

// DecideEvent: no member is unmatched (queued for manual matching), an
// inactive partner is ignored, else processed with XP only when the partner
// is trusted to award it, clamped to [0, PartnerXPCap].
func DecideEvent(p Partner, matched bool) Decision {
	if !matched {
		return Decision{Status: "unmatched"}
	}
	if !p.IsActive {
		return Decision{Status: "ignored"}
	}
	if !p.AwardsXP {
		return Decision{Status: "processed"}
	}
	return Decision{Status: "processed", XP: int(math.Min(PartnerXPCap, math.Max(0, math.Floor(p.XPPerEvent))))}
}

// LedgerChannel is the XP ledger channel of a partner type: the ledger has
// no "other" channel, so other partners post as manual.
func LedgerChannel(partnerType string) string {
	if partnerType == "photobooth" || partnerType == "studio_game" {
		return partnerType
	}
	return "manual"
}
