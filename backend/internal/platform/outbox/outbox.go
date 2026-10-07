// Package outbox carries cross-module effects that may complete after the
// request: a module publishes an event inside its own transaction, and the
// subscribers registered for that topic receive it from a dispatcher.
//
// Delivery is per subscriber. Publish adds one delivery row for every
// subscription registered at that moment, in the publisher's transaction, so
// an event exists exactly when the business change committed. A handler runs
// in the transaction that marks its delivery done: its database writes apply
// exactly once, while effects outside the database (push, HTTP) are
// at-least-once and must be idempotent. Failures retry with backoff and stop
// after MaxAttempts (dead_at is set; the row stays for inspection).
//
// Subscriptions live in platform.outbox_subscriptions. A dispatcher registers
// the subscribers of the modules it mounts, so MODULES=accounting runs only
// accounting's handlers. A subscriber only receives events published after it
// was first registered.
package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/platform/database"
)

// channel is the LISTEN/NOTIFY channel Publish signals on commit.
const channel = "platform_outbox"

// MaxAttempts is how many times a delivery runs before it is marked dead.
const MaxAttempts = 10

// Event is one published fact. Payload is the JSON the publisher passed.
type Event struct {
	ID        int64
	Topic     string
	Key       string
	Payload   json.RawMessage
	CreatedAt time.Time
	Attempt   int // 1 on the first delivery
}

// Decode unmarshals the payload into dst.
func (e Event) Decode(dst any) error { return json.Unmarshal(e.Payload, dst) }

// Handler applies an event. Writes through tx commit with the delivery mark.
type Handler func(ctx context.Context, tx pgx.Tx, e Event) error

// Publish records an event in the caller's transaction. key names the
// aggregate (an order id, an employee id) for logs and ordering by handlers.
func Publish(ctx context.Context, q database.Querier, topic, key string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("outbox: encode %s payload: %w", topic, err)
	}
	_, err = q.Exec(ctx, `
WITH ev AS (
    INSERT INTO platform.outbox_events (topic, key, payload) VALUES ($1, $2, $3) RETURNING id
), deliveries AS (
    INSERT INTO platform.outbox_deliveries (event_id, subscriber)
    SELECT ev.id, s.subscriber FROM ev, platform.outbox_subscriptions s WHERE s.topic = $1
)
SELECT pg_notify($4, $1)`, topic, key, raw, channel)
	if err != nil {
		return fmt.Errorf("outbox: publish %s: %w", topic, err)
	}
	return nil
}

type subscription struct {
	topic   string
	handler Handler
}

// Bus holds this process's subscriptions and dispatches their deliveries.
type Bus struct {
	db    *pgxpool.Pool
	log   *slog.Logger
	now   func() time.Time
	subs  map[string]subscription
	names []string
}

// NewBus returns an empty bus. Modules subscribe from their constructors.
func NewBus(db *pgxpool.Pool, log *slog.Logger) *Bus {
	return &Bus{db: db, log: log, now: time.Now, subs: map[string]subscription{}}
}

// Subscribe registers handler for topic under a stable, globally unique
// subscriber name such as "accounting.journal-on-pos-sale". Renaming a
// subscriber drops its pending deliveries, so treat the name as a contract.
func (b *Bus) Subscribe(topic, subscriber string, h Handler) {
	if _, dup := b.subs[subscriber]; dup {
		panic(fmt.Sprintf("outbox: subscriber %q registered twice", subscriber))
	}
	b.subs[subscriber] = subscription{topic: topic, handler: h}
	b.names = append(b.names, subscriber)
}

// Register upserts this bus's subscriptions so Publish starts creating
// deliveries for them. Run calls it on start; tests call it on their tx.
func (b *Bus) Register(ctx context.Context, q database.Querier) error {
	for _, name := range b.names {
		if _, err := q.Exec(ctx, `
INSERT INTO platform.outbox_subscriptions (subscriber, topic) VALUES ($1, $2)
ON CONFLICT (subscriber) DO UPDATE SET topic = EXCLUDED.topic`, name, b.subs[name].topic); err != nil {
			return fmt.Errorf("outbox: register %s: %w", name, err)
		}
	}
	return nil
}

// Dispatch runs every due delivery for this bus's subscribers, one
// transaction each, and returns how many it attempted. db is the pool in
// production; tests pass an open transaction so nothing persists.
func (b *Bus) Dispatch(ctx context.Context, db database.TxBeginner) (int, error) {
	if len(b.names) == 0 {
		return 0, nil
	}
	n := 0
	for ctx.Err() == nil {
		claimed, err := b.dispatchOne(ctx, db)
		if err != nil || !claimed {
			return n, err
		}
		n++
	}
	return n, ctx.Err()
}

