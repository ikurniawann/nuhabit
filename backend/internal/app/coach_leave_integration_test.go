package app

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymcoachleave"
	"nuhabit/backend/internal/modules/gymcoachleave/domain"
	"nuhabit/backend/internal/modules/gymscheduling"
	"nuhabit/backend/internal/modules/hris"
	memberdomain "nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Coach leave through the real wiring: HRIS stores and decides the leave,
// gym-coach-leave screens it and keeps the covers, gym-scheduling and
// gym-coaching hand the sessions over. Staff accounts are committed (the
// auth service reads them from the pool); everything else runs in one
// rolled-back transaction. The clock is Monday 3 March 2031, 10.00 WIB.

type leaveEnv struct {
	t      *testing.T
	ctx    context.Context
	tx     pgx.Tx
	d      module.Deps
	hrisMx http.Handler
	leave  *gymcoachleave.Service
	sched  *gymscheduling.Service
	scalar func(sql string, args ...any) string
	exec   func(sql string, args ...any)
	branch string
	sfx    string
}

func wibAt(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, localtime.Jakarta)
	if err != nil {
		panic(err)
	}
	return t
}

func newLeaveEnv(t *testing.T) (*leaveEnv, func(menus map[string][]string) testutil.Staff) {
	clock := wibAt("2031-03-03 10:00")
	d := testutil.Deps(t, func() time.Time { return clock })
	newStaff := func(menus map[string][]string) testutil.Staff {
		return testutil.CreateStaff(t, testutil.StaffOptions{Role: "pos", Menus: menus})
	}
	return &leaveEnv{t: t, ctx: context.Background(), d: d, sfx: testutil.RandomHex(4)}, newStaff
}

// open starts the fixture transaction; staff must exist by then so the
// transaction rolls back before their accounts are deleted.
func (e *leaveEnv) open() {
	tx := testutil.Tx(e.t)
	e.tx = tx
	e.scalar = func(sql string, args ...any) string {
		e.t.Helper()
		var v *string
		if err := tx.QueryRow(e.ctx, sql, args...).Scan(&v); err != nil {
			e.t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return ""
		}
		return *v
	}
	e.exec = func(sql string, args ...any) {
		e.t.Helper()
		if _, err := tx.Exec(e.ctx, sql, args...); err != nil {
			e.t.Fatalf("%s: %v", sql, err)
		}
	}
	e.leave = gymcoachleave.NewService(tx, coachLeavePorts(e.d), e.d.Now, e.d.Log)
	ports := HrisPorts(e.d)
	ports.CoachLeaves = hrisCoachLeaves{svc: e.leave}
	e.hrisMx = testutil.Mux(hris.NewOn(e.d, tx, ports))
	e.sched = gymscheduling.NewService(tx, gymscheduling.Postgres{}, schedulingPortsOn(e.d, tx), e.d.Now)
	e.branch = testutil.CreateOrg(e.t, tx).BranchID
}

// call runs an HRIS route as s.
func (e *leaveEnv) call(s testutil.Staff, method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	rec, out := testutil.Do(e.t, e.hrisMx, testutil.AsStaff(testutil.Request(method, path, body), s))
	return rec.Code, out
}

func (e *leaveEnv) coach(name string, user *testutil.Staff) string {
	var userID *string
	if user != nil {
		userID = &user.UserID
	}
	return e.scalar(`INSERT INTO gym.coaches (name, user_id, branch_id) VALUES ($1, $2, $3) RETURNING id::text`,
		name+" "+e.sfx, userID, e.branch)
}

func (e *leaveEnv) employee(user testutil.Staff) string {
	return e.scalar(`INSERT INTO hris.employees (full_name, nip, email, phone, join_date, employment_status, user_id, is_active)
		VALUES ($1, $2, $3, '', '2025-01-10', 'permanent', $4, true) RETURNING id::text`,
		user.FullName, "T-"+testutil.RandomHex(5), testutil.RandomHex(5)+"@leave.test", user.UserID)
}

func (e *leaveEnv) session(classType, coach, start string) string {
	at := wibAt(start)
	return e.scalar(`INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, starts_at, ends_at, capacity, credit_cost,
	        booking_opens_at, booking_closes_at, status)
		VALUES ($1, $2, $3, $4, $5, 10, 1, $4::timestamptz - interval '7 days', $4, 'published') RETURNING id::text`,
		classType, coach, e.branch, at, at.Add(time.Hour))
}

