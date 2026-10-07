package database_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

func TestWithTxOnPoolAndNested(t *testing.T) {
	db := testutil.DB(t)
	ctx := context.Background()
	table := "go_tx_test_" + testutil.RandomHex(4)
	if _, err := db.Exec(ctx, "CREATE TABLE public."+table+" (n int)"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DROP TABLE public."+table) })
	count := func(q database.Querier) int {
		var n int
		if err := q.QueryRow(ctx, "SELECT count(*) FROM public."+table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Pool: commit and rollback.
	if err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "INSERT INTO public."+table+" VALUES (1)")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	boom := errors.New("boom")
	if err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		_, _ = tx.Exec(ctx, "INSERT INTO public."+table+" VALUES (2)")
		return boom
	}); !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	if n := count(db); n != 1 {
		t.Fatalf("pool rows = %d", n)
	}

	// Nested inside an outer tx: inner commit is a savepoint, outer rollback wins.
	outer, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.WithTx(ctx, outer, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "INSERT INTO public."+table+" VALUES (3)")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	_ = database.WithTx(ctx, outer, func(tx pgx.Tx) error {
		_, _ = tx.Exec(ctx, "INSERT INTO public."+table+" VALUES (4)")
		return boom
	})
	if n := count(outer); n != 2 {
		t.Fatalf("outer sees %d rows, want 2 (savepoint rollback)", n)
	}
	_ = outer.Rollback(ctx)
	if n := count(db); n != 1 {
		t.Fatalf("after outer rollback rows = %d", n)
	}
}
