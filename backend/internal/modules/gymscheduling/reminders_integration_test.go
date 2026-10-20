package gymscheduling

import (
	"testing"
	"time"
)

func TestClassReminders(t *testing.T) {
	f := newFixture(t)
	typeID, typeName := f.classType(1)
	start := time.Now().Add(90 * time.Minute).Truncate(time.Minute)
	soon := f.session(typeID, start, 5)
	later := f.session(typeID, time.Now().Add(5*time.Hour).Truncate(time.Minute), 5)
	on, off := f.member(3), f.member(3)
	f.exec(`INSERT INTO gym.athlete_settings (customer_id, booking_reminders) VALUES ($1, false)`, off)
	for _, b := range []struct{ session, member string }{{soon, on}, {soon, off}, {later, on}} {
		if res := f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": b.session, "customer_id": b.member}); res.Status != 200 {
			t.Fatalf("book: %s", res.Raw)
		}
	}

	reminders := func(member string) string {
		t.Helper()
		return f.scalar(`SELECT count(*)::text FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_class_reminder'`, member)
	}
	run := func() {
		t.Helper()
		if err := f.svc.SendClassReminders(f.ctx, time.Now()); err != nil {
			t.Fatal(err)
		}
	}

	run()
	if got := reminders(on); got != "1" {
		t.Fatalf("reminders for the member = %s, want 1 (only the class within 120 min)", got)
	}
	if got := reminders(off); got != "0" {
		t.Fatalf("member with booking reminders off got %s", got)
	}
	if got := f.scalar(`SELECT title FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_class_reminder'`, on); got != "Kelas segera dimulai: "+typeName {
		t.Fatalf("title %q", got)
	}
	// The inbox row comes with the event the CRM subscriber delivers on push, WhatsApp and email.
	if got := f.scalar(`SELECT count(*)::text FROM platform.outbox_events
		WHERE topic = 'gym.member.notified' AND key = $1 AND payload->>'type' = 'gym_class_reminder'`, on); got != "1" {
		t.Fatalf("outbox events = %s", got)
	}

	run()
	if got := reminders(on); got != "1" {
		t.Fatalf("rerun sent again: %s", got)
	}

	// A moved class earns a reminder for its new time.
	if res := f.asStaff("PATCH", "/api/gym/sessions/"+soon, map[string]any{"starts_at": start.Add(15 * time.Minute).UTC().Format(time.RFC3339)}); res.Status != 200 {
		t.Fatalf("move: %s", res.Raw)
	}
	run()
	if got := reminders(on); got != "2" {
		t.Fatalf("after move = %s, want 2", got)
	}
}
