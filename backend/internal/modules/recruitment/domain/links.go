package domain

import (
	"regexp"
	"sync"
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

// Rate limit defaults of lib/rate-limit.ts.
const (
	DefaultRateLimit = 100
	rateWindow       = time.Minute
)

type rateEntry struct {
	count int
	reset time.Time
}

// RateLimiter is the fixed one-minute window of lib/rate-limit.ts, per
// process. Expired entries are swept when the map grows.
type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rateEntry
}

// NewRateLimiter builds an empty limiter.
func NewRateLimiter() *RateLimiter { return &RateLimiter{entries: map[string]*rateEntry{}} }

// Allow is checkRateLimit(key, limit).allowed.
func (l *RateLimiter) Allow(key string, limit int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok || now.After(e.reset) {
		if len(l.entries) > 10_000 {
			for k, v := range l.entries {
				if now.After(v.reset) {
					delete(l.entries, k)
				}
			}
		}
		l.entries[key] = &rateEntry{count: 1, reset: now.Add(rateWindow)}
		return true
	}
	if e.count >= limit {
		return false
	}
	e.count++
	return true
}

// Headers is getRateLimitHeaders: limit and remaining always against the
// default 100, reset in epoch milliseconds.
func (l *RateLimiter) Headers(key string, now time.Time) (limit, remaining int, reset int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok {
		return DefaultRateLimit, DefaultRateLimit, now.Add(rateWindow).UnixMilli()
	}
	return DefaultRateLimit, max(0, DefaultRateLimit-e.count), e.reset.UnixMilli()
}
