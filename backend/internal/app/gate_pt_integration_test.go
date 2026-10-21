package app

import (
	"context"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymcoaching"
	"nuhabit/backend/internal/modules/gymscheduling"
	memberdomain "nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// The gate admits a member for a confirmed PT session through the real
// wiring: gym-scheduling scans, gym-coaching checks the participant in and
// charges the PT credits, and the sweep closes the session afterwards. The
// clock starts just after the real time, because re-entry reads the access log's
// created_at.
func TestGateChecksInPersonalTraining(t *testing.T) {
	clock := time.Now().Add(2 * time.Second).Truncate(time.Second)
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
	gate := gymscheduling.NewService(tx, gymscheduling.Postgres{}, schedulingPortsOn(d, tx), now)
	coaching := gymcoaching.NewService(tx, coachingPortsOn(d, tx), now, d.Log)

	coach := scalar(`INSERT INTO gym.coaches (name) VALUES ($1) RETURNING id::text`, "Coach Gate "+sfx)
	coach2 := scalar(`INSERT INTO gym.coaches (name) VALUES ($1) RETURNING id::text`, "Coach Gate 2 "+sfx)
	ptType := scalar(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity, is_personal)
	                  VALUES ($1, 60, 1, 1, true) RETURNING id::text`, "PT Gate "+sfx)
	groupType := scalar(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
	                     VALUES ($1, 60, 1, 10) RETURNING id::text`, "Kelas Gate "+sfx)
	ptPackage := scalar(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days, applicable_class_type_ids)
	                     VALUES ($1, 10, 1, 120, ARRAY[$2::uuid]) RETURNING id::text`, "Paket PT Gate "+sfx, ptType)
	grant := func(customerID string, pkg *string, n int) {
		lot := scalar(`INSERT INTO gym.credit_lots (customer_id, package_id, credits, expires_at) VALUES ($1, $2, $3, now() + interval '1 year') RETURNING id::text`, customerID, pkg, n)
		exec(`INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id, source_type) VALUES ($1, 'top_up', $2, $3, 'admin')`, customerID, n, lot)
	}
	member := func(name string, ptCredits int) string {
		id := scalar(`INSERT INTO pos.pos_customers (phone, name, waiver_version, waiver_accepted_at)
		              VALUES ($1, $2, $3, now()) RETURNING id::text`, "+6296"+testutil.RandomHex(4), name+" "+sfx, memberdomain.WaiverVersion)
		if ptCredits > 0 {
			grant(id, &ptPackage, ptCredits)
		}
		return id
	}
	scan := func(customerID string) gymscheduling.CheckInResult {
		t.Helper()
		token := "nhqr_" + testutil.RandomHex(8)
		exec(`INSERT INTO crm.member_qr_tokens (token, customer_id, expires_at) VALUES ($1, $2, $3)`, token, customerID, clock.Add(5*time.Minute))
		res, err := gate.ScanQr(ctx, token, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	book := func(coachID, customerID string, start time.Time) string {
		t.Helper()
		id, err := coaching.Book(ctx, gymcoaching.BookInput{
			CoachID: coachID, ClassTypeID: ptType, StartsAt: start, CustomerIDs: []string{customerID}, ActorID: "6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11",
		})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	entry := func(res gymscheduling.CheckInResult) string {
		if res.EntryKind == nil {
			return ""
		}
		return string(*res.EntryKind)
	}

	// Alice scans 20 minutes before her PT session: checked in, one PT credit charged.
	alice := member("Alice", 2)
	appt := book(coach, alice, clock.Add(20*time.Minute))
	res := scan(alice)
	if res.Decision != "allowed" || entry(res) != "pt" || res.CreditsDeducted != 1 || res.Booking == nil || res.Booking.SessionID != appt ||
		res.Message != "Check-in PT PT Gate "+sfx+" · 1 kredit dipotong · sisa 1 kredit" {
		t.Fatalf("scan: %+v", res)
	}
	participant := scalar(`SELECT id::text FROM gym.pt_participants WHERE appointment_id = $1`, appt)
	if got := scalar(`SELECT entry_kind || ':' || credit_delta || ':' || COALESCE(pt_participant_id::text, '-') FROM gym.access_logs
	                  WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, alice); got != "pt:-1:"+participant {
		t.Fatalf("access log = %s", got)
	}
	if got := scalar(`SELECT (checked_in_at IS NOT NULL)::text || ':' || credits_charged || ':' || status FROM gym.pt_participants WHERE id = $1`, participant); got != "true:1:confirmed" {
		t.Fatalf("participant = %s", got)
	}
	if got := scalar(`SELECT title FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_checked_in'`, alice); got != "Check-in PT: PT Gate "+sfx {
		t.Fatalf("notification = %s", got)
	}
	// Scanning again inside the grace is a re-entry, not a second charge.
	if res := scan(alice); res.Decision != "allowed" || entry(res) != "re_entry" {
		t.Fatalf("second scan: %+v", res)
	}

	// Budi has a class starting sooner than his PT: the class wins.
	budi := member("Budi", 1)
	grant(budi, nil, 1)
	session := scalar(`INSERT INTO gym.class_sessions (class_type_id, starts_at, ends_at, capacity, credit_cost, booking_opens_at, booking_closes_at, status)
	                   VALUES ($1, $2, $3, 10, 1, $2, $2, 'published') RETURNING id::text`, groupType, clock.Add(10*time.Minute), clock.Add(70*time.Minute))
	exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, session, budi)
	book(coach2, budi, clock.Add(40*time.Minute))
	if res := scan(budi); res.Decision != "allowed" || entry(res) != "booking" {
		t.Fatalf("class before PT: %+v", res)
	}

	// Citra was booked by hand without PT credits: the gate stays shut.
	citra := member("Citra", 0)
	short := scalar(`INSERT INTO gym.pt_appointments (coach_id, class_type_id, starts_at, ends_at, capacity, credit_cost, status, source)
	                 VALUES ($1, $2, $3, $4, 1, 1, 'confirmed', 'staff') RETURNING id::text`, coach, ptType, clock.Add(90*time.Minute), clock.Add(150*time.Minute))
	exec(`INSERT INTO gym.pt_participants (appointment_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, short, citra)
	clock = clock.Add(60 * time.Minute)
	if res := scan(citra); res.Decision != "denied" || res.Reason == nil || *res.Reason != "insufficient_credits" {
		t.Fatalf("short PT credits: %+v", res)
	}

	// The sweep closes ended sessions: Alice attended, Dewi never scanned,
	// Citra's session is still ahead.
	dewi := member("Dewi", 2)
	missed := book(coach, dewi, clock.Add(-150*time.Minute))
	clock = clock.Add(110 * time.Minute)
	if err := coaching.CompletePastAppointments(ctx, clock); err != nil {
		t.Fatal(err)
	}
	outcome := func(id string) string {
		return scalar(`SELECT a.status || ':' || p.status || ':' || p.credits_charged
		                 FROM gym.pt_appointments a JOIN gym.pt_participants p ON p.appointment_id = a.id WHERE a.id = $1`, id)
	}
	if got := outcome(appt); got != "completed:completed:1" {
		t.Fatalf("alice after sweep = %s", got)
	}
	if got := scalar(`SELECT count(*)::text FROM gym.credit_ledger WHERE customer_id = $1 AND amount < 0`, alice); got != "1" {
		t.Fatalf("alice charged %s times, want once", got)
	}
	if got := outcome(missed); got != "completed:no_show:1" {
		t.Fatalf("dewi after sweep = %s", got)
	}
	if got := outcome(short); got != "confirmed:confirmed:0" {
		t.Fatalf("a session still ahead stays open: %s", got)
	}
}
