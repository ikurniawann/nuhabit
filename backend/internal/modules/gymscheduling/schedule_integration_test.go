package gymscheduling

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// service is a Service on the fixture's transaction for calls with an
// explicit clock (template generation, closing past sessions).
func (f *fixture) service() *Service {
	return NewService(f.tx, Postgres{}, Ports{
		Credits: f.credits, Packages: f.credits, Passes: f.credits, Rules: f.credits,
		Members: MembersSQL{}, Qr: QrTokensSQL{}, Notifier: NotificationsSQL{},
	}, nil)
}

func (f *fixture) coach() (id, name string) {
	f.t.Helper()
	name = "Go Coach " + testutil.RandomHex(4)
	res := f.asStaff("POST", "/api/gym/coaches", map[string]any{"name": name})
	if res.Status != 200 {
		f.t.Fatalf("create coach: %s", res.Raw)
	}
	return res.data()["id"].(string), name
}

// rules pins the global rules this test relies on, inside the rolled-back tx.
func (f *fixture) rules(patch string) {
	f.t.Helper()
	f.exec(`UPDATE gym.business_rules SET rules = rules || $1::jsonb WHERE branch_id IS NULL`, patch)
}

func (f *fixture) notifications(customerID, kind string) []string {
	f.t.Helper()
	rows, err := f.tx.Query(f.ctx, `SELECT body FROM crm.member_notifications WHERE customer_id = $1 AND type = $2 ORDER BY created_at`,
		customerID, kind)
	if err != nil {
		f.t.Fatal(err)
	}
	bodies, err := collectStrings(rows, nil)
	if err != nil {
		f.t.Fatal(err)
	}
	return bodies
}

func TestScheduleOverlap(t *testing.T) {
	f := newFixture(t)
	typeID, typeName := f.classType(1)
	coachID, coachName := f.coach()
	other, _ := f.coach()
	room := "Go Room " + testutil.RandomHex(3)
	start := time.Date(2031, 3, 4, 10, 0, 0, 0, domain.WIB)
	create := func(coach string, at time.Time, area string) response {
		return f.asStaff("POST", "/api/gym/sessions", map[string]any{
			"class_type_id": typeID, "coach_id": coach, "area": area, "starts_at": at.Format(time.RFC3339),
		})
	}
	if res := create(coachID, start, room); res.Status != 200 {
		t.Fatalf("first session: %s", res.Raw)
	}
	expectError(t, create(coachID, start.Add(30*time.Minute), "Go Elsewhere"), 409,
		"Coach "+coachName+" sudah mengajar "+typeName+" pada Sel, 4 Mar, 10.00–11.00")
	expectError(t, create(other, start.Add(-30*time.Minute), " "+strings.ToLower(room)), 409,
		"Area "+room+" sudah dipakai "+typeName+" pada Sel, 4 Mar, 10.00–11.00")
	next := create(coachID, start.Add(time.Hour), room)
	if next.Status != 200 {
		t.Fatalf("back-to-back session: %s", next.Raw)
	}
	nextID := next.data()["id"].(string)
	expectError(t, f.asStaff("PATCH", "/api/gym/sessions/"+nextID, map[string]any{"duration_min": 60, "starts_at": start.Add(45 * time.Minute).Format(time.RFC3339)}),
		409, "Coach "+coachName+" sudah mengajar "+typeName+" pada Sel, 4 Mar, 10.00–11.00")
	// Same class type, same start, no coach or room: the unique slot index answers.
	if res := create(other, start.Add(3*time.Hour), ""); res.Status != 200 {
		t.Fatalf("free slot: %s", res.Raw)
	}
	expectError(t, f.asStaff("POST", "/api/gym/sessions", map[string]any{
		"class_type_id": typeID, "starts_at": start.Add(3 * time.Hour).Format(time.RFC3339),
	}), 409, "Sesi jenis kelas ini pada Sel, 4 Mar, 13.00 sudah ada di jadwal")
}

