package gymcoaching

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

func (f *fixture) setRules(keys map[string]any) {
	f.t.Helper()
	raw, _ := json.Marshal(keys)
	if _, err := f.tx.Exec(f.ctx, `UPDATE gym.business_rules SET rules = rules || $1::jsonb WHERE branch_id IS NULL`, string(raw)); err != nil {
		f.t.Fatal(err)
	}
}

func TestReschedule(t *testing.T) {
	f := newFixture(t)
	f.setWeekly(f.coach, Window{Weekday: 2, StartTime: "06:00", EndTime: "12:00"})
	alice, budi := f.member("Alice", 2, 0), f.member("Budi", 2, 0)
	book := func(coach, start string, who ...string) string {
		res := f.asStaff("POST", "/api/gym/pt/appointments", map[string]any{
			"coach_id": coach, "class_type_id": f.pt, "starts_at": iso(wib(start)), "customer_ids": who})
		expect(t, res, 201, "")
		return res.data()["id"].(string)
	}
	// The other coach teaches a class 09:00-10:00 on Tuesday.
	f.id(`INSERT INTO gym.class_sessions (class_type_id, coach_id, starts_at, ends_at, capacity, credit_cost,
	        booking_opens_at, booking_closes_at, status)
	      VALUES ($1, $2, $3, $4, 12, 1, $3, $3, 'published')`, f.group, f.otherCoach, wib("2031-03-04 09:00"), wib("2031-03-04 10:00"))
	appt := book(f.coach, "2031-03-04 07:00", alice)
	budis := book(f.coach, "2031-03-04 10:00", budi)
	move := func(body map[string]any) response {
		body["action"] = "reschedule"
		return f.asStaff("POST", "/api/gym/pt/appointments/"+appt, body)
	}

	// Staff moves: the same overlap checks as booking, for the coach and the members.
	expect(t, move(map[string]any{"starts_at": "nanti"}), 400, "Waktu tidak valid")
	if res := move(map[string]any{"starts_at": iso(wib("2031-03-04 10:30"))}); res.Status != 409 || !strings.HasPrefix(res.Body["error"].(string), "Coach Coach PT") {
		t.Fatalf("over the coach's other PT: %s", res.Raw)
	}
	if res := move(map[string]any{"starts_at": iso(wib("2031-03-04 09:30")), "coach_id": f.otherCoach}); res.Status != 409 {
		t.Fatalf("over the other coach's class: %s", res.Raw)
	}
	moved := move(map[string]any{"starts_at": iso(wib("2031-03-04 08:00")), "coach_id": f.otherCoach})
	expect(t, moved, 200, "")
	if moved.data()["coach_id"] != f.otherCoach || moved.data()["starts_at"] != "2031-03-04T01:00:00.000Z" ||
		moved.data()["ends_at"] != "2031-03-04T02:00:00.000Z" || moved.data()["status"] != "confirmed" || moved.data()["reschedule_count"] != float64(0) {
		t.Fatalf("staff move: %s", moved.Raw)
	}
	// Alice is booked on the other coach now, so the first coach is free at 08:00 for Budi.
	expect(t, f.asStaff("POST", "/api/gym/pt/appointments/"+budis, map[string]any{"action": "reschedule", "starts_at": iso(wib("2031-03-04 08:00"))}), 200, "")
	expect(t, f.asStaff("POST", "/api/gym/pt/appointments/"+budis, map[string]any{"action": "reschedule", "starts_at": iso(wib("2031-03-04 07:00"))}), 200, "")
	if got := strings.Join(f.notifications(alice), ","); got != "gym_pt_confirmed,gym_pt_rescheduled" {
		t.Fatalf("alice notifications = %s", got)
	}

	// A member moves their own 1:1 session back to the first coach's hours:
	// inside the deadline, inside the availability, at most twice.
	memberMove := func(who, id, start string) response {
		return f.asMember(who, "PATCH", "/api/member-portal/gym/pt/appointments/"+id, map[string]any{"starts_at": iso(wib(start))})
	}
	expect(t, f.asStaff("POST", "/api/gym/pt/appointments/"+appt, map[string]any{"action": "reschedule", "starts_at": iso(wib("2031-03-04 11:00")), "coach_id": f.coach}), 200, "")
	expect(t, memberMove(budi, appt, "2031-03-04 10:00"), 404, "Sesi PT tidak ditemukan")
	expect(t, memberMove(alice, appt, "2031-03-04 13:00"), 409, "Jam ini di luar jadwal PT coach")
	expect(t, memberMove(alice, appt, "2031-03-03 09:00"), 409, "Sesi PT harus diminta paling lambat 4 jam sebelum mulai")
	expect(t, memberMove(alice, appt, "2031-03-04 10:00"), 200, "")
	expect(t, memberMove(alice, appt, "2031-03-04 09:00"), 200, "")
	expect(t, memberMove(alice, appt, "2031-03-04 08:00"), 409, "Sesi PT ini sudah dipindahkan 2 kali, batas maksimal")
	mine := f.asMember(alice, "GET", "/api/member-portal/gym/pt/appointments", nil)
	s := mine.list()[0].(map[string]any)
	if s["starts_at"] != "2031-03-04T02:00:00.000Z" || s["can_reschedule"] != false || s["reschedules_left"] != float64(0) || s["class_type_id"] != f.pt {
		t.Fatalf("member session after moves: %s", mine.Raw)
	}
	if got := f.scalar(`SELECT reschedule_count::text FROM gym.pt_appointments WHERE id = $1`, appt); got != "2" {
		t.Fatalf("reschedule_count = %s", got)
	}
	if f.usable(alice, f.pt) != 2 {
		t.Fatalf("credits stay reserved, usable = %d", f.usable(alice, f.pt))
	}

	// A higher limit lets the member move again, until the deadline passes.
	f.setRules(map[string]any{"ptRescheduleLimit": 4})
	expect(t, memberMove(alice, appt, "2031-03-04 10:00"), 200, "")
	f.now = wib("2031-03-04 06:01")
	expect(t, memberMove(alice, appt, "2031-03-04 11:00"), 409, "Batas ubah jadwal sudah lewat (4 jam sebelum mulai)")
	f.setRules(map[string]any{"ptRescheduleLimit": 0})
	f.now = wib("2031-03-03 06:00")
	expect(t, memberMove(alice, appt, "2031-03-04 11:00"), 409, "Ubah jadwal PT hanya bisa lewat staf atau coach")
	if l := f.asMember(alice, "GET", "/api/member-portal/gym/pt/appointments", nil).list(); l[0].(map[string]any)["can_reschedule"] != false {
		t.Fatalf("limit 0 hides the option")
	}

	// A small group session is only moved by the coach.
	citra := f.member("Citra", 1, 0)
	group := f.asStaff("POST", "/api/gym/pt/appointments", map[string]any{
		"coach_id": f.otherCoach, "class_type_id": f.smallGroup, "starts_at": iso(wib("2031-03-05 07:00")), "customer_ids": []string{alice, citra}})
	expect(t, group, 201, "")
	f.setRules(map[string]any{"ptRescheduleLimit": 2})
	expect(t, memberMove(alice, group.data()["id"].(string), "2031-03-05 08:00"), 409, "Sesi grup hanya bisa dipindahkan oleh coach")
}