func (b *Bus) dispatchOne(ctx context.Context, db database.TxBeginner) (claimed bool, err error) {
	err = database.WithTx(ctx, db, func(tx pgx.Tx) error {
		var e Event
		var subscriber string
		err := tx.QueryRow(ctx, `
SELECT d.subscriber, d.attempts + 1, e.id, e.topic, e.key, e.payload, e.created_at
  FROM platform.outbox_deliveries d
  JOIN platform.outbox_events e ON e.id = d.event_id
 WHERE d.subscriber = ANY($1) AND d.delivered_at IS NULL AND d.dead_at IS NULL
   AND d.next_attempt_at <= now()
 ORDER BY d.next_attempt_at, d.event_id
 LIMIT 1
   FOR UPDATE OF d SKIP LOCKED`, b.names).Scan(&subscriber, &e.Attempt, &e.ID, &e.Topic, &e.Key, &e.Payload, &e.CreatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		claimed = true
		herr := database.WithTx(ctx, tx, func(htx pgx.Tx) error {
			return b.subs[subscriber].handler(ctx, htx, e)
		})
		if herr == nil {
			_, err = tx.Exec(ctx, `
UPDATE platform.outbox_deliveries SET attempts = $3, delivered_at = now(), last_error = NULL
 WHERE event_id = $1 AND subscriber = $2`, e.ID, subscriber, e.Attempt)
			return err
		}
		b.log.Warn("outbox delivery failed", "subscriber", subscriber, "topic", e.Topic,
			"event_id", e.ID, "attempt", e.Attempt, "error", herr)
		_, err = tx.Exec(ctx, `
UPDATE platform.outbox_deliveries
   SET attempts = $3::int, last_error = $4,
       next_attempt_at = now() + make_interval(secs => $5::float8),
       dead_at = CASE WHEN $3::int >= $6::int THEN now() END
 WHERE event_id = $1 AND subscriber = $2`,
			e.ID, subscriber, e.Attempt, herr.Error(), Backoff(e.Attempt).Seconds(), MaxAttempts)
		return err
	})
	return claimed, err
}

// Backoff is the wait after the given failed attempt: 2s, 4s, 8s … capped
// at 10 minutes.
func Backoff(attempt int) time.Duration {
	d := 2 * time.Second << min(attempt-1, 10)
	return min(d, 10*time.Minute)
}

// Run dispatches until ctx ends: on every NOTIFY from Publish and at least
// every poll interval (retries wake on the poll). It prunes delivered events
// older than retain once an hour.
func (b *Bus) Run(ctx context.Context, poll, retain time.Duration) error {
	if len(b.names) == 0 {
		return nil
	}
	if err := b.Register(ctx, b.db); err != nil {
		return err
	}
	conn, err := b.db.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN "+channel); err != nil {
		return err
	}
	lastPrune := time.Time{}
	for ctx.Err() == nil {
		if _, err := b.Dispatch(ctx, b.db); err != nil && ctx.Err() == nil {
			b.log.Error("outbox dispatch", "error", err)
		}
		if b.now().Sub(lastPrune) >= time.Hour {
			if err := Prune(ctx, b.db, retain); err != nil && ctx.Err() == nil {
				b.log.Error("outbox prune", "error", err)
			}
			lastPrune = b.now()
		}
		waitCtx, cancel := context.WithTimeout(ctx, poll)
		_, err := conn.Conn().WaitForNotification(waitCtx)
		cancel()
		if err != nil && ctx.Err() == nil && !errors.Is(err, context.DeadlineExceeded) {
			return fmt.Errorf("outbox: listen: %w", err)
		}
	}
	return nil
}

// Prune deletes events older than retain whose deliveries all finished
// (delivered or dead). Events nobody subscribed to are pruned too.
func Prune(ctx context.Context, q database.Querier, retain time.Duration) error {
	_, err := q.Exec(ctx, `
DELETE FROM platform.outbox_events e
 WHERE e.created_at < now() - make_interval(secs => $1::float8)
   AND NOT EXISTS (
       SELECT 1 FROM platform.outbox_deliveries d
        WHERE d.event_id = e.id AND d.delivered_at IS NULL AND d.dead_at IS NULL)`, retain.Seconds())
	return err
}