func TestSessionEditRepricingAndCoachChange(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(1)
	otherType, otherName := f.classType(2)
	coachID, _ := f.coach()
	newCoach, newCoachName := f.coach()
	sessionID := f.session(typeID, time.Now().Add(72*time.Hour).Truncate(time.Minute), 5)

	if res := f.asStaff("PATCH", "/api/gym/sessions/"+sessionID, map[string]any{
		"class_type_id": otherType, "credit_cost": 3, "coach_id": coachID,
	}); res.Status != 200 {
		t.Fatalf("reprice without bookings: %s", res.Raw)
	}
	s := f.asStaff("GET", "/api/gym/sessions/"+sessionID, nil).data()["session"].(map[string]any)
	if s["class_type_name"] != otherName || s["credit_cost"] != float64(3) {
		t.Fatalf("repriced session: %v", s)
	}

	m := f.member(5)
	f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": m})
	expectError(t, f.asStaff("PATCH", "/api/gym/sessions/"+sessionID, map[string]any{"credit_cost": 1}), 409,
		"Sesi ini sudah punya booking; jenis kelas dan biaya kredit tidak bisa diubah")
	if res := f.asStaff("PATCH", "/api/gym/sessions/"+sessionID, map[string]any{"credit_cost": 3, "coach_id": newCoach}); res.Status != 200 {
		t.Fatalf("same price, new coach: %s", res.Raw)
	}
	got := f.notifications(m, "gym_session_coach_changed")
	if len(got) != 1 || !strings.Contains(got[0], "kini dipandu "+newCoachName) {
		t.Fatalf("coach notifications: %v", got)
	}
}