// pass issues a running pass on a pass package that covers PT or not.
func (f *fixture) pass(customerID string, coversPersonal bool) {
	f.t.Helper()
	pkg := f.id(`INSERT INTO gym.credit_packages (name, kind, credits, price_idr, validity_days, covers_personal)
	             VALUES ($1, 'pass', 0, 900000, 30, $2)`, "Pass "+testutil.RandomHex(3)+" "+f.sfx, coversPersonal)
	f.id(`INSERT INTO gym.member_passes (customer_id, package_id, starts_at, ends_at) VALUES ($1, $2, '2031-03-01', '2031-04-01')`, customerID, pkg)
}

func TestPassCoversPersonalTraining(t *testing.T) {
	f := newFixture(t)
	plain, covered := f.member("Plain", 0, 0), f.member("Covered", 1, 0)
	f.pass(plain, false)
	f.pass(covered, true)
	start := wib("2031-03-04 07:00")
	book := func(who string, coach string) response {
		return f.asStaff("POST", "/api/gym/pt/appointments", map[string]any{
			"coach_id": coach, "class_type_id": f.pt, "starts_at": iso(start), "customer_ids": []string{who}})
	}
	// A pass without the flag changes nothing: PT still needs PT credits.
	expect(t, book(plain, f.coach), 409, "Kredit PT Plain "+f.sfx+" tidak cukup (tersedia 0, perlu 1)")
	if opts := f.asMember(plain, "GET", "/api/member-portal/gym/pt/options", nil); opts.data()["pass_covers_pt"] != false {
		t.Fatalf("plain pass options: %s", opts.Raw)
	}

	// A covering pass books, completes and no-shows without touching credits.
	if opts := f.asMember(covered, "GET", "/api/member-portal/gym/pt/options", nil); opts.data()["pass_covers_pt"] != true {
		t.Fatalf("covering pass options: %s", opts.Raw)
	}
	res := book(covered, f.coach)
	expect(t, res, 201, "")
	other := book(covered, f.otherCoach)
	expect(t, other, 409, "Covered "+f.sfx+" sudah punya sesi PT pada jam ini")
	f.now = start.Add(5 * time.Minute)
	done := f.asStaff("POST", "/api/gym/pt/appointments/"+res.data()["id"].(string), map[string]any{"action": "complete"})
	expect(t, done, 200, "")
	if p := done.data()["participants"].([]any)[0].(map[string]any); p["status"] != "completed" || p["credits_charged"] != float64(0) {
		t.Fatalf("pass completion: %s", done.Raw)
	}
	if f.usable(covered, f.pt) != 1 {
		t.Fatalf("credits untouched, usable = %d", f.usable(covered, f.pt))
	}
	f.now = wib("2031-03-03 06:00")
	second := book(covered, f.coach)
	expect(t, second, 201, "")
	part := f.scalar(`SELECT id::text FROM gym.pt_participants WHERE appointment_id = $1`, second.data()["id"].(string))
	f.now = start.Add(5 * time.Minute)
	ns := f.asStaff("POST", "/api/gym/pt/participants/"+part, map[string]any{"action": "no_show"})
	if ns.Status != 200 || ns.data()["penalty"] != float64(0) || f.usable(covered, f.pt) != 1 {
		t.Fatalf("pass no-show: %s", ns.Raw)
	}
}

