package domain

import (
	"sync"
	"time"
)

// rateWindow is RATE_LIMIT_WINDOW of lib/rate-limit.ts.
const rateWindow = time.Minute

// maxRateKeys bounds memory; expired windows are swept past it.
const maxRateKeys = 10_000

type rateEntry struct {
	count int
	reset time.Time
}

// RateLimiter is checkRateLimit (lib/rate-limit.ts): a per-process fixed
// one-minute window per key.
type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rateEntry
}

// NewRateLimiter builds an empty limiter.
func NewRateLimiter() *RateLimiter { return &RateLimiter{entries: map[string]*rateEntry{}} }

// Allow counts a hit for key and reports whether it is within limit.
func (l *RateLimiter) Allow(key string, limit int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok || now.After(e.reset) {
		if len(l.entries) >= maxRateKeys {
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
