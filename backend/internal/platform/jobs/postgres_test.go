package jobs_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/jobs"
	"nuhabit/backend/internal/platform/testutil"
)

func TestPostgresLockerSerializesAndSpacesRuns(t *testing.T) {
	db := testutil.DB(t)
	ctx := context.Background()
	name := "test.locker." + testutil.RandomHex(6)
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), `DELETE FROM platform.job_runs WHERE name = $1`, name) })
	locker := jobs.PostgresLocker{DB: db}
	now := time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC)

	release, ok, err := locker.Acquire(ctx, name, time.Minute, now)
	if err != nil || !ok {
		t.Fatalf("first acquire: ok=%v err=%v", ok, err)
	}
	// Another process (another pool connection) cannot run it meanwhile.
	if _, busy, err := locker.Acquire(ctx, name, time.Minute, now.Add(2*time.Minute)); err != nil || busy {
		t.Fatalf("second acquire while held: ok=%v err=%v", busy, err)
	}
	release(errors.New("partial failure"))

	var lastErr *string
	var succeeded *time.Time
	if err := db.QueryRow(ctx, `SELECT last_error, last_succeeded_at FROM platform.job_runs WHERE name = $1`, name).Scan(&lastErr, &succeeded); err != nil {
		t.Fatal(err)
	}
	if lastErr == nil || *lastErr != "partial failure" || succeeded != nil {
		t.Fatalf("after failed run: last_error=%v succeeded=%v", lastErr, succeeded)
	}

	// Not due yet: the last run started 30 s ago.
	if _, ok, err := locker.Acquire(ctx, name, time.Minute, now.Add(30*time.Second)); err != nil || ok {
		t.Fatalf("acquire before interval: ok=%v err=%v", ok, err)
	}
	release, ok, err = locker.Acquire(ctx, name, time.Minute, now.Add(time.Minute))
	if err != nil || !ok {
		t.Fatalf("acquire after interval: ok=%v err=%v", ok, err)
	}
	release(nil)
	if err := db.QueryRow(ctx, `SELECT last_error, last_succeeded_at FROM platform.job_runs WHERE name = $1`, name).Scan(&lastErr, &succeeded); err != nil {
		t.Fatal(err)
	}
	if lastErr != nil || succeeded == nil {
		t.Fatalf("after success: last_error=%v succeeded=%v", lastErr, succeeded)
	}
}

func TestClaimSendOncePerPeriod(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	subject := testutil.RandomHex(8)
	claim := func(period string) bool {
		t.Helper()
		ok, err := jobs.ClaimSend(ctx, tx, "test_kind", subject, period, nil)
		if err != nil {
			t.Fatal(err)
		}
		return ok
	}
	if !claim("2026-10-21") {
		t.Fatal("first claim refused")
	}
	if claim("2026-10-21") {
		t.Fatal("rerun claimed the same period twice")
	}
	if !claim("2026-10-22") {
		t.Fatal("a new period was refused")
	}
}
