package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymloyalty"
	"nuhabit/backend/internal/modules/gymscheduling"
	memberdomain "nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/modules/possales/tableorder"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// Membership tier perks and member status through the real wiring: gym
// scheduling reads them from gym-loyalty through its TierPerks port, POS
// merges the tier discount with the XP tier discount, and attendance XP
// lands in the CRM ledger on channel "gym".
func TestMembershipPerksInBookingGateAndPOS(t *testing.T) {
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
	exec(`UPDATE gym.business_rules SET rules = rules || '{"cancellationDeadlineHours": 4, "bookingOpensDaysBefore": 7,
		"bookingClosesMinBefore": 0, "maxConcurrentBookings": 0, "maxBookingsPerDay": 0, "waitlistAutoPromote": true,
		"waitlistPromoteCutoffMin": 0, "lateCancelPolicy": "forfeit", "requireWaiver": true}'::jsonb WHERE branch_id IS NULL`)
	sched := gymscheduling.NewService(tx, gymscheduling.Postgres{}, schedulingPortsOn(d, tx), now)

	silver := scalar(`INSERT INTO gym.membership_tiers (name, min_spend_idr, discount_percent, waitlist_priority)
		VALUES ('Silver '||$1, 5000000, 5, true) RETURNING id::text`, sfx)
	gold := scalar(`INSERT INTO gym.membership_tiers (name, min_spend_idr, discount_percent, early_booking_days, cancel_window_hours, waitlist_priority)
		VALUES ('Gold '||$1, 10000000, 12, 2, 2, true) RETURNING id::text`, sfx)
	classType := scalar(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ($1, 60, 1, 10) RETURNING id::text`, "Kelas Tier "+sfx)
	member := func(name string, tierID *string) string {
		id := scalar(`INSERT INTO pos.pos_customers (phone, name, waiver_version, waiver_accepted_at)
			VALUES ($1, $2, $3, now()) RETURNING id::text`, "+6295"+testutil.RandomHex(4), name+" "+sfx, memberdomain.WaiverVersion)
		lot := scalar(`INSERT INTO gym.credit_lots (customer_id, credits, expires_at) VALUES ($1, 10, now() + interval '60 days') RETURNING id::text`, id)
		exec(`INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id, source_type) VALUES ($1, 'top_up', 10, $2, 'admin')`, id, lot)
		if tierID != nil {
			exec(`INSERT INTO gym.member_memberships (customer_id, tier_id, valid_until, spend_12m, evaluated_on)
				VALUES ($1, $2, current_date + 365, 0, current_date)`, id, *tierID)
		}
		return id
	}
	session := func(startsAt time.Time, capacity int) string {
		return scalar(`INSERT INTO gym.class_sessions (class_type_id, starts_at, ends_at, capacity, credit_cost, booking_opens_at, booking_closes_at, status)
			VALUES ($1, $2, $3, $4, 1, $5, $2, 'published') RETURNING id::text`,
			classType, startsAt, startsAt.Add(time.Hour), capacity, startsAt.Add(-7*24*time.Hour))
	}
	code := func(err error) string {
		var he *httpx.Error
		if errors.As(err, &he) {
			return he.Code
		}
		return ""
	}

	goldMember, plain := member("Gold", &gold), member("Biasa", nil)

	// Booking opens two days earlier for Gold: eight days out it is open
	// for them and not yet for everyone else.
	early := session(clock.Add(8*24*time.Hour+time.Hour), 10)
	if res, err := sched.BookSession(ctx, goldMember, early, "member"); err != nil || res.Status != "confirmed" {
		t.Fatalf("gold early booking: %+v %v", res, err)
	}
	if _, err := sched.BookSession(ctx, plain, early, "member"); code(err) != "BOOKING_BOOKING_NOT_OPEN_YET" {
		t.Fatalf("plain early booking: %v", err)
	}

	// Three hours before class: late under the 4-hour branch rule, free
	// under Gold's 2-hour window.
	soon := session(clock.Add(3*time.Hour), 10)
	goldBooking, err := sched.BookSession(ctx, goldMember, soon, "member")
	if err != nil {
		t.Fatal(err)
	}
	plainBooking, err := sched.BookSession(ctx, plain, soon, "member")
	if err != nil {
		t.Fatal(err)
	}
	if out, err := sched.CancelBooking(ctx, goldBooking.BookingID, goldMember, false); err != nil || out.Late || out.PenaltyCredits != 0 {
		t.Fatalf("gold cancel: %+v %v", out, err)
	}
	if out, err := sched.CancelBooking(ctx, plainBooking.BookingID, plain, false); err != nil || !out.Late || out.PenaltyCredits != 1 {
		t.Fatalf("plain cancel: %+v %v", out, err)
	}

	// Waitlist: the freed seat goes to the highest tier rank, then FIFO.
	full := session(clock.Add(48*time.Hour), 1)
	holder, first, silverMember, goldLate := member("Pemegang", nil), member("Pertama", nil), member("Perak", &silver), member("Emas", &gold)
	seat, err := sched.BookSession(ctx, holder, full, "member")
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range []string{first, silverMember, goldLate} {
		if res, err := sched.BookSession(ctx, m, full, "member"); err != nil || res.Status != "waitlist" {
			t.Fatalf("waitlist: %+v %v", res, err)
		}
	}
	out, err := sched.CancelBooking(ctx, seat.BookingID, holder, false)
	if err != nil || out.Promoted == nil || out.Promoted.CustomerID != goldLate {
		t.Fatalf("promotion: %+v %v", out.Promoted, err)
	}

	// A banned member cannot book and is turned away at the gate.
	banned := member("Dilarang", &gold)
	exec(`INSERT INTO gym.member_status (customer_id, status, reason) VALUES ($1, 'banned', 'Merusak alat')`, banned)
	if _, err := sched.BookSession(ctx, banned, early, "member"); code(err) != "BOOKING_MEMBER_BANNED" {
		t.Fatalf("banned booking: %v", err)
	}
	gateSession := session(clock.Add(10*time.Minute), 10)
	exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, gateSession, banned)
	token := "nhqr_" + testutil.RandomHex(8)
	exec(`INSERT INTO crm.member_qr_tokens (token, customer_id, expires_at) VALUES ($1, $2, $3)`, token, banned, clock.Add(5*time.Minute))
	res, err := sched.ScanQr(ctx, token, nil, nil)
	if err != nil || res.Decision != "denied" || res.Reason == nil || *res.Reason != "member_banned" {
		t.Fatalf("banned scan: %+v %v", res, err)
	}
	if got := scalar(`SELECT reason FROM gym.access_logs WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, banned); got != "member_banned" {
		t.Fatalf("access log reason = %s", got)
	}

	// POS: the better of the XP tier discount (seeded gold: 10% from 30.000
	// XP) and the membership tier discount; none when frozen.
	pos := memberDiscountCRM{CRM: tableorder.DefaultCRM(), loyalty: gymloyalty.NewService(tx, gymloyalty.Ports{}, now, d.Log)}
	xpGold := member("XP Gold", &silver)
	exec(`UPDATE pos.pos_customers SET total_xp = 30000 WHERE id = $1`, xpGold)
	for id, want := range map[string]float64{goldMember: 12, xpGold: 10, plain: 0, banned: 0} {
		if got := pos.MemberDiscountPercent(ctx, tx, id); got != want {
			t.Errorf("discount for %s = %v, want %v", id, got, want)
		}
	}

	// Attendance XP posts to the CRM ledger and pos_customers.total_xp.
	exec(`UPDATE gym.bookings SET status = 'checked_in', checked_in_at = $2 WHERE session_id = $1 AND customer_id = $3`, full, clock, goldLate)
	exec(`UPDATE gym.class_sessions SET starts_at = $2, ends_at = $3 WHERE id = $1`, full, clock.Add(-time.Hour), clock)
	loyalty := gymloyalty.NewService(tx, loyaltyPorts(d), now, d.Log)
	if err := loyalty.SweepAttendance(ctx, clock); err != nil {
		t.Fatal(err)
	}
	if got := scalar(`SELECT source_channel || ':' || source_type || ':' || xp_delta FROM crm.crm_xp_ledger
		WHERE customer_id = $1 AND idempotency_key LIKE 'gym:attend:%'`, goldLate); got != "gym:class_attended:50" {
		t.Fatalf("ledger = %s", got)
	}
	if got := scalar(`SELECT COALESCE(total_xp, 0)::text FROM pos.pos_customers WHERE id = $1`, goldLate); got != "50" {
		t.Fatalf("total_xp = %s", got)
	}
	view, err := loyalty.Progress(ctx, goldLate)
	if err != nil || view.XP.LifetimeXP != 50 || len(view.History) == 0 || view.XP.Tier == nil {
		t.Fatalf("progress: %+v %v", view, err)
	}
}