func TestStaffNoticeAndPendingCount(t *testing.T) {
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	f := newFixture(t)
	if _, err := f.tx.Exec(f.ctx, `UPDATE gym.coaches SET user_id = $2 WHERE id = $1`, f.coach, staff.UserID); err != nil {
		t.Fatal(err)
	}
	f.setWeekly(f.coach, Window{Weekday: 2, StartTime: "06:00", EndTime: "12:00"})
	f.setWeekly(f.otherCoach, Window{Weekday: 2, StartTime: "06:00", EndTime: "12:00"})
	alice := f.member("Alice", 3, 0)
	request := func(coach, start string) response {
		return f.asMember(alice, "POST", "/api/member-portal/gym/pt/appointments", map[string]any{
			"coach_id": coach, "class_type_id": f.pt, "starts_at": iso(wib(start))})
	}
	expect(t, request(f.coach, "2031-03-04 08:00"), 201, "")
	expect(t, request(f.coach, "2031-03-04 10:00"), 201, "")
	expect(t, request(f.otherCoach, "2031-03-04 09:00"), 201, "")

	// The coach's staff account gets an inbox row per request; the other
	// coach has no account, so nothing is written for them.
	if got := f.scalar(`SELECT count(*)::text || ':' || min(type) || ':' || min(link) FROM public.notifications WHERE user_id = $1`, staff.UserID); got != "2:approval:"+PendingLink {
		t.Fatalf("coach inbox = %s", got)
	}
	if got := f.scalar(`SELECT message FROM public.notifications WHERE user_id = $1 ORDER BY message LIMIT 1`, staff.UserID); got != "Alice "+f.sfx+" minta PT Uji "+f.sfx+" pada Sel, 4 Mar, 08.00. Konfirmasi di menu Personal Training." {
		t.Fatalf("inbox message = %q", got)
	}

	desk := f.asStaff("GET", "/api/gym/pt/pending-count", nil)
	if desk.Status != 200 || desk.data()["count"] != float64(3) || desk.data()["earliest_start"] != "2031-03-04T01:00:00.000Z" {
		t.Fatalf("desk pending: %s", desk.Raw)
	}
	coach := map[string]string{"X-Test-Staff": staff.UserID, "X-Test-Grants": `{"gym.pt":["read_own","update"]}`}
	own := f.do("GET", "/api/gym/pt/pending-count", coach, nil)
	if own.Status != 200 || own.data()["count"] != float64(2) {
		t.Fatalf("coach pending: %s", own.Raw)
	}
	f.now = wib("2031-03-04 09:30")
	if later := f.asStaff("GET", "/api/gym/pt/pending-count", nil); later.data()["count"] != float64(1) {
		t.Fatalf("only requests still ahead count: %s", later.Raw)
	}
}