func (e *leaveEnv) director(s testutil.Staff) {
	e.exec(`INSERT INTO iam.user_roles (user_id, role_id, is_primary) SELECT $1, id, false FROM iam.roles WHERE code = 'gym_program_director'`, s.UserID)
}

func (e *leaveEnv) requestLeave(s testutil.Staff, body map[string]any) (int, map[string]any) {
	e.t.Helper()
	return e.call(s, "POST", "/api/hris/leaves", body)
}

func errOf(out map[string]any) string { v, _ := out["error"].(string); return v }

func TestCoachLeaveCoverApproveFlow(t *testing.T) {
	e, newStaff := newLeaveEnv(t)
	coachUser := newStaff(map[string][]string{"gym.my-classes": {"read", "update"}})
	subUser := newStaff(map[string][]string{"gym.my-classes": {"read", "update"}})
	pd := newStaff(map[string][]string{"gym.coach-leave": {"read", "update"}})
	hr := testutil.CreateStaff(t, testutil.StaffOptions{Role: "hrd"})
	e.open()
	ctx := e.ctx

	coachA := e.coach("Coach Cuti", &coachUser)
	coachB := e.coach("Coach Pengganti", &subUser)
	coachC := e.coach("Coach Sibuk", nil)
	e.employee(coachUser)
	e.director(pd)
	group := e.scalar(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ($1, 60, 1, 10) RETURNING id::text`, "Kelas Cuti "+e.sfx)
	ptType := e.scalar(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity, is_personal)
		VALUES ($1, 60, 1, 1, true) RETURNING id::text`, "PT Cuti "+e.sfx)
	// Wednesday 12 and Thursday 13 March 2031.
	s1 := e.session(group, coachA, "2031-03-12 10:00")
	s2 := e.session(group, coachA, "2031-03-13 18:00")
	e.session(group, coachC, "2031-03-12 10:30") // C is busy during s1
	member := e.scalar(`INSERT INTO pos.pos_customers (phone, name, waiver_version, waiver_accepted_at)
		VALUES ($1, $2, $3, now()) RETURNING id::text`, "+6297"+testutil.RandomHex(4), "Member Cuti "+e.sfx, memberdomain.WaiverVersion)
	e.exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, s1, member)
	ptStart := wibAt("2031-03-13 08:00")
	pt := e.scalar(`INSERT INTO gym.pt_appointments (coach_id, class_type_id, branch_id, starts_at, ends_at, capacity, credit_cost, status, source)
		VALUES ($1, $2, $3, $4, $5, 1, 1, 'confirmed', 'staff') RETURNING id::text`, coachA, ptType, e.branch, ptStart, ptStart.Add(time.Hour))
	e.exec(`INSERT INTO gym.pt_participants (appointment_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, pt, member)
	// B keeps PT hours on Thursdays, so B may take the PT session.
	e.exec(`INSERT INTO gym.coach_availability (coach_id, weekday, start_time, end_time) VALUES ($1, 4, '06:00', '20:00')`, coachB)

	// 1. Annual leave needs a week's notice.
	code, out := e.requestLeave(coachUser, map[string]any{"leave_type": "annual", "start_date": "2031-03-05", "end_date": "2031-03-05",
		"reason": "Acara keluarga di luar kota"})
	if code != 400 || !strings.Contains(errOf(out), "minimal diajukan H-7") || !strings.Contains(errOf(out), "2031-03-10") {
		t.Fatalf("short annual leave: %d %v", code, out)
	}
	// 2. A blackout on the 13th refuses the request unless the coach asks for an exception.
	if _, err := e.leave.AddBlackout(ctx, pd.UserID, domain.Blackout{DateFrom: "2031-03-13", DateTo: "2031-03-13", Reason: "HYROX Jakarta"}); err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"leave_type": "annual", "start_date": "2031-03-12", "end_date": "2031-03-13", "reason": "Acara keluarga di luar kota"}
	if code, out := e.requestLeave(coachUser, body); code != 400 || !strings.Contains(errOf(out), "tanggal blackout: 2031-03-13 (HYROX Jakarta)") {
		t.Fatalf("blackout: %d %v", code, out)
	}
	body["blackout_exception_requested"] = true
	code, out = e.requestLeave(coachUser, body)
	if code != 200 {
		t.Fatalf("leave request: %d %v", code, out)
	}
	leaveID := out["data"].(map[string]any)["id"].(string)
	if got := e.scalar(`SELECT is_short_notice::text || ':' || notice_days || ':' || blackout_exception_requested::text FROM hris.leaves WHERE id = $1`, leaveID); got != "false:9:true" {
		t.Fatalf("leave flags = %s", got)
	}
	if got := e.scalar(`SELECT string_agg(status, ',') FROM gym.coach_leave_covers WHERE leave_id = $1`, leaveID); got != "open,open,open" {
		t.Fatalf("covers = %s", got)
	}
	if got := e.scalar(`SELECT count(*)::text FROM public.notifications WHERE user_id = $1 AND link = '/dashboard/gym/coach-leave'`, pd.UserID); got != "1" {
		t.Fatalf("director inbox = %s", got)
	}

	approve := func(s testutil.Staff, override string) (int, map[string]any) {
		return e.call(s, "POST", "/api/hris/leaves/approve", map[string]any{"leave_id": leaveID, "action": "approve", "blackout_override_reason": override})
	}
	// 3. HR does not decide a coach's leave; the director cannot while sessions are uncovered.
	if code, out := approve(hr, ""); code != 403 || errOf(out) != "Cuti coach diputus Program Director atau approver cadangan" {
		t.Fatalf("HR approves: %d %v", code, out)
	}
	if code, out := approve(pd, ""); code != 409 || out["code"] != "COVERS_PENDING" {
		t.Fatalf("approve with open covers: %d %v", code, out)
	}

	queue, err := e.leave.Queue(ctx, pd.UserID, e.branch)
	if err != nil || len(queue) != 1 || queue[0].Blockers != 3 || !queue[0].CanDecide || len(queue[0].Blackouts) != 1 {
		t.Fatalf("queue = %+v, %v", queue, err)
	}
	coverOf := func(id string) *gymcoachleave.Cover {
		for _, c := range queue[0].Covers {
			if (c.SessionID != nil && *c.SessionID == id) || (c.PTAppointmentID != nil && *c.PTAppointmentID == id) {
				return c
			}
		}
		t.Fatalf("no cover for %s", id)
		return nil
	}
	c1, c2, cpt := coverOf(s1), coverOf(s2), coverOf(pt)

	// 4. Suggestions leave out the busy coach; the PT session needs PT hours.
	list, err := e.leave.Candidates(ctx, c1.ID, &coachA)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, c := range list {
		names = append(names, c.CoachID)
	}
	if strings.Contains(strings.Join(names, ","), coachC) || !strings.Contains(strings.Join(names, ","), coachB) {
		t.Fatalf("suggestions for s1 = %v", list)
	}
	if list, err := e.leave.Candidates(ctx, cpt.ID, nil); err != nil || len(list) != 1 || list[0].CoachID != coachB {
		t.Fatalf("PT suggestions = %+v, %v", list, err)
	}
	if _, err := e.leave.RequestSubstitute(ctx, c1.ID, coachA, coachC); err == nil {
		t.Fatal("a busy coach cannot be asked")
	}

	// 5. A asks B, B declines, A asks again, B accepts.
	step := func(c *gymcoachleave.Cover, err error, want domain.CoverStatus) {
		t.Helper()
		if err != nil || c.Status != want {
			t.Fatalf("cover = %+v, %v; want %s", c, err, want)
		}
	}
	c, err := e.leave.RequestSubstitute(ctx, c1.ID, coachA, coachB)
	step(c, err, domain.CoverRequested)
	if c.RespondBy == nil || !c.RespondBy.Equal(wibAt("2031-03-04 10:00")) {
		t.Fatalf("respond by = %v", c.RespondBy)
	}
	c, err = e.leave.RespondToRequest(ctx, c1.ID, coachB, false)
	step(c, err, domain.CoverDeclined)
	if _, err := e.leave.RespondToRequest(ctx, c1.ID, coachB, true); err == nil {
		t.Fatal("a declined request cannot be accepted")
	}
	c, err = e.leave.RequestSubstitute(ctx, c1.ID, coachA, coachB)
	step(c, err, domain.CoverRequested)
	if in, err := e.leave.IncomingRequests(ctx, coachB); err != nil || len(in) != 1 || in[0].ID != c1.ID {
		t.Fatalf("incoming = %+v, %v", in, err)
	}
	c, err = e.leave.RespondToRequest(ctx, c1.ID, coachB, true)
	step(c, err, domain.CoverAccepted)

	// 6. The director assigns B to the PT session and cancels s2.
	if _, err := e.leave.AssignSubstitute(ctx, cpt.ID, coachUser.UserID, coachB); err == nil {
		t.Fatal("the coach on leave cannot assign")
	}
	c, err = e.leave.AssignSubstitute(ctx, cpt.ID, pd.UserID, coachB)
	step(c, err, domain.CoverAssigned)
	c, err = e.leave.CancelSession(ctx, c2.ID, pd.UserID, "Tidak ada coach Strength")
	step(c, err, domain.CoverCancelled)

	// 7. The blackout needs the director's reason.
	if code, out := approve(pd, "event"); code != 400 || out["code"] != "BLACKOUT_OVERRIDE_REQUIRED" {
		t.Fatalf("approve without reason: %d %v", code, out)
	}
	if code, out := approve(pd, "Sudah ada pengganti untuk semua sesi"); code != 200 {
		t.Fatalf("approve: %d %v", code, out)
	}

	if got := e.scalar(`SELECT coach_id::text || ':' || original_coach_id::text || ':' || change_kind FROM gym.class_sessions WHERE id = $1`, s1); got != coachB+":"+coachA+":coach_changed" {
		t.Fatalf("s1 after approval = %s", got)
	}
	if got := e.scalar(`SELECT status FROM gym.class_sessions WHERE id = $1`, s2); got != "cancelled" {
		t.Fatalf("s2 after approval = %s", got)
	}
	if got := e.scalar(`SELECT coach_id::text || ':' || original_coach_id::text || ':' || to_char(starts_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI')
		FROM gym.pt_appointments WHERE id = $1`, pt); got != coachB+":"+coachA+":08:00" {
		t.Fatalf("PT after approval = %s", got)
	}
	if got := e.scalar(`SELECT string_agg(type, ',' ORDER BY type) FROM crm.member_notifications WHERE customer_id = $1`, member); got != "gym_pt_rescheduled,gym_session_coach_changed" {
		t.Fatalf("member notices = %s", got)
	}
	if got := e.scalar(`SELECT count(*) FILTER (WHERE applied_at IS NOT NULL)::text FROM gym.coach_leave_covers WHERE leave_id = $1`, leaveID); got != "3" {
		t.Fatalf("applied covers = %s", got)
	}
	if got := e.scalar(`SELECT string_agg(date::text, ',' ORDER BY date) FROM gym.coach_availability_exceptions WHERE leave_id = $1 AND kind = 'off'`, leaveID); got != "2031-03-12,2031-03-13" {
		t.Fatalf("time off = %s", got)
	}
	if got := e.scalar(`SELECT status::text || ':' || blackout_override_reason FROM hris.leaves WHERE id = $1`, leaveID); got != "approved:Sudah ada pengganti untuk semua sesi" {
		t.Fatalf("leave = %s", got)
	}

	// 8. The time off blocks new classes for the coach on leave.
	newSession := e.session(group, coachB, "2031-03-12 15:00")
	err = e.sched.UpdateSession(ctx, newSession, gymscheduling.SessionPatch{CoachID: gymscheduling.Optional[string]{Set: true, Value: &coachA}})
	if err == nil || !strings.Contains(err.Error(), "Coach sedang cuti") {
		t.Fatalf("class for a coach on leave: %v", err)
	}

	// 9. HR cancels the approved leave: the time off goes, the handed-over sessions stay.
	if code, out := e.call(hr, "PUT", "/api/hris/leaves/"+leaveID, map[string]any{"status": "cancelled"}); code != 200 {
		t.Fatalf("cancel: %d %v", code, out)
	}
	if got := e.scalar(`SELECT count(*)::text FROM gym.coach_availability_exceptions WHERE leave_id = $1`, leaveID); got != "0" {
		t.Fatalf("time off after cancel = %s", got)
	}
	if got := e.scalar(`SELECT coach_id::text FROM gym.class_sessions WHERE id = $1`, s1); got != coachB {
		t.Fatalf("s1 after cancel = %s", got)
	}
}

func TestCoachLeaveShortNoticeRejectAndDiscipline(t *testing.T) {
	e, newStaff := newLeaveEnv(t)
	coachUser := newStaff(map[string][]string{"gym.my-classes": {"read", "update"}})
	pd := newStaff(map[string][]string{"gym.coach-leave": {"read", "update"}})
	hr := testutil.CreateStaff(t, testutil.StaffOptions{Role: "hrd"})
	e.open()
	ctx := e.ctx
	coach := e.coach("Coach Disiplin", &coachUser)
	employee := e.employee(coachUser)
	e.director(pd)
	e.exec(`UPDATE gym.coach_leave_settings SET warning_threshold = 2, warning_window_days = 90 WHERE id`)
	group := e.scalar(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ($1, 60, 1, 10) RETURNING id::text`, "Kelas Disiplin "+e.sfx)
	session := e.session(group, coach, "2031-03-12 07:00")

	// Sick today: accepted as short notice.
	code, out := e.requestLeave(coachUser, map[string]any{"leave_type": "sick", "start_date": "2031-03-03", "end_date": "2031-03-03",
		"reason": "Demam sejak semalam"})
	if code != 200 {
		t.Fatalf("sick leave: %d %v", code, out)
	}
	sick := out["data"].(map[string]any)["id"].(string)
	if got := e.scalar(`SELECT is_short_notice::text || ':' || notice_days FROM hris.leaves WHERE id = $1`, sick); got != "true:0" {
		t.Fatalf("sick flags = %s", got)
	}
	// HR records an annual leave two days ahead: flagged, not refused.
	code, out = e.call(hr, "POST", "/api/hris/leaves", map[string]any{"employee_id": employee, "leave_type": "annual",
		"start_date": "2031-03-05", "end_date": "2031-03-05", "reason": "Dicatat HR setelah telepon"})
	if code != 200 {
		t.Fatalf("HR records leave: %d %v", code, out)
	}
	recorded := out["data"].(map[string]any)["id"].(string)

	decide := func(id, action string) (int, map[string]any) {
		return e.call(pd, "POST", "/api/hris/leaves/approve", map[string]any{"leave_id": id, "action": action, "rejection_reason": "Jadwal penuh"})
	}
	if code, out := decide(sick, "approve"); code != 200 {
		t.Fatalf("approve sick: %d %v", code, out)
	}
	if got := e.scalar(`SELECT kind || ':' || deduction_percent::text FROM gym.coach_incidents WHERE leave_id = $1`, sick); got != "short_notice_leave:5.00" {
		t.Fatalf("incident = %s", got)
	}
	if code, out := decide(recorded, "approve"); code != 200 {
		t.Fatalf("approve recorded: %d %v", code, out)
	}
	// Two short notice incidents reach the threshold: SP1 is proposed once.
	if got := e.scalar(`SELECT level::text || ':' || status || ':' || cardinality(incident_ids) FROM gym.coach_warnings WHERE coach_id = $1`, coach); got != "1:proposed:2" {
		t.Fatalf("warning = %s", got)
	}
	got, err := gymcoachleave.IncidentsSQL{}.IncidentsFor(ctx, e.tx, coach, "2031-03")
	if err != nil || len(got) != 2 || got[0].Kind != "short_notice_leave" || got[0].DeductionPercent != 5 {
		t.Fatalf("incidents for March = %+v, %v", got, err)
	}
	if got, _ := (gymcoachleave.IncidentsSQL{}).IncidentsFor(ctx, e.tx, coach, "2031-04"); len(got) != 0 {
		t.Fatalf("incidents for April = %+v", got)
	}

	// A planned leave over a class, rejected: the cover is void.
	code, out = e.requestLeave(coachUser, map[string]any{"leave_type": "annual", "start_date": "2031-03-12", "end_date": "2031-03-12",
		"reason": "Menghadiri pernikahan saudara"})
	if code != 200 {
		t.Fatalf("planned leave: %d %v", code, out)
	}
	planned := out["data"].(map[string]any)["id"].(string)
	if code, out := decide(planned, "reject"); code != 200 {
		t.Fatalf("reject: %d %v", code, out)
	}
	if got := e.scalar(`SELECT status || ':' || note FROM gym.coach_leave_covers WHERE leave_id = $1 AND session_id = $2`, planned, session); got != "void:Cuti ditolak" {
		t.Fatalf("cover after rejection = %s", got)
	}
	if got := e.scalar(`SELECT coach_id::text FROM gym.class_sessions WHERE id = $1`, session); got != coach {
		t.Fatalf("session after rejection = %s", got)
	}
}
