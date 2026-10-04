package outbox_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

type sale struct {
	OrderID string `json:"order_id"`
	Total   int64  `json:"total"`
}

func scalar[T any](t *testing.T, q pgx.Tx, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := q.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return v
}

func TestBackoff(t *testing.T) {
	for attempt, want := range map[int]time.Duration{1: 2 * time.Second, 2: 4 * time.Second, 5: 32 * time.Second, 9: 512 * time.Second, 10: 10 * time.Minute, 30: 10 * time.Minute} {
		if got := outbox.Backoff(attempt); got != want {
			t.Errorf("Backoff(%d) = %v, want %v", attempt, got, want)
		}
	}
}

func TestPublishWithoutSubscribersStoresOnlyTheEvent(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	topic := "test.unsubscribed." + testutil.RandomHex(4)
	if err := outbox.Publish(ctx, tx, topic, "k1", sale{OrderID: "o1", Total: 5}); err != nil {
		t.Fatal(err)
	}
	if n := scalar[int](t, tx, `SELECT count(*) FROM platform.outbox_events WHERE topic = $1`, topic); n != 1 {
		t.Fatalf("events = %d", n)
	}
	if n := scalar[int](t, tx, `SELECT count(*) FROM platform.outbox_deliveries d JOIN platform.outbox_events e ON e.id = d.event_id WHERE e.topic = $1`, topic); n != 0 {
		t.Fatalf("deliveries = %d", n)
	}
}

func TestDispatchAppliesHandlerWritesOnce(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `CREATE TEMP TABLE journal (order_id text PRIMARY KEY, total bigint) ON COMMIT DROP`); err != nil {
		t.Fatal(err)
	}
	topic := "test.sale." + testutil.RandomHex(4)
	bus := outbox.NewBus(nil, quiet)
	calls := 0
	bus.Subscribe(topic, topic+".journal", func(ctx context.Context, htx pgx.Tx, e outbox.Event) error {
		calls++
		var s sale
		if err := e.Decode(&s); err != nil {
			return err
		}
		if e.Key != s.OrderID || e.Attempt != 1 {
			t.Errorf("event key %q attempt %d", e.Key, e.Attempt)
		}
		_, err := htx.Exec(ctx, `INSERT INTO journal VALUES ($1, $2)`, s.OrderID, s.Total)
		return err
	})
	if err := bus.Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"o1", "o2"} {
		if err := outbox.Publish(ctx, tx, topic, id, sale{OrderID: id, Total: 1250}); err != nil {
			t.Fatal(err)
		}
	}

	if n, err := bus.Dispatch(ctx, tx); err != nil || n != 2 {
		t.Fatalf("Dispatch = %d, %v", n, err)
	}
	if n, err := bus.Dispatch(ctx, tx); err != nil || n != 0 {
		t.Fatalf("second Dispatch = %d, %v", n, err)
	}
	if calls != 2 || scalar[int](t, tx, `SELECT count(*) FROM journal`) != 2 {
		t.Fatalf("calls = %d", calls)
	}
	if n := scalar[int](t, tx, `SELECT count(*) FROM platform.outbox_deliveries WHERE subscriber = $1 AND delivered_at IS NOT NULL AND attempts = 1`, topic+".journal"); n != 2 {
		t.Fatalf("delivered = %d", n)
	}
}

