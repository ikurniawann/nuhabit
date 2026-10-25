package gymscheduling

import (
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/testutil"
)

// A coach change stamps the session, and members booked before it cancel
// free inside changeFreeCancelHours; a booking made after pays as usual.
func TestCoachChangeOpensFreeCancelWindow(t *testing.T) {
	f := newFixture(t)
	f.rules(`{"cancellationDeadlineHours": 4, "lateCancelPolicy": "forfeit", "changeFreeCancelHours": 24, "changeNoticeMinHours": 12}`)
	typeID, _ := f.classType(1)
	first, _ := f.coach()
	second, secondName := f.coach()
	start := time.Now().Add(2 * time.Hour).Truncate(time.Minute)
	sessionID := f.session(typeID, start, 5)
	f.exec(`UPDATE gym.class_sessions SET coach_id = $2 WHERE id = $1`, sessionID, first)
	before := f.member(3)
	f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": before})

	if res := f.asStaff("PATCH", "/api/gym/sessions/"+sessionID, map[string]any{"coach_id": second}); res.Status != 200 {
		t.Fatalf("change coach: %s", res.Raw)
	}
	if got := f.scalar(`SELECT change_kind || ':' || change_notice_late::text || ':' || (coach_changed_at IS NOT NULL)::text
		FROM gym.class_sessions WHERE id = $1`, sessionID); got != "coach_changed:true:true" {
		t.Fatalf("change stamp = %s", got)
	}
	notes := f.notifications(before, "gym_session_coach_changed")
	if len(notes) != 1 || notes[0] != "Kelas "+localtime.Format(start, localtime.Jakarta)+" kini dipandu "+secondName+
		". Bila tidak bisa hadir, batalkan dari portal dalam 24 jam tanpa potongan kredit." {
		t.Fatalf("coach change notice = %v", notes)
	}

	after := f.member(3)
	afterBooking := f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": after}).data()["bookingId"].(string)
	f.exec(`UPDATE gym.bookings SET created_at = clock_timestamp() WHERE id = $1`, afterBooking)

	bookings := f.asMember(before, "GET", "/api/member-portal/gym/bookings", nil).list()
	row := bookings[0].(map[string]any)
	if info := row["cancel_info"].(map[string]any); info["late"] != false || info["penalty_credits"] != float64(0) {
		t.Fatalf("preview after coach change: %v", info)
	}
	if res := f.asMember(before, "DELETE", "/api/member-portal/gym/bookings/"+row["id"].(string), nil); res.data()["late"] != false || f.balance(before) != 3 {
		t.Fatalf("cancel after coach change: %s balance %d", res.Raw, f.balance(before))
	}
	if res := f.asMember(after, "DELETE", "/api/member-portal/gym/bookings/"+afterBooking, nil); res.data()["late"] != true || res.data()["penalty_credits"] != float64(1) {
		t.Fatalf("booked after the change pays: %s", res.Raw)
	}
}

// A change at 22.00 WIB writes the inbox row at once and holds the push and
// WhatsApp until 07.00 WIB; a cancellation stamps the session too.
func TestChangeNoticesWaitOutQuietHours(t *testing.T) {
	f := newFixture(t)
	f.rules(`{"changeNoticeMinHours": 12}`)
	subscriber := "go-test.quiet-hours-" + testutil.RandomHex(4)
	f.exec(`INSERT INTO platform.outbox_subscriptions (subscriber, topic) VALUES ($1, 'gym.member.notified')`, subscriber)

	night := localtime.DayStart(time.Now().AddDate(0, 0, 1), localtime.Jakarta).Add(22 * time.Hour)
	morning := localtime.DayStart(night.AddDate(0, 0, 1), localtime.Jakarta).Add(7 * time.Hour)
	svc := NewService(f.tx, Postgres{}, Ports{
		Credits: f.credits, Packages: f.credits, Passes: f.credits, Rules: f.credits,
		Members: MembersSQL{}, Qr: QrTokensSQL{}, Notifier: NotificationsSQL{},
	}, func() time.Time { return night })

	typeID, _ := f.classType(1)
	coach, _ := f.coach()
	// 18.00 WIB the next day: 20 hours ahead, on time and not urgent.
	sessionID := f.session(typeID, night.Add(20*time.Hour), 5)
	m := f.member(3)
	f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": m})

	if err := svc.UpdateSession(f.ctx, sessionID, SessionPatch{CoachID: Optional[string]{Set: true, Value: &coach}}); err != nil {
		t.Fatal(err)
	}
	if got := f.scalar(`SELECT change_notice_late::text FROM gym.class_sessions WHERE id = $1`, sessionID); got != "false" {
		t.Fatalf("20 hours ahead flagged late: %s", got)
	}
	if len(f.notifications(m, "gym_session_coach_changed")) != 1 {
		t.Fatal("the inbox row is written at once")
	}
	held := func(kind string) time.Time {
		t.Helper()
		var at time.Time
		if err := f.tx.QueryRow(f.ctx, `SELECT d.next_attempt_at FROM platform.outbox_deliveries d
			JOIN platform.outbox_events e ON e.id = d.event_id
			WHERE d.subscriber = $1 AND e.payload->>'customer_id' = $2 AND e.payload->>'type' = $3`, subscriber, m, kind).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	if at := held("gym_session_coach_changed"); !at.Equal(morning) {
		t.Fatalf("delivery held until %s, want %s", at, morning)
	}

	if _, err := svc.SessionAction(f.ctx, sessionID, "cancel"); err != nil {
		t.Fatal(err)
	}
	if at := held("gym_session_cancelled"); !at.Equal(morning) {
		t.Fatalf("cancel notice held until %s, want %s", at, morning)
	}
	if got := f.scalar(`SELECT change_kind FROM gym.class_sessions WHERE id = $1`, sessionID); got != "cancelled" {
		t.Fatalf("change kind after cancel = %s", got)
	}
}
