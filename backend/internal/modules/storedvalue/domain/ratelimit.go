package domain

import (
	"sync"
	"time"
)

// RateWindow is RATE_LIMIT_WINDOW in lib/rate-limit.ts.
const RateWindow = time.Minute

// RateLimiter is the in-memory fixed window of lib/rate-limit.ts
// (checkRateLimit): per process, one counter per key that resets one
// minute after its first hit.
type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]rateEntry
}

type rateEntry struct {
	count   int
	resetAt time.Time
}

// NewRateLimiter builds an empty limiter.
func NewRateLimiter() *RateLimiter { return &RateLimiter{entries: map[string]rateEntry{}} }

// Allow records a hit for key and reports whether it is within limit.
func (l *RateLimiter) Allow(key string, limit int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok || now.After(e.resetAt) {
		l.entries[key] = rateEntry{count: 1, resetAt: now.Add(RateWindow)}
		return true
	}
	if e.count >= limit {
		return false
	}
	e.count++
	l.entries[key] = e
	return true
}