func TestCancelSessionRefundsCharges(t *testing.T) {
	f := newFixture(t)
	f.rules(`{"cancellationDeadlineHours": 4, "lateCancelPolicy": "forfeit"}`)
	typeID, _ := f.classType(2)
	sessionID := f.session(typeID, time.Now().Add(2*time.Hour), 5)
	attended, lateCanceller, booked := f.member(5), f.member(5), f.member(5)
	book := func(m string) string {
		return f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": m}).data()["bookingId"].(string)
	}
	if res := f.asStaff("POST", "/api/gym/bookings/"+book(attended), map[string]any{"action": "check_in"}); res.Status != 200 {
		t.Fatalf("check in: %s", res.Raw)
	}
	if res := f.asStaff("POST", "/api/gym/bookings/"+book(lateCanceller), map[string]any{"action": "cancel"}); res.data()["penaltyCredits"] != float64(2) {
		t.Fatalf("late cancel: %s", res.Raw)
	}
	book(booked)
	if f.balance(attended) != 3 || f.balance(lateCanceller) != 3 {
		t.Fatalf("charged balances: %d %d", f.balance(attended), f.balance(lateCanceller))
	}

	res := f.asStaff("POST", "/api/gym/sessions/"+sessionID, map[string]any{"action": "cancel"})
	if d := res.data(); d["notified"] != float64(3) || d["refundedCredits"] != float64(4) {
		t.Fatalf("cancel session: %s", res.Raw)
	}
	for _, m := range []string{attended, lateCanceller, booked} {
		if f.balance(m) != 5 {
			t.Fatalf("balance after refund = %d", f.balance(m))
		}
	}
	if got := f.notifications(attended, "gym_session_cancelled"); len(got) != 1 || !strings.Contains(got[0], "2 kredit dikembalikan") {
		t.Fatalf("refund notice: %v", got)
	}
	if got := f.notifications(booked, "gym_session_cancelled"); len(got) != 1 || !strings.Contains(got[0], "tidak terpotong") {
		t.Fatalf("no-charge notice: %v", got)
	}
	if status := f.scalar(`SELECT status FROM gym.bookings WHERE session_id = $1 AND customer_id = $2`, sessionID, attended); status != "cancelled" {
		t.Fatalf("checked-in booking status = %s", status)
	}

	expectError(t, f.asStaff("POST", "/api/gym/sessions/"+sessionID, map[string]any{"action": "cancel"}), 409,
		"Sesi ini sudah selesai atau sudah batal")
	// The refund pass itself is idempotent by key.
	session, err := Postgres{}.LockSession(f.ctx, f.tx, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	session.Status = domain.SessionPublished
	if err := f.service().cancelSession(f.ctx, f.tx, session, newRow()); err != nil {
		t.Fatal(err)
	}
	if f.balance(attended) != 5 || f.balance(lateCanceller) != 5 {
		t.Fatalf("second refund pass paid again: %d %d", f.balance(attended), f.balance(lateCanceller))
	}
	if n := f.scalar(`SELECT count(*)::text FROM gym.credit_ledger WHERE idempotency_key LIKE 'gym:session_cancel:%' AND source_id IN
		(SELECT id FROM gym.bookings WHERE session_id = $1)`, sessionID); n != "2" {
		t.Fatalf("refund entries = %s", n)
	}
}

func TestMovedSessionWaivesLateCancel(t *testing.T) {
	f := newFixture(t)
	f.rules(`{"cancellationDeadlineHours": 4, "lateCancelPolicy": "forfeit"}`)
	typeID, _ := f.classType(1)
	start := time.Now().Add(2 * time.Hour).Truncate(time.Minute)
	sessionID := f.session(typeID, start, 5)
	before := f.member(3)
	f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": before})

	if res := f.asStaff("PATCH", "/api/gym/sessions/"+sessionID, map[string]any{"starts_at": start.Add(time.Hour).Format(time.RFC3339)}); res.Status != 200 {
		t.Fatalf("move: %s", res.Raw)
	}
	after := f.member(3)
	afterBooking := f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": after}).data()["bookingId"].(string)
	// now() is the transaction start; give this booking its real creation time.
	f.exec(`UPDATE gym.bookings SET created_at = clock_timestamp() WHERE id = $1`, afterBooking)

	bookings := f.asMember(before, "GET", "/api/member-portal/gym/bookings", nil).list()
	info := bookings[0].(map[string]any)["cancel_info"].(map[string]any)
	if info["late"] != false || info["penalty_credits"] != float64(0) {
		t.Fatalf("preview after move: %v", info)
	}
	beforeBooking := bookings[0].(map[string]any)["id"].(string)
	res := f.asMember(before, "DELETE", "/api/member-portal/gym/bookings/"+beforeBooking, nil)
	if d := res.data(); d["late"] != false || d["penalty_credits"] != float64(0) || f.balance(before) != 3 {
		t.Fatalf("cancel after move: %s balance %d", res.Raw, f.balance(before))
	}
	res = f.asMember(after, "DELETE", "/api/member-portal/gym/bookings/"+afterBooking, nil)
	if d := res.data(); d["late"] != true || d["penalty_credits"] != float64(1) {
		t.Fatalf("booked after the move pays: %s", res.Raw)
	}
}

func TestTemplatesAndGeneration(t *testing.T) {
	f := newFixture(t)
	// Only this test's template generates.
	f.exec(`UPDATE gym.session_templates SET active = false`)
	typeID, typeName := f.classType(1)
	coachID, coachName := f.coach()
	room := "Go Room " + testutil.RandomHex(3)

	expectError(t, f.asStaff("POST", "/api/gym/session-templates", map[string]any{"class_type_id": typeID, "weekday": 8, "start_time": "06:05"}),
		400, "Data tidak valid: weekday")
	expectError(t, f.asStaff("POST", "/api/gym/session-templates", map[string]any{"class_type_id": typeID, "weekday": 1, "start_time": "6:05"}),
		400, "Data tidak valid: start_time")
	expectError(t, f.asStaff("POST", "/api/gym/session-templates", map[string]any{
		"class_type_id": typeID, "weekday": 1, "start_time": "06:05", "valid_from": "2031-03-10", "valid_until": "2031-03-01",
	}), 400, "Tanggal akhir template tidak boleh sebelum tanggal mulai")

	res := f.asStaff("POST", "/api/gym/session-templates", map[string]any{
		"class_type_id": typeID, "coach_id": coachID, "area": room, "weekday": 1, "start_time": "06:05",
		"valid_from": "2031-01-01",
	})
	if res.Status != 200 {
		t.Fatalf("create template: %s", res.Raw)
	}
	templateID := res.data()["id"].(string)
	listed := f.asStaff("GET", "/api/gym/session-templates", nil).data()
	var row map[string]any
	for _, r := range listed["templates"].([]any) {
		if r := r.(map[string]any); r["id"] == templateID {
			row = r
		}
	}
	if row == nil || row["start_time"] != "06:05" || row["duration_min"] != float64(60) || row["capacity"] != float64(10) ||
		row["coach_name"] != coachName || row["active"] != true || row["valid_until"] != nil {
		t.Fatalf("listed template: %v", row)
	}
	if _, ok := listed["branches"].([]any); !ok {
		t.Fatalf("branches missing: %v", listed)
	}

	svc := f.service()
	// Sunday 2 March 2031, 17.00 WIB.
	now := time.Date(2031, 3, 2, 17, 0, 0, 0, domain.WIB)
	if n, err := svc.GenerateFromTemplates(f.ctx, now, 13); err != nil || n != 2 {
		t.Fatalf("first run: %d %v", n, err)
	}
	ids := strings.Split(f.scalar(`SELECT string_agg(id::text || '|' || occurrence_date::text || '|' || status, ',' ORDER BY starts_at)
		FROM gym.class_sessions WHERE template_id = $1`, templateID), ",")
	if len(ids) != 2 || !strings.HasSuffix(ids[0], "|2031-03-03|published") || !strings.HasSuffix(ids[1], "|2031-03-10|published") {
		t.Fatalf("generated sessions: %v", ids)
	}
	if at := f.scalar(`SELECT to_char(starts_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') FROM gym.class_sessions
		WHERE template_id = $1 ORDER BY starts_at LIMIT 1`, templateID); at != "2031-03-03 06:05" {
		t.Fatalf("WIB start = %s", at)
	}
	if n, err := svc.GenerateFromTemplates(f.ctx, now, 13); err != nil || n != 0 {
		t.Fatalf("second run: %d %v", n, err)
	}

	// A cancelled and a deleted occurrence stay gone.
	first, second := strings.Split(ids[0], "|")[0], strings.Split(ids[1], "|")[0]
	if res := f.asStaff("POST", "/api/gym/sessions/"+first, map[string]any{"action": "cancel"}); res.Status != 200 {
		t.Fatalf("cancel: %s", res.Raw)
	}
	if res := f.asStaff("DELETE", "/api/gym/sessions/"+second, nil); res.Status != 200 {
		t.Fatalf("delete: %s", res.Raw)
	}
	if n, err := svc.GenerateFromTemplates(f.ctx, now, 13); err != nil || n != 0 {
		t.Fatalf("after cancel and delete: %d %v", n, err)
	}

	// A busy coach is reported, not generated, and retried on the next run.
	clash := f.asStaff("POST", "/api/gym/sessions", map[string]any{
		"class_type_id": typeID, "coach_id": coachID, "starts_at": time.Date(2031, 3, 17, 6, 30, 0, 0, domain.WIB).Format(time.RFC3339),
	}).data()["id"].(string)
	out, err := svc.generateFromTemplates(f.ctx, now, 21)
	if err != nil || out.Created != 0 || out.Skipped != 1 || len(out.Conflicts) != 1 ||
		!strings.HasPrefix(out.Conflicts[0], typeName+" Sen, 17 Mar, 06.05: Coach "+coachName+" sudah mengajar") {
		t.Fatalf("clash run: %+v %v", out, err)
	}
	f.asStaff("DELETE", "/api/gym/sessions/"+clash, nil)
	if n, err := svc.GenerateFromTemplates(f.ctx, now, 21); err != nil || n != 1 {
		t.Fatalf("retry after the clash cleared: %d %v", n, err)
	}

	// Inactive templates and the HTTP button.
	if res := f.asStaff("PATCH", "/api/gym/session-templates/"+templateID, map[string]any{"active": false, "area": nil}); res.Status != 200 {
		t.Fatalf("deactivate: %s", res.Raw)
	}
	if n, err := svc.GenerateFromTemplates(f.ctx, now, 60); err != nil || n != 0 {
		t.Fatalf("inactive template generated: %d %v", n, err)
	}
	if res := f.asStaff("POST", "/api/gym/session-templates/generate", map[string]any{}); res.Raw != `{"success":true,"data":{"created":0,"skipped":0,"conflicts":[]}}` {
		t.Fatalf("generate now: %s", res.Raw)
	}
	if res := f.asStaff("DELETE", "/api/gym/session-templates/"+templateID, nil); res.Status != 200 {
		t.Fatalf("delete template: %s", res.Raw)
	}
	expectError(t, f.asStaff("DELETE", "/api/gym/session-templates/"+templateID, nil), 404, "Template jadwal tidak ditemukan")
	if n := f.scalar(`SELECT count(*)::text FROM gym.class_sessions WHERE class_type_id = $1 AND template_id IS NULL AND occurrence_date IS NOT NULL`, typeID); n != "2" {
		t.Fatalf("generated sessions kept after template delete: %s", n)
	}
}

func TestCompletePastSessions(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(1)
	ended := f.session(typeID, time.Now().Add(-3*time.Hour), 5)
	recent := f.session(typeID, time.Now().Add(-70*time.Minute), 5)
	m := f.member(3)
	f.exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, ended, m)

	n, err := f.service().CompletePastSessions(f.ctx, time.Now(), 30)
	if err != nil || n < 1 {
		t.Fatalf("complete: %d %v", n, err)
	}
	if s := f.scalar(`SELECT status FROM gym.class_sessions WHERE id = $1`, ended); s != "completed" {
		t.Fatalf("ended session = %s", s)
	}
	if s := f.scalar(`SELECT status FROM gym.class_sessions WHERE id = $1`, recent); s != "published" {
		t.Fatalf("session inside grace = %s", s)
	}
	if s := f.scalar(`SELECT status FROM gym.bookings WHERE session_id = $1`, ended); s != "no_show" {
		t.Fatalf("absent booking = %s", s)
	}
	if n, err := f.service().CompletePastSessions(f.ctx, time.Now(), 30); err != nil || n != 0 {
		t.Fatalf("second run: %d %v", n, err)
	}
}

