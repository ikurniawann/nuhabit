// Package ratelimit counts request hits in platform.rate_limits, so every API
// replica enforces one shared limit per key. Each hit is a single upsert: the
// row lock taken by ON CONFLICT serialises concurrent hits on a key.
//
// Two window shapes match the TS limiters:
//   - Fixed is lib/rate-limit.ts checkRateLimit: a counter that resets one
//     window after its first hit.
//   - Sliding is lib/public/rate-limit.ts checkRateLimit and the reward
//     redeem brake: the hits inside the trailing window. A refused hit is not
//     recorded.
//
// Rows expire one window after their last use; Prune deletes expired rows
// and the limiter runs it at most once a minute per process. Expiry follows
// the caller's clock, so a test pinning time never sees its rows pruned.
package ratelimit

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

const pruneEvery = time.Minute

// Limiter is safe for concurrent use. db is the pool in production; tests
// may pass a transaction.
type Limiter struct {
	db         database.Querier
	lastPruned atomic.Int64 // unix nanoseconds
}

// New returns a limiter on db.
func New(db database.Querier) *Limiter { return &Limiter{db: db} }

// Window is the state of a fixed window after a hit.
type Window struct {
	Allowed bool
	Count   int       // hits counted in the window, at most the limit
	ResetAt time.Time // when the window starts over
}

// Fixed records a hit for key at now unless the window already holds limit
// hits.
func (l *Limiter) Fixed(ctx context.Context, key string, limit int, window time.Duration, now time.Time) (Window, error) {
	l.maybePrune(ctx, now)
	var w Window
	err := l.db.QueryRow(ctx, `
INSERT INTO platform.rate_limits AS r (key, count, last_allowed, expires_at)
VALUES ($1, 1, true, $3)
ON CONFLICT (key) DO UPDATE SET
    count = CASE WHEN $2 > r.expires_at THEN 1 WHEN r.count >= $4 THEN r.count ELSE r.count + 1 END,
    last_allowed = $2 > r.expires_at OR r.count < $4,
    expires_at = CASE WHEN $2 > r.expires_at THEN $3 ELSE r.expires_at END
RETURNING last_allowed, count, expires_at`, key, now, now.Add(window), limit).Scan(&w.Allowed, &w.Count, &w.ResetAt)
	return w, err
}

// Peek reads a fixed window's count and reset without counting a hit; nil
// when the key has no row.
func (l *Limiter) Peek(ctx context.Context, key string) (*Window, error) {
	var w Window
	err := l.db.QueryRow(ctx, `SELECT count, expires_at FROM platform.rate_limits WHERE key = $1`, key).Scan(&w.Count, &w.ResetAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}

// Sliding records a hit for key at now when fewer than limit hits fall
// inside the trailing window. A refusal returns how long until the oldest
// counted hit leaves the window.
func (l *Limiter) Sliding(ctx context.Context, key string, limit int, window time.Duration, now time.Time) (allowed bool, retryAfter time.Duration, err error) {
	l.maybePrune(ctx, now)
	var oldest time.Time
	err = l.db.QueryRow(ctx, `
INSERT INTO platform.rate_limits AS r (key, hits, last_allowed, expires_at)
VALUES ($1, ARRAY[$2::timestamptz], true, $4)
ON CONFLICT (key) DO UPDATE SET
    last_allowed = (SELECT count(*) FROM unnest(r.hits) h WHERE h > $3) < $5,
    hits = ARRAY(SELECT h FROM unnest(r.hits) h WHERE h > $3)
        || CASE WHEN (SELECT count(*) FROM unnest(r.hits) h WHERE h > $3) < $5
                THEN ARRAY[$2::timestamptz] ELSE ARRAY[]::timestamptz[] END,
    expires_at = $4
RETURNING last_allowed, (SELECT min(h) FROM unnest(hits) h)`,
		key, now, now.Add(-window), now.Add(window), limit).Scan(&allowed, &oldest)
	if err != nil || allowed {
		return allowed, 0, err
	}
	return false, oldest.Add(window).Sub(now), nil
}

// Prune deletes rows whose window ended before now, skipping rows another
// hit holds.
func (l *Limiter) Prune(ctx context.Context, now time.Time) error {
	_, err := l.db.Exec(ctx, `
DELETE FROM platform.rate_limits WHERE key IN (
    SELECT key FROM platform.rate_limits WHERE expires_at < $1 FOR UPDATE SKIP LOCKED)`, now)
	return err
}

// maybePrune runs Prune when this process has not pruned in the last
// minute. A failed prune is retried a minute later; it never fails a hit.
func (l *Limiter) maybePrune(ctx context.Context, now time.Time) {
	wall := time.Now().UnixNano()
	last := l.lastPruned.Load()
	if wall-last < int64(pruneEvery) || !l.lastPruned.CompareAndSwap(last, wall) {
		return
	}
	_ = l.Prune(ctx, now)
}
