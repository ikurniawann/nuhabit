package jobs

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/platform/database"
)

// PostgresLocker holds a session advisory lock per job on a dedicated pool
// connection for the length of a run, and records runs in platform.job_runs.
// The two-key form (hashtext('jobs'), hashtext(name)) keeps job locks apart
// from the single-key locks other code takes. A job switched off in
// platform.job_settings is skipped like one that is not due.
type PostgresLocker struct{ DB *pgxpool.Pool }

var (
	_ Locker    = PostgresLocker{}
	_ NowLocker = PostgresLocker{}
)

func (l PostgresLocker) Acquire(ctx context.Context, name string, every time.Duration, now time.Time) (func(error), bool, error) {
	return l.acquire(ctx, name, every, now, false)
}

// AcquireNow takes the lock for a manual run: the interval and the switch
// do not apply.
func (l PostgresLocker) AcquireNow(ctx context.Context, name string, now time.Time) (func(error), bool, error) {
	return l.acquire(ctx, name, 0, now, true)
}

func (l PostgresLocker) acquire(ctx context.Context, name string, every time.Duration, now time.Time, manual bool) (func(error), bool, error) {
	conn, err := l.DB.Acquire(ctx)
	if err != nil {
		return nil, false, err
	}
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtext('jobs'), hashtext($1))`, name).Scan(&locked); err != nil {
		conn.Release()
		return nil, false, err
	}
	if !locked {
		conn.Release()
		return nil, false, nil
	}
	unlock := func() {
		_, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(hashtext('jobs'), hashtext($1))`, name)
		conn.Release()
	}
	if !manual {
		on, err := Enabled(ctx, conn, name)
		if err != nil || !on {
			unlock()
			return nil, false, err
		}
	}
	var last *time.Time
	err = conn.QueryRow(ctx, `SELECT last_started_at FROM platform.job_runs WHERE name = $1`, name).Scan(&last)
	if err != nil && !database.IsNoRows(err) {
		unlock()
		return nil, false, err
	}
	if !manual && !Due(last, now, every) {
		unlock()
		return nil, false, nil
	}
	if _, err := conn.Exec(ctx, `
INSERT INTO platform.job_runs (name, last_started_at) VALUES ($1, $2)
ON CONFLICT (name) DO UPDATE SET last_started_at = EXCLUDED.last_started_at`, name, now); err != nil {
		unlock()
		return nil, false, err
	}
	release := func(runErr error) {
		var msg *string
		if runErr != nil {
			s := runErr.Error()
			msg = &s
		}
		_, _ = conn.Exec(context.WithoutCancel(ctx), `
UPDATE platform.job_runs
   SET last_finished_at = now(), last_error = $2,
       last_succeeded_at = CASE WHEN $2::text IS NULL THEN now() ELSE last_succeeded_at END
 WHERE name = $1`, name, msg)
		unlock()
	}
	return release, true, nil
}

// Enabled reports whether the job's switch in platform.job_settings is on;
// a job without a row is on.
func Enabled(ctx context.Context, q database.Querier, name string) (bool, error) {
	on := true
	err := q.QueryRow(ctx, `SELECT enabled FROM platform.job_settings WHERE name = $1`, name).Scan(&on)
	if database.IsNoRows(err) {
		return true, nil
	}
	return on, err
}

// Config decodes the job's settings (platform.job_settings.config) into
// dst; keys the row does not set keep the values dst holds.
func Config(ctx context.Context, q database.Querier, name string, dst any) error {
	var raw []byte
	err := q.QueryRow(ctx, `SELECT config FROM platform.job_settings WHERE name = $1`, name).Scan(&raw)
	if database.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, dst)
}

// ClaimSend records that the reminder (kind, subjectID, period) goes out,
// in the caller's transaction. false means an earlier run already sent it.
// Write the notification in the same transaction so a failed send rolls the
// claim back and the next run retries it.
func ClaimSend(ctx context.Context, q database.Querier, kind, subjectID, period string, customerID *string) (bool, error) {
	tag, err := q.Exec(ctx, `
INSERT INTO platform.reminder_sends (kind, subject_id, period, customer_id) VALUES ($1, $2, $3, $4)
ON CONFLICT DO NOTHING`, kind, subjectID, period, customerID)
	return tag.RowsAffected() == 1, err
}
