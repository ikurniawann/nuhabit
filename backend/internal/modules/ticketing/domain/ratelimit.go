package domain

import (
	"sync"
	"time"
)

// RateLimiter is lib/rate-limit.ts checkRateLimit: an in-memory fixed
// one-minute window per key. Each process keeps its own counts, as each
// Next.js instance does.
type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]rateEntry
}

type rateEntry struct {
	count int
	reset time.Time
}

const rateWindow = time.Minute

// NewRateLimiter returns an empty limiter.
func NewRateLimiter() *RateLimiter { return &RateLimiter{entries: map[string]rateEntry{}} }

// Allow counts one request for key and reports whether it fits limit.
func (l *RateLimiter) Allow(key string, limit int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok || now.After(e.reset) {
		l.entries[key] = rateEntry{count: 1, reset: now.Add(rateWindow)}
		return true
	}
	if e.count >= limit {
		return false
	}
	e.count++
	l.entries[key] = e
	return true
}
