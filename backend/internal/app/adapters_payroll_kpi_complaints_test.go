package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// coach_complaint_rate: tickets linked to the coach per 100 attendees of the
// coach's classes in the period, for the employee whose account is the coach.
func TestCoachComplaintRateKPI(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	id := func(sql string, args ...any) string {
		t.Helper()
		var v string
		if err := tx.QueryRow(ctx, sql+" RETURNING id::text", args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	sfx := testutil.RandomHex(4)
	user := id(`INSERT INTO auth.users (email, password_hash) VALUES ($1, 'x')`, sfx+"@kpi.test")
	if _, err := tx.Exec(ctx, `INSERT INTO configuration.users (id, full_name, role) VALUES ($1, 'Coach KPI', 'pos')`, user); err != nil {
		t.Fatal(err)
	}
	employee := id(`INSERT INTO hris.employees (full_name, nip, email, phone, join_date, user_id)
	  VALUES ('Coach KPI', $1, $2, '08', '2030-01-01', $3)`, "KPI"+sfx, sfx+"@kpi.test", user)
	coach := id(`INSERT INTO gym.coaches (name, user_id) VALUES ($1, $2)`, "Coach KPI "+sfx, user)
	idle := id(`INSERT INTO gym.coaches (name) VALUES ($1)`, "Coach Idle "+sfx)
	ct := id(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity) VALUES ($1, 60, 1, 20)`, "KPI "+sfx)
	session := func(coachID, startsAt string) string {
		return id(`INSERT INTO gym.class_sessions (class_type_id, coach_id, starts_at, ends_at, capacity, credit_cost,
		  booking_opens_at, booking_closes_at, status)
		  VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '1 hour', 20, 1, $3::timestamptz - interval '7 days', $3::timestamptz, 'completed')`,
			ct, coachID, startsAt)
	}
	june := session(coach, "2031-06-10 07:00+07")
	may := session(coach, "2031-05-28 07:00+07")
	for i, status := range []string{"checked_in", "completed", "completed", "completed", "no_show"} {
		member := id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Peserta')`, "+6293"+sfx+string(rune('0'+i)))
		for _, s := range []string{june, may} {
			if _, err := tx.Exec(ctx, `INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, $3)`, s, member, status); err != nil {
				t.Fatal(err)
			}
		}
	}
	ticket := func(coachID, createdAt string) {
		t.Helper()
		if _, err := tx.Exec(ctx, `INSERT INTO gym.complaints (code, source, category, title, coach_id, respond_by, resolve_by, created_at)
		  VALUES ($1, 'staff', 'coach', 'x', $2, now(), now(), $3::timestamptz)`, "K-"+testutil.RandomHex(4), coachID, createdAt); err != nil {
			t.Fatal(err)
		}
	}
	// One in June, one on 30 June at 23.30 WIB (still June in Jakarta), one in May.
	ticket(coach, "2031-06-12 10:00+07")
	ticket(coach, "2031-06-30 23:30+07")
	ticket(coach, "2031-05-30 10:00+07")
	ticket(idle, "2031-06-12 10:00+07")

	got, err := payrollKPISQL{}.CoachComplaintRate(ctx, tx, "2031-06-01", "2031-06-30")
	if err != nil {
		t.Fatal(err)
	}
	v, ok := got[employee]
	// 2 tickets / 4 attendees (no-show excluded) x 100.
	if !ok || v.Actual == nil || *v.Actual != 50 || v.SampleSize != 4 || v.Detail.(map[string]any)["complaints"] != 2 {
		t.Fatalf("coach_complaint_rate = %+v (ok %v)", v, ok)
	}

	var weight float64
	if err := tx.QueryRow(ctx, `SELECT ri.weight::float FROM performance.kpi_role_indicators ri
	  JOIN performance.kpi_indicators i ON i.id = ri.indicator_id
	  WHERE i.code = 'coach_complaint_rate' AND i.direction = 'lower_better' AND ri.role_code = 'gym_coach'`).Scan(&weight); err != nil || weight != 15 {
		t.Fatalf("catalogue weight = %v, %v", weight, err)
	}
}
