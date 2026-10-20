package gymscheduling

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
)

// Booking decisions against the database: credit reservation, booking caps,
// pass strikes, waitlist offers and promotion.

// setRules merges keys into the global rule row inside the test transaction.
func (f *fixture) setRules(keys map[string]any) {
	f.t.Helper()
	raw, _ := json.Marshal(keys)
	f.exec(`UPDATE gym.business_rules SET rules = rules || $1::jsonb WHERE branch_id IS NULL`, string(raw))
}

// service is a Service on the fixture's transaction, for calls with no route.
func (f *fixture) service(notifier Notifier) *Service {
	return NewService(f.tx, Postgres{}, Ports{
		Credits: f.credits, Packages: f.credits, Passes: f.credits, Rules: f.credits,
		Members: MembersSQL{}, Qr: QrTokensSQL{}, Notifier: notifier,
	}, nil)
}

func (f *fixture) book(customerID, sessionID string) response {
	f.t.Helper()
	return f.asMember(customerID, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": sessionID})
}

func (f *fixture) bookingStatus(id string) string {
	f.t.Helper()
	return f.scalar(`SELECT status FROM gym.bookings WHERE id = $1`, id)
}

// wibDayAt is hour:00 WIB, days from today.
func wibDayAt(days, hour int) time.Time {
	start, _ := domain.WibDayBounds(time.Now())
	return start.Add(time.Duration(days)*24*time.Hour + time.Duration(hour)*time.Hour)
}

func TestCreditReservation(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(2)
	first := f.session(typeID, wibDayAt(2, 10), 5)
	second := f.session(typeID, wibDayAt(3, 10), 5)
	m := f.member(3)

	res := f.book(m, first)
	if res.data()["status"] != "confirmed" {
		t.Fatalf("first booking: %s", res.Raw)
	}
	// 3 credits, 2 reserved by the first booking: 1 left for a 2-credit class.
	expectError(t, f.book(m, second), 409,
		"Kredit tidak cukup untuk kelas ini: tersedia 1, butuh 2 (2 kredit sudah terpakai untuk booking lain)")

	f.asMember(m, "DELETE", "/api/member-portal/gym/bookings/"+res.data()["bookingId"].(string), nil)
	if res := f.book(m, second); res.data()["status"] != "confirmed" {
		t.Fatalf("booking after the reservation is released: %s", res.Raw)
	}
}

func TestBookingLimits(t *testing.T) {
	f := newFixture(t)
	f.setRules(map[string]any{"maxConcurrentBookings": 2, "maxBookingsPerDay": 1})
	typeID, _ := f.classType(1)
	holder := f.member(0)
	f.passFor(holder, 30)

	morning := f.session(typeID, wibDayAt(1, 8), 5)
	evening := f.session(typeID, wibDayAt(1, 18), 5)
	dayTwo := f.session(typeID, wibDayAt(2, 8), 5)
	dayThree := f.session(typeID, wibDayAt(3, 8), 5)

	if res := f.book(holder, morning); res.data()["status"] != "confirmed" {
		t.Fatalf("first class: %s", res.Raw)
	}
	expectError(t, f.book(holder, evening), 409, "Batas booking tercapai: maksimal 1 kelas per hari")
	if res := f.book(holder, dayTwo); res.data()["status"] != "confirmed" {
		t.Fatalf("next day: %s", res.Raw)
	}
	expectError(t, f.book(holder, dayThree), 409, "Batas booking aktif tercapai: maksimal 2 kelas mendatang")

	// Staff booking follows the same caps.
	expectError(t, f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": dayThree, "customer_id": holder}), 409,
		"Batas booking aktif tercapai: maksimal 2 kelas mendatang")
}

func TestPassStrikesSuspendBooking(t *testing.T) {
	f := newFixture(t)
	f.setRules(map[string]any{"strikeLimit": 2, "strikeWindowDays": 30, "strikeSuspendDays": 7, "maxBookingsPerDay": 0})
	rules, err := f.credits.ForBranch(f.ctx, f.tx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if rules.CancellationDeadlineHours == 0 || rules.LateCancelPolicy != domain.PolicyForfeit {
		t.Skip("late cancels are free in this database")
	}
	typeID, _ := f.classType(1)
	holder := f.member(0)
	f.passFor(holder, 30)
	late := func(offset time.Duration) string {
		id := f.session(typeID, time.Now().Add(time.Duration(rules.CancellationDeadlineHours)*time.Hour-offset), 5)
		return f.book(holder, id).data()["bookingId"].(string)
	}

	// Staff can waive: late, but no strike.
	waived := late(30 * time.Minute)
	res := f.asStaff("POST", "/api/gym/bookings/"+waived, map[string]any{"action": "cancel", "waive_penalty": true})
	if d := res.data(); d["late"] != true || d["passStrike"] != false {
		t.Fatalf("waived cancel: %s", res.Raw)
	}
	expectError(t, f.asStaff("POST", "/api/gym/bookings/"+waived, map[string]any{"action": "cancel", "waive_penalty": "ya"}), 400,
		"Data tidak valid: waive_penalty")

	for _, offset := range []time.Duration{40 * time.Minute, 50 * time.Minute} {
		id := late(offset)
		if res := f.asMember(holder, "DELETE", "/api/member-portal/gym/bookings/"+id, nil); res.data()["pass_strike"] != true {
			t.Fatalf("late cancel: %s", res.Raw)
		}
	}
	res = f.book(holder, f.session(typeID, wibDayAt(2, 9), 5))
	if res.Status != 409 || !strings.HasPrefix(res.Body["error"].(string), "Booking ditangguhkan sampai ") {
		t.Fatalf("suspended booking: %s", res.Raw)
	}

	phone := f.scalar(`SELECT phone FROM pos.pos_customers WHERE id = $1`, holder)
	hits := f.asStaff("GET", "/api/gym/bookings/members?q="+strings.TrimPrefix(phone, "+"), nil).list()
	if len(hits) != 1 {
		t.Fatalf("member search: %v", hits)
	}
	hit := hits[0].(map[string]any)
	// The strikes behind the suspension are spent, so the count starts again.
	if hit["pass_strikes"] != float64(0) || !jsDate.MatchString(hit["suspended_until"].(string)) {
		t.Fatalf("search hit: %v", hit)
	}
}

func TestWaitlistOfferHoldsSeatAndLapses(t *testing.T) {
	f := newFixture(t)
	f.setRules(map[string]any{"waitlistAutoPromote": false, "waitlistOfferMinutes": 30})
	typeID, _ := f.classType(1)
	sessionID := f.session(typeID, time.Now().Add(72*time.Hour), 1)
	a, b, c := f.member(3), f.member(3), f.member(3)

	bookingA := f.book(a, sessionID).data()["bookingId"].(string)
	bookingB := f.book(b, sessionID).data()["bookingId"].(string)
	res := f.asMember(a, "DELETE", "/api/member-portal/gym/bookings/"+bookingA, nil)
	if res.Status != 200 {
		t.Fatalf("cancel A: %s", res.Raw)
	}
	if got := f.scalar(`SELECT status || ':' || (promotion_expires_at IS NOT NULL)::text FROM gym.bookings WHERE id = $1`, bookingB); got != "waitlist:true" {
		t.Fatalf("B should hold an offer, got %s", got)
	}

	// The offered seat is held: a new booker joins the waitlist.
	res = f.book(c, sessionID)
	if res.data()["status"] != "waitlist" || res.data()["waitlistPosition"] != float64(2) {
		t.Fatalf("C while the offer is open: %s", res.Raw)
	}
	bookingC := res.data()["bookingId"].(string)
	if got := f.scalar(`SELECT status FROM gym.class_sessions WHERE id = $1`, sessionID); got != "full" {
		t.Fatalf("an open offer fills the session, got %s", got)
	}

	// The sweep lapses B's offer, offers the seat to C and puts B back in
	// the queue at their old position.
	svc := f.service(NotificationsSQL{})
	if err := svc.SweepWaitlistOffers(f.ctx, time.Now().Add(31*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := f.scalar(`SELECT status || ':' || waitlist_position || ':' || offer_lapses || ':' || (promotion_offered_at IS NULL)::text
		FROM gym.bookings WHERE id = $1`, bookingB); got != "waitlist:1:1:true" {
		t.Fatalf("B after the sweep: %s", got)
	}
	if n := f.scalar(`SELECT count(*)::text FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_waitlist_offer_expired'`, b); n != "1" {
		t.Fatalf("lapse notifications = %s", n)
	}
	expectError(t, f.asMember(b, "POST", "/api/member-portal/gym/bookings/"+bookingB, map[string]any{"action": "confirm_offer"}), 409,
		"Belum ada kursi yang ditawarkan untuk Anda di kelas ini")
	if res := f.asMember(c, "POST", "/api/member-portal/gym/bookings/"+bookingC, map[string]any{"action": "confirm_offer"}); res.data()["status"] != "confirmed" {
		t.Fatalf("C accepts: %s", res.Raw)
	}
	if f.bookingStatus(bookingC) != "confirmed" {
		t.Fatalf("C = %s", f.bookingStatus(bookingC))
	}
}

func TestWaitlistOfferInsideCutoffAndAfterClose(t *testing.T) {
	f := newFixture(t)
	f.setRules(map[string]any{"waitlistAutoPromote": true, "waitlistPromoteCutoffMin": 60, "cancellationDeadlineHours": 0})
	typeID, _ := f.classType(1)
	sessionID := f.session(typeID, time.Now().Add(45*time.Minute), 1)
	a, b := f.member(3), f.member(3)
	bookingA := f.book(a, sessionID).data()["bookingId"].(string)
	bookingB := f.book(b, sessionID).data()["bookingId"].(string)

	res := f.asStaff("POST", "/api/gym/bookings/"+bookingA, map[string]any{"action": "cancel"})
	if p, _ := res.data()["promoted"].(map[string]any); p == nil || p["mode"] != "offer" || p["customerId"] != b {
		t.Fatalf("inside the cutoff the seat is offered: %s", res.Raw)
	}
	if f.bookingStatus(bookingB) != "waitlist" {
		t.Fatalf("B = %s", f.bookingStatus(bookingB))
	}

	f.exec(`UPDATE gym.class_sessions SET booking_closes_at = now() - interval '1 minute' WHERE id = $1`, sessionID)
	expectError(t, f.asMember(b, "POST", "/api/member-portal/gym/bookings/"+bookingB, map[string]any{"action": "confirm_offer"}), 409,
		"Booking kelas ini sudah ditutup")
}

func TestWaitlistPromotionRechecksEligibility(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(2)
	sessionID := f.session(typeID, wibDayAt(3, 10), 1)
	other := f.session(typeID, wibDayAt(4, 10), 5)
	a, b, c := f.member(5), f.member(2), f.member(5)

	bookingA := f.book(a, sessionID).data()["bookingId"].(string)
	bookingB := f.book(b, sessionID).data()["bookingId"].(string)
	bookingC := f.book(c, sessionID).data()["bookingId"].(string)
	// B's 2 credits now go to another class, so B cannot take the seat.
	if res := f.book(b, other); res.data()["status"] != "confirmed" {
		t.Fatalf("B books another class: %s", res.Raw)
	}

	res := f.asMember(a, "DELETE", "/api/member-portal/gym/bookings/"+bookingA, nil)
	if res.Status != 200 {
		t.Fatalf("cancel A: %s", res.Raw)
	}
	if f.bookingStatus(bookingB) != "waitlist" || f.bookingStatus(bookingC) != "confirmed" {
		t.Fatalf("B = %s, C = %s", f.bookingStatus(bookingB), f.bookingStatus(bookingC))
	}
	body := f.scalar(`SELECT body FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_waitlist_skipped'`, b)
	if !strings.Contains(body, "Kredit tidak cukup untuk kelas ini: tersedia 0, butuh 2") {
		t.Fatalf("skip notification: %q", body)
	}
}

func TestCapacityIncreasePromotesWaitlist(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(1)
	sessionID := f.session(typeID, time.Now().Add(72*time.Hour), 1)
	f.book(f.member(3), sessionID)
	b := f.book(f.member(3), sessionID).data()["bookingId"].(string)
	c := f.book(f.member(3), sessionID).data()["bookingId"].(string)

	if res := f.asStaff("PATCH", "/api/gym/sessions/"+sessionID, map[string]any{"capacity": 3}); res.Status != 200 {
		t.Fatalf("raise capacity: %s", res.Raw)
	}
	if f.bookingStatus(b) != "confirmed" || f.bookingStatus(c) != "confirmed" {
		t.Fatalf("B = %s, C = %s", f.bookingStatus(b), f.bookingStatus(c))
	}
	if got := f.scalar(`SELECT status FROM gym.class_sessions WHERE id = $1`, sessionID); got != "full" {
		t.Fatalf("session = %s", got)
	}
}

func TestNoShowWaitsForTheClass(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(1)
	sessionID := f.session(typeID, time.Now().Add(2*time.Hour), 3)
	id := f.book(f.member(3), sessionID).data()["bookingId"].(string)
	expectError(t, f.asStaff("POST", "/api/gym/bookings/"+id, map[string]any{"action": "no_show"}), 409,
		"Kelas belum dimulai; tandai tidak hadir setelah kelas mulai")
}

// brokenNotifier fails with a SQL error, which aborts the transaction it
// runs in unless the caller isolated it.
type brokenNotifier struct{}

func (brokenNotifier) NotifyMember(ctx context.Context, q database.Querier, _ string, _ Notification) error {
	_, err := q.Exec(ctx, `SELECT 1 / 0`)
	return err
}

func TestNotificationFailureKeepsTheBooking(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(1)
	sessionID := f.session(typeID, time.Now().Add(48*time.Hour), 3)
	m := f.member(3)
	out, err := f.service(brokenNotifier{}).BookSession(f.ctx, m, sessionID, "member")
	if err != nil {
		t.Fatalf("book with a failing notifier: %v", err)
	}
	if f.bookingStatus(out.BookingID) != "confirmed" {
		t.Fatalf("booking = %s", f.bookingStatus(out.BookingID))
	}
}
