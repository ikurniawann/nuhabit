package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymcare"
	caredomain "nuhabit/backend/internal/modules/gymcare/domain"
	"nuhabit/backend/internal/modules/gymscheduling"
	memberdomain "nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// With requireParq on, booking needs a current PAR-Q declaration through
// the real wiring: gym-scheduling asks gym-care. Without the rule nothing
// changes; an expired declaration counts as none.
func TestBookingRequiresParq(t *testing.T) {
	clock := time.Now().Truncate(time.Second)
	now := func() time.Time { return clock }
	d := testutil.Deps(t, now)
	tx := testutil.Tx(t)
	ctx := context.Background()
	sfx := testutil.RandomHex(4)
	scalar := func(sql string, args ...any) string {
		t.Helper()
		var v string
		if err := tx.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	sched := gymscheduling.NewService(tx, gymscheduling.Postgres{}, schedulingPortsOn(d, tx), now)
	care := gymcare.NewService(tx, now)

	classType := scalar(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
	                     VALUES ($1, 60, 1, 10) RETURNING id::text`, "Kelas PAR-Q "+sfx)
	session := func(days int) string {
		start := clock.AddDate(0, 0, days)
		return scalar(`INSERT INTO gym.class_sessions (class_type_id, starts_at, ends_at, capacity, credit_cost, booking_opens_at, booking_closes_at, status)
		               VALUES ($1, $2, $3, 10, 1, $4, $2, 'published') RETURNING id::text`, classType, start, start.Add(time.Hour), clock.Add(-time.Hour))
	}
	member := scalar(`INSERT INTO pos.pos_customers (phone, name, waiver_version, waiver_accepted_at)
	                  VALUES ($1, $2, $3, now()) RETURNING id::text`, "+6295"+testutil.RandomHex(4), "PAR-Q "+sfx, memberdomain.WaiverVersion)
	lot := scalar(`INSERT INTO gym.credit_lots (customer_id, credits, expires_at) VALUES ($1, 10, now() + interval '1 year') RETURNING id::text`, member)
	exec(`INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id, source_type) VALUES ($1, 'top_up', 10, $2, 'admin')`, member, lot)
	setParq := func(on bool) {
		exec(`UPDATE gym.business_rules SET rules = rules || jsonb_build_object('requireParq', $1::boolean) WHERE branch_id IS NULL`, on)
	}
	day := 0
	book := func() error {
		day++
		_, err := sched.BookSession(ctx, member, session(day), "member")
		return err
	}
	denied := func(err error) bool {
		var e *httpx.Error
		return errors.As(err, &e) && e.Code == "BOOKING_PARQ_REQUIRED" && e.Status == 409
	}

	setParq(false)
	if err := book(); err != nil {
		t.Fatalf("rule off: %v", err)
	}

	setParq(true)
	if err := book(); !denied(err) {
		t.Fatalf("no declaration: %v", err)
	}

	// A declaration from 13 months ago has expired.
	old := clock.AddDate(-1, -1, 0)
	exec(`INSERT INTO gym.health_declarations (customer_id, version, answers, has_yes, submitted_at, expires_at)
	      VALUES ($1, $2, '{}', false, $3, $4)`, member, caredomain.ParqVersion, old, caredomain.ParqExpiry(old))
	if err := book(); !denied(err) {
		t.Fatalf("expired declaration: %v", err)
	}

	all := caredomain.ParqAnswers{}
	for _, q := range caredomain.ParqQuestions {
		all[q.Code] = false
	}
	if _, err := care.SubmitParq(ctx, member, all, ""); err != nil {
		t.Fatal(err)
	}
	if err := book(); err != nil {
		t.Fatalf("current declaration: %v", err)
	}
}
