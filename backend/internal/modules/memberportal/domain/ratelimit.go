package domain

import (
	"container/list"
	"sync"
	"time"
)

// RateRule is a sliding-window limit.
type RateRule struct {
	Limit  int
	Window time.Duration
}

// Per-IP brakes on top of the per-number and per-code limits
// (MEMBER_IP_LIMITS in otp-store.ts). Loose because a cafe Wi-Fi is shared.
var (
	IPRuleOTP    = RateRule{Limit: 30, Window: 10 * time.Minute}
	IPRuleVerify = RateRule{Limit: 60, Window: 10 * time.Minute}
)

// TooManyFromIP is the per-IP rejection message.
const TooManyFromIP = "Terlalu banyak permintaan dari jaringan ini. Coba lagi beberapa menit lagi"

const maxBuckets = 10_000

type bucket struct {
	key   string
	times []time.Time
}

// RateLimiter is the in-memory sliding window of lib/public/rate-limit.ts:
// per process, oldest bucket evicted past 10 000 keys.
type RateLimiter struct {
	mu      sync.Mutex
	order   *list.List
	buckets map[string]*list.Element
}

// NewRateLimiter builds an empty limiter.
func NewRateLimiter() *RateLimiter {
	return &RateLimiter{order: list.New(), buckets: map[string]*list.Element{}}
}

// Allow records a hit for key at now and reports whether it fits the rule.
func (l *RateLimiter) Allow(key string, rule RateRule, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	el, ok := l.buckets[key]
	if !ok {
		if len(l.buckets) >= maxBuckets {
			if oldest := l.order.Front(); oldest != nil {
				delete(l.buckets, oldest.Value.(*bucket).key)
				l.order.Remove(oldest)
			}
		}
		el = l.order.PushBack(&bucket{key: key})
		l.buckets[key] = el
	}
	b := el.Value.(*bucket)
	cutoff := now.Add(-rule.Window)
	kept := b.times[:0]
	for _, t := range b.times {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	b.times = kept
	if len(b.times) >= rule.Limit {
		return false
	}
	b.times = append(b.times, now)
	return true
}
