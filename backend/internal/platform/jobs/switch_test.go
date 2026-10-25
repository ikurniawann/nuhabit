package jobs_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/jobs"
	"nuhabit/backend/internal/platform/testutil"
)

// A job switched off is skipped on its schedule; a manual run ignores the
// switch and the interval but still waits for the lock.
func TestJobSwitchAndRunNow(t *testing.T) {
	db := testutil.DB(t)
	ctx := context.Background()
	name := "test.switch." + testutil.RandomHex(6)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM platform.job_runs WHERE name = $1`, name)
		_, _ = db.Exec(context.Background(), `DELETE FROM platform.job_settings WHERE name = $1`, name)
	})
	locker := jobs.PostgresLocker{DB: db}
	now := time.Date(2026, 10, 28, 10, 0, 0, 0, time.UTC)

	if on, err := jobs.Enabled(ctx, db, name); err != nil || !on {
		t.Fatalf("job without settings: on=%v err=%v", on, err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO platform.job_settings (name, enabled, config) VALUES ($1, false, '{"graceMinutes": 45}')`, name); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := locker.Acquire(ctx, name, time.Minute, now); err != nil || ok {
		t.Fatalf("switched-off job acquired: ok=%v err=%v", ok, err)
	}
	cfg := struct {
		GraceMinutes int `json:"graceMinutes"`
		Other        int `json:"other"`
	}{GraceMinutes: 30, Other: 7}
	if err := jobs.Config(ctx, db, name, &cfg); err != nil || cfg.GraceMinutes != 45 || cfg.Other != 7 {
		t.Fatalf("config = %+v err=%v", cfg, err)
	}

	ran := 0
	job := jobs.Job{Name: name, Every: time.Hour, Run: func(context.Context, time.Time) error { ran++; return nil }}
	if err := jobs.RunNow(ctx, locker, job, now); err != nil || ran != 1 {
		t.Fatalf("run now: ran=%d err=%v", ran, err)
	}
	// Right after a run, inside the interval, a manual run still goes.
	if err := jobs.RunNow(ctx, locker, job, now.Add(time.Second)); err != nil || ran != 2 {
		t.Fatalf("second run now: ran=%d err=%v", ran, err)
	}
	var succeeded *time.Time
	if err := db.QueryRow(ctx, `SELECT last_succeeded_at FROM platform.job_runs WHERE name = $1`, name).Scan(&succeeded); err != nil || succeeded == nil {
		t.Fatalf("run not recorded: %v %v", succeeded, err)
	}

	// While a run holds the lock a manual run is refused.
	release, ok, err := locker.AcquireNow(ctx, name, now)
	if err != nil || !ok {
		t.Fatalf("acquire now: ok=%v err=%v", ok, err)
	}
	if err := jobs.RunNow(ctx, locker, job, now); !errors.Is(err, jobs.ErrBusy) {
		t.Fatalf("run now while held = %v", err)
	}
	release(nil)

	failing := jobs.Job{Name: name, Every: time.Hour, Run: func(context.Context, time.Time) error { panic("boom") }}
	if err := jobs.RunNow(ctx, locker, failing, now); err == nil || err.Error() != "panic: boom" {
		t.Fatalf("panicking run = %v", err)
	}
}