// TestDuplicateWeekConcurrent commits for real: two "Salin minggu" runs on
// separate connections must create each slot once.
func TestDuplicateWeekConcurrent(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	credits := newTestCredits(pool)
	svc := NewService(pool, Postgres{}, Ports{
		Credits: credits, Packages: credits, Passes: credits, Rules: credits,
		Members: MembersSQL{}, Qr: QrTokensSQL{}, Notifier: NotificationsSQL{},
	}, nil)
	typeID, err := svc.CreateClassType(ctx, ClassTypeInput{
		Name: "Go Copy " + testutil.RandomHex(4), DefaultDurationMin: 60, DefaultCreditCost: 1, DefaultCapacity: 5,
		Color: "lime", Status: "active",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM gym.class_sessions WHERE class_type_id = $1`, typeID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM gym.class_types WHERE id = $1`, typeID)
	})
	source := time.Date(2032, 6, 7, 0, 0, 0, 0, domain.WIB) // Monday
	for _, h := range []int{7, 9, 30} {
		if _, err := svc.CreateSession(ctx, SessionInput{ClassTypeID: typeID, StartsAt: source.Add(time.Duration(h) * time.Hour)}, nil); err != nil {
			t.Fatal(err)
		}
	}

	var wg sync.WaitGroup
	results := make([]DuplicateWeekResult, 4)
	errs := make([]error, 4)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], errs[i] = svc.DuplicateWeek(ctx, "2032-06-07", "2032-06-14", true, nil)
		}()
	}
	wg.Wait()
	created := 0
	for i, r := range results {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		created += r.Created
	}
	var copies int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM gym.class_sessions WHERE class_type_id = $1 AND starts_at >= $2`,
		typeID, source.AddDate(0, 0, 7)).Scan(&copies); err != nil {
		t.Fatal(err)
	}
	if created != 3 || copies != 3 {
		t.Fatalf("created %d, copies %d", created, copies)
	}

	// Without the schedule lock the unique slot index still holds.
	tx1, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx1.Rollback(context.Background()) }()
	slot := NewSession{ClassTypeID: typeID, StartsAt: source.Add(12 * time.Hour), Capacity: 5, CreditCost: 1,
		BookingOpensAt: source, BookingClosesAt: source, Status: domain.SessionDraft}
	if id, err := (Postgres{}).InsertSessionIfFree(ctx, tx1, slot, slot.StartsAt.Add(time.Hour)); err != nil || id == "" {
		t.Fatalf("first insert: %q %v", id, err)
	}
	second := make(chan string)
	go func() {
		tx2, err := pool.Begin(ctx)
		if err != nil {
			second <- "begin: " + err.Error()
			return
		}
		defer func() { _ = tx2.Rollback(context.Background()) }()
		id, err := (Postgres{}).InsertSessionIfFree(ctx, tx2, slot, slot.StartsAt.Add(time.Hour))
		if err != nil {
			id = "error: " + err.Error()
		}
		second <- id
	}()
	time.Sleep(100 * time.Millisecond)
	if err := tx1.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if got := <-second; got != "" {
		t.Fatalf("concurrent insert of a taken slot returned %q", got)
	}
}
