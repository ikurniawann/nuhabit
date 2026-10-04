// Package kit holds the small transport helpers every pos-sales handler
// shares: the POS session guard, the in-memory rate limiter of
// lib/rate-limit.ts and the `{ success:false, error }` bodies the TS routes
// write by hand.
package kit

import (
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

// PosUser mirrors getPosSession: a staff session with a grant under the "pos"
// menu prefix. A missing session or a missing grant are both 401
// "Authentication required" (the TS helper swallows 401/403 into null).
func PosUser(a *auth.Service, r *http.Request) (*auth.User, error) {
	u, err := a.RequireMenuPrefix(r, iam.Pos...)
	if err != nil {
		var he *httpx.Error
		if errors.As(err, &he) && (he.Status == http.StatusUnauthorized || he.Status == http.StatusForbidden) {
			return nil, httpx.Unauthorized("Authentication required")
		}
		return nil, err
	}
	return u, nil
}

// Fail writes `{ success:false, error:msg }` with status.
func Fail(w http.ResponseWriter, status int, msg string) error {
	return httpx.JSON(w, status, struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}{false, msg})
}

// ErrorMessage is `error instanceof Error ? error.message : 'Unknown error'`
// for the routes that leak the message in their 500 body. A PostgreSQL error
// yields its bare message, as node-postgres puts it in error.message.
func ErrorMessage(err error) string {
	if err == nil {
		return "Unknown error"
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return pg.Message
	}
	return err.Error()
}

// RateLimiter is the fixed-window limiter of lib/rate-limit.ts: per process,
// a window of one minute starting at the first hit of a key.
type RateLimiter struct {
	mu      sync.Mutex
	now     func() time.Time
	entries map[string]*rateEntry
}

type rateEntry struct {
	count int
	reset time.Time
}

// rateWindow is RATE_LIMIT_WINDOW.
const rateWindow = time.Minute

// maxEntries bounds the map; expired entries are swept when it fills.
const maxEntries = 10_000

// NewRateLimiter builds a limiter on the given clock (nil = time.Now).
func NewRateLimiter(now func() time.Time) *RateLimiter {
	if now == nil {
		now = time.Now
	}
	return &RateLimiter{now: now, entries: map[string]*rateEntry{}}
}

// Allow is checkRateLimit(key, limit).allowed.
func (l *RateLimiter) Allow(key string, limit int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	e, ok := l.entries[key]
	if !ok || now.After(e.reset) {
		if !ok && len(l.entries) >= maxEntries {
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
