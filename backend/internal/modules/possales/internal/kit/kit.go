// Package kit holds the small transport helpers every pos-sales handler
// shares: the POS session guard, the shared rate limiter of
// lib/rate-limit.ts and the `{ success:false, error }` bodies the TS routes
// write by hand.
package kit

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/ratelimit"
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

// RateLimiter is the fixed-window limiter of lib/rate-limit.ts: a window of
// one minute starting at the first hit of a key, counted in
// platform.rate_limits so every replica shares it.
type RateLimiter struct {
	l   *ratelimit.Limiter
	now func() time.Time
}

// rateWindow is RATE_LIMIT_WINDOW.
const rateWindow = time.Minute

// NewRateLimiter builds a limiter on db and the given clock (nil = time.Now).
func NewRateLimiter(db database.Querier, now func() time.Time) *RateLimiter {
	if now == nil {
		now = time.Now
	}
	return &RateLimiter{l: ratelimit.New(db), now: now}
}

// Allow is checkRateLimit(key, limit).allowed.
func (l *RateLimiter) Allow(ctx context.Context, key string, limit int) (bool, error) {
	w, err := l.l.Fixed(ctx, key, limit, rateWindow, l.now())
	return w.Allowed, err
}
