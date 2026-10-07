package domain

import (
	"regexp"
	"time"
)

var portalTokenPattern = regexp.MustCompile(`(?i)^[a-f0-9]{48,128}$`)

// IsPortalToken reports whether s looks like a candidate portal link token
// (psikotes, interview, offer): 48 to 128 hex characters.
func IsPortalToken(s string) bool { return portalTokenPattern.MatchString(s) }

// Fallback link lifetimes when expires_at is NULL (a link never lives forever).
const (
	SessionLinkLifetime = 14 * 24 * time.Hour // psikotes and interview sessions
	OfferLinkLifetime   = 30 * 24 * time.Hour
)

// IsLinkExpired is isLinkExpired: expires_at decides, else issued_at plus
// maxLifetime (issued_at NULL counts as the epoch). Millisecond precision,
// like Date.getTime().
func IsLinkExpired(expiresAt, issuedAt *time.Time, maxLifetime time.Duration, now time.Time) bool {
	var expires int64
	switch {
	case expiresAt != nil:
		expires = expiresAt.UnixMilli()
	case issuedAt != nil:
		expires = issuedAt.UnixMilli() + maxLifetime.Milliseconds()
	default:
		expires = maxLifetime.Milliseconds()
	}
	return expires < now.UnixMilli()
}

// TooManyRequests is TOO_MANY_REQUESTS of route-helpers.ts.
const TooManyRequests = "Terlalu banyak permintaan, coba lagi sebentar lagi"

// Rate limit defaults of lib/rate-limit.ts: a fixed window that resets one
// minute after its first hit.
const (
	DefaultRateLimit = 100
	RateWindow       = time.Minute
)