func TestFailedDeliveryRollsBackAndRetries(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `CREATE TEMP TABLE journal (order_id text) ON COMMIT DROP`); err != nil {
		t.Fatal(err)
	}
	topic := "test.fail." + testutil.RandomHex(4)
	subscriber := topic + ".journal"
	bus := outbox.NewBus(nil, quiet)
	bus.Subscribe(topic, subscriber, func(ctx context.Context, htx pgx.Tx, e outbox.Event) error {
		if _, err := htx.Exec(ctx, `INSERT INTO journal VALUES ($1)`, e.Key); err != nil {
			return err
		}
		return errors.New("ledger closed")
	})
	if err := bus.Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	if err := outbox.Publish(ctx, tx, topic, "o1", sale{OrderID: "o1"}); err != nil {
		t.Fatal(err)
	}

	if n, err := bus.Dispatch(ctx, tx); err != nil || n != 1 {
		t.Fatalf("Dispatch = %d, %v", n, err)
	}
	if scalar[int](t, tx, `SELECT count(*) FROM journal`) != 0 {
		t.Fatal("a failed handler's writes must roll back")
	}
	const state = `SELECT attempts, last_error, next_attempt_at > now(), dead_at IS NOT NULL FROM platform.outbox_deliveries WHERE subscriber = $1`
	var attempts int
	var lastErr string
	var later, dead bool
	if err := tx.QueryRow(ctx, state, subscriber).Scan(&attempts, &lastErr, &later, &dead); err != nil {
		t.Fatal(err)
	}
	if attempts != 1 || lastErr != "ledger closed" || !later || dead {
		t.Fatalf("after first failure: attempts=%d err=%q later=%v dead=%v", attempts, lastErr, later, dead)
	}
	if n, _ := bus.Dispatch(ctx, tx); n != 0 {
		t.Fatal("a delivery waiting for its backoff must not run")
	}

	if _, err := tx.Exec(ctx, `UPDATE platform.outbox_deliveries SET attempts = $2, next_attempt_at = now() - interval '1 second' WHERE subscriber = $1`, subscriber, outbox.MaxAttempts-1); err != nil {
		t.Fatal(err)
	}
	if n, err := bus.Dispatch(ctx, tx); err != nil || n != 1 {
		t.Fatalf("last attempt = %d, %v", n, err)
	}
	if err := tx.QueryRow(ctx, state, subscriber).Scan(&attempts, &lastErr, &later, &dead); err != nil {
		t.Fatal(err)
	}
	if attempts != outbox.MaxAttempts || !dead {
		t.Fatalf("after last attempt: attempts=%d dead=%v", attempts, dead)
	}
	if n, _ := bus.Dispatch(ctx, tx); n != 0 {
		t.Fatal("a dead delivery must not run again")
	}
}

func TestPruneKeepsPendingEvents(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	topic := "test.prune." + testutil.RandomHex(4)
	bus := outbox.NewBus(nil, quiet)
	bus.Subscribe(topic, topic+".sub", func(context.Context, pgx.Tx, outbox.Event) error { return nil })
	if err := bus.Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"done", "pending"} {
		if err := outbox.Publish(ctx, tx, topic, key, sale{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec(ctx, `
UPDATE platform.outbox_deliveries d SET delivered_at = now()
  FROM platform.outbox_events e WHERE e.id = d.event_id AND e.topic = $1 AND e.key = 'done'`, topic); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE platform.outbox_events SET created_at = now() - interval '8 days' WHERE topic = $1`, topic); err != nil {
		t.Fatal(err)
	}
	if err := outbox.Prune(ctx, tx, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if key := scalar[string](t, tx, `SELECT string_agg(key, ',') FROM platform.outbox_events WHERE topic = $1`, topic); key != "pending" {
		t.Fatalf("left = %q", key)
	}
}

func TestRunWakesOnPublish(t *testing.T) {
	db := testutil.DB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	topic := "test.run." + testutil.RandomHex(4)
	subscriber := topic + ".sub"
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = db.Exec(bg, `DELETE FROM platform.outbox_events WHERE topic = $1`, topic)
		_, _ = db.Exec(bg, `DELETE FROM platform.outbox_subscriptions WHERE subscriber = $1`, subscriber)
	})

	got := make(chan string, 1)
	bus := outbox.NewBus(db, quiet)
	bus.Subscribe(topic, subscriber, func(_ context.Context, _ pgx.Tx, e outbox.Event) error {
		got <- e.Key
		return nil
	})
	if err := bus.Register(ctx, db); err != nil {
		t.Fatal(err)
	}
	runCtx, stop := context.WithCancel(ctx)
	done := make(chan error, 1)
	// A long poll proves the NOTIFY from Publish wakes the dispatcher.
	go func() { done <- bus.Run(runCtx, time.Minute, 7*24*time.Hour) }()
	time.Sleep(200 * time.Millisecond)

	if err := outbox.Publish(ctx, db, topic, "o-live", sale{OrderID: "o-live"}); err != nil {
		t.Fatal(err)
	}
	select {
	case key := <-got:
		if key != "o-live" {
			t.Fatalf("key = %q", key)
		}
	case <-ctx.Done():
		t.Fatal("Run did not deliver the event")
	}
	stop()
	if err := <-done; err != nil {
		t.Fatalf("Run = %v", err)
	}
}
