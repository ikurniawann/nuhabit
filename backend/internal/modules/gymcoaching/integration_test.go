package gymcoaching

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/gymscheduling"
	scheddomain "nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run inside one rolled-back transaction (the credit
// ledger is append-only) on the real gym-credits service and gym-scheduling
// timetable query, wired the way internal/app wires them. The clock starts
// on Monday 3 March 2031, 06:00 WIB.

type headerGuard struct{}

// RequireAnyGrant lets staff through on the first grant, or, with an
// X-Test-Grants header (menu code to actions as JSON), on the first grant
// those actions hold.
func (headerGuard) RequireAnyGrant(r *http.Request, grants ...iam.Grant) (*auth.User, int, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, -1, httpx.Unauthorized("")
	}
	user := &auth.User{ID: id, FullName: "Staf Uji"}
	raw := r.Header.Get("X-Test-Grants")
	if raw == "" {
		return user, 0, nil
	}
	var granted map[string][]string
	if err := json.Unmarshal([]byte(raw), &granted); err != nil {
		return nil, -1, err
	}
	if i := iam.FirstGrant(granted, grants); i >= 0 {
		return user, i, nil
	}
	return nil, -1, httpx.Forbidden("Insufficient permissions")
}

func (headerGuard) RequireMember(r *http.Request) (string, error) {
	id := r.Header.Get("X-Test-Member")
	if id == "" {
		return "", httpx.Unauthorized("Unauthorized")
	}
	return id, nil
}

// testCredits and testSchedule mirror internal/app/module_gymcoaching.go,
// which cannot be imported from here.
type testCredits struct{ svc *gymcredits.Service }

func (c testCredits) UsableBalance(ctx context.Context, q Q, customerID, classTypeID string) (int, error) {
	return c.svc.UsableBalance(ctx, q, customerID, classTypeID)
}

func (c testCredits) Deduct(ctx context.Context, q Q, m CreditMove) (bool, error) {
	ok, _, err := c.svc.Deduct(ctx, q, gymcredits.CreditMove{CustomerID: m.CustomerID, Amount: m.Amount, ClassTypeID: m.ClassTypeID,
		SourceType: m.SourceType, SourceID: m.SourceID, IdempotencyKey: m.IdempotencyKey, Note: m.Note})
	return ok, err
}

func (c testCredits) ForBranch(ctx context.Context, q Q, branchID *string) (domain.Rules, error) {
	r, err := c.svc.Rules(ctx, q, branchID)
	return domain.Rules{
		CancellationDeadlineHours: r.CancellationDeadlineHours, LateCancelPolicy: domain.Policy(r.LateCancelPolicy),
		NoShowPolicy: domain.Policy(r.NoShowPolicy), ReminderMinutes: r.ClassReminderMinutes,
	}, err
}

type testSchedule struct{}

func (testSchedule) Lock(ctx context.Context, q Q) error {
	return gymscheduling.Postgres{}.LockSchedule(ctx, q)
}

func (testSchedule) CoachClash(ctx context.Context, q Q, appointmentID, coachID string, start, end time.Time) (string, error) {
	slot := scheddomain.Slot{ID: appointmentID, CoachID: &coachID, StartsAt: start, EndsAt: end}
	others, err := gymscheduling.Postgres{}.ScheduleNeighbours(ctx, q, slot)
	if clash := scheddomain.FindScheduleConflict(slot, others); err == nil && clash != nil {
		return clash.Message(), nil
	}
	return "", err
}

type testNotifier struct{}

func (testNotifier) NotifyMember(ctx context.Context, q Q, customerID string, n Notification) error {
	return gymscheduling.NotificationsSQL{}.NotifyMember(ctx, q, customerID, gymscheduling.Notification(n))
}

type fixture struct {
	t       *testing.T
	ctx     context.Context
	tx      pgx.Tx
	svc     *Service
	credits testCredits
	mux     *http.ServeMux
	now     time.Time
	staff   string
	sfx     string

	coach, otherCoach string
	pt, smallGroup    string // personal class types: 60 min, 1 credit, capacity 1 and 3
	group             string // a group class type
	ptPackage         string
	openPackage       string
}

func wib(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, localtime.Jakarta)
	if err != nil {
		panic(err)
	}
	return t
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	f := &fixture{t: t, ctx: context.Background(), tx: tx, now: wib("2031-03-03 06:00"),
		staff: "6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11", sfx: testutil.RandomHex(4)}
	f.credits = testCredits{svc: gymcredits.NewDefaultService(module.Deps{}, tx)}
	f.svc = NewService(tx, Ports{Credits: f.credits, Rules: f.credits, Schedule: testSchedule{}, Notifier: testNotifier{}},
		func() time.Time { return f.now }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	f.mux = testutil.Mux(mod{h: &handler{svc: f.svc, guard: headerGuard{}}})

	f.coach = f.id(`INSERT INTO gym.coaches (name) VALUES ($1)`, "Coach PT "+f.sfx)
	f.otherCoach = f.id(`INSERT INTO gym.coaches (name) VALUES ($1)`, "Coach Lain "+f.sfx)
	classType := func(name string, personal bool, capacity int) string {
		return f.id(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity, is_personal)
		              VALUES ($1, 60, 1, $2, $3)`, name+" "+f.sfx, capacity, personal)
	}
	f.pt = classType("PT Uji", true, 1)
	f.smallGroup = classType("PT Grup Uji", true, 3)
	f.group = classType("Kelas Uji", false, 12)
	f.ptPackage = f.id(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days, applicable_class_type_ids)
	                    VALUES ($1, 10, 4000000, 120, ARRAY[$2::uuid, $3::uuid])`, "Paket PT "+f.sfx, f.pt, f.smallGroup)
	f.openPackage = f.id(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days)
	                      VALUES ($1, 10, 1500000, 90)`, "Paket Kelas "+f.sfx)
	return f
}

func (f *fixture) id(sql string, args ...any) string {
	f.t.Helper()
	var id string
	if err := f.tx.QueryRow(f.ctx, sql+" RETURNING id::text", args...).Scan(&id); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return id
}

func (f *fixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var v *string
	if err := f.tx.QueryRow(f.ctx, sql, args...).Scan(&v); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return ""
	}
	return *v
}

// member inserts a customer with ptCredits on the PT package and
// openCredits on the unrestricted package.
func (f *fixture) member(name string, ptCredits, openCredits int) string {
	f.t.Helper()
	id := f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, $2)`, "+6297"+testutil.RandomHex(4), name+" "+f.sfx)
	grant := func(pkg string, n int) {
		if n == 0 {
			return
		}
		lot := f.id(`INSERT INTO gym.credit_lots (customer_id, package_id, credits, expires_at) VALUES ($1, $2, $3, '2032-01-01')`, id, pkg, n)
		if _, err := f.tx.Exec(f.ctx, `INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id, source_type)
		                               VALUES ($1, 'top_up', $2, $3, 'admin')`, id, n, lot); err != nil {
			f.t.Fatal(err)
		}
	}
	grant(f.ptPackage, ptCredits)
	grant(f.openPackage, openCredits)
	return id
}

func (f *fixture) usable(customerID, classTypeID string) int {
	f.t.Helper()
	n, err := f.credits.UsableBalance(f.ctx, f.tx, customerID, classTypeID)
	if err != nil {
		f.t.Fatal(err)
	}
	return n
}

type response struct {
	Status int
	Body   map[string]any
	Raw    string
}

func (r response) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }
func (r response) list() []any          { l, _ := r.Body["data"].([]any); return l }

func (f *fixture) do(method, target string, headers map[string]string, body any) response {
	f.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = strings.NewReader(string(raw))
	}
	req := httptest.NewRequest(method, target, rd)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
	return out
}

func (f *fixture) asStaff(method, target string, body any) response {
	f.t.Helper()
	return f.do(method, target, map[string]string{"X-Test-Staff": f.staff}, body)
}

func (f *fixture) asMember(customerID, method, target string, body any) response {
	f.t.Helper()
	return f.do(method, target, map[string]string{"X-Test-Member": customerID}, body)
}

func expect(t *testing.T, res response, status int, msg string) {
	t.Helper()
	if res.Status != status || (msg != "" && res.Body["error"] != msg) {
		t.Fatalf("want %d %q, got %d %s", status, msg, res.Status, res.Raw)
	}
}

func iso(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func (f *fixture) setWeekly(coachID string, windows ...Window) {
	f.t.Helper()
	expect(f.t, f.asStaff("PUT", "/api/gym/pt/availability/"+coachID, map[string]any{"weekly": windows}), 200, "")
}

func (f *fixture) notifications(customerID string) []string {
	f.t.Helper()
	rows, err := f.tx.Query(f.ctx, `SELECT type FROM crm.member_notifications WHERE customer_id = $1 ORDER BY type`, customerID)
	if err != nil {
		f.t.Fatal(err)
	}
	types, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		f.t.Fatal(err)
	}
	return types
}

func TestMemberRequestToCompletion(t *testing.T) {
	f := newFixture(t)
	alice := f.member("Alice", 2, 5)

	expect(t, f.asStaff("PUT", "/api/gym/pt/availability/"+f.coach, map[string]any{
		"weekly": []Window{{Weekday: 1, StartTime: "12:00", EndTime: "08:00"}}}), 400, "Jam selesai harus setelah jam mulai")
	f.setWeekly(f.coach, Window{Weekday: 1, StartTime: "08:00", EndTime: "12:00"}, Window{Weekday: 3, StartTime: "17:00", EndTime: "20:00"})
	// The coach teaches a group class 11:00-12:00 on Monday.
	f.id(`INSERT INTO gym.class_sessions (class_type_id, coach_id, starts_at, ends_at, capacity, credit_cost,
	        booking_opens_at, booking_closes_at, status)
	      VALUES ($1, $2, $3, $4, 12, 1, $3, $3, 'published')`, f.group, f.coach, wib("2031-03-03 11:00"), wib("2031-03-03 12:00"))

	opts := f.asMember(alice, "GET", "/api/member-portal/gym/pt/options", nil)
	expect(t, opts, 200, "")
	var credits float64 = -1
	for _, raw := range opts.data()["class_types"].([]any) {
		if ct := raw.(map[string]any); ct["id"] == f.pt {
			credits = ct["credits_available"].(float64)
		}
	}
	if credits != 2 {
		t.Fatalf("PT credits = %v, want 2 (the open package must not count): %s", credits, opts.Raw)
	}

	slots := f.asMember(alice, "GET", "/api/member-portal/gym/pt/slots?coach_id="+f.coach+"&class_type_id="+f.pt+"&from=2031-03-03&days=1", nil)
	expect(t, slots, 200, "")
	if got := slots.list(); len(got) != 1 || got[0].(map[string]any)["starts_at"] != "2031-03-03T03:00:00.000Z" {
		t.Fatalf("slots = %s, want only 10:00 WIB", slots.Raw)
	}

	request := func(start string) response {
		return f.asMember(alice, "POST", "/api/member-portal/gym/pt/appointments", map[string]any{
			"coach_id": f.coach, "class_type_id": f.pt, "starts_at": iso(wib(start)), "notes": "Fokus sled push",
		})
	}
	expect(t, request("2031-03-03 09:00"), 409, "Sesi PT harus diminta paling lambat 4 jam sebelum mulai")
	expect(t, request("2031-03-03 13:00"), 409, "Jam ini di luar jadwal PT coach")
	if res := request("2031-03-03 10:30"); res.Status != 409 || !strings.HasPrefix(res.Body["error"].(string), "Coach Coach PT") {
		t.Fatalf("clash with the group class: %s", res.Raw)
	}
	res := request("2031-03-03 10:00")
	expect(t, res, 201, "")
	appt := res.data()["id"].(string)

	// The open PT session holds the coach for staff bookings and group sessions too.
	booked := f.asStaff("POST", "/api/gym/pt/appointments", map[string]any{
		"coach_id": f.coach, "class_type_id": f.pt, "starts_at": iso(wib("2031-03-03 10:30")), "customer_ids": []string{alice},
	})
	if booked.Status != 409 {
		t.Fatalf("staff booking over an open PT session: %s", booked.Raw)
	}
	clash, err := testSchedule{}.CoachClash(f.ctx, f.tx, "", f.coach, wib("2031-03-03 10:30"), wib("2031-03-03 11:00"))
	if err != nil || !strings.Contains(clash, "PT Uji") {
		t.Fatalf("group timetable clash = %q, %v", clash, err)
	}

	expect(t, f.asStaff("POST", "/api/gym/pt/appointments/"+appt, map[string]any{"action": "complete"}), 409,
		"Sesi PT berstatus requested tidak bisa diubah ke completed")
	confirm := f.asStaff("POST", "/api/gym/pt/appointments/"+appt, map[string]any{"action": "confirm"})
	expect(t, confirm, 200, "")
	if confirm.data()["status"] != "confirmed" || confirm.data()["notes"] != "Fokus sled push" {
		t.Fatalf("confirmed: %s", confirm.Raw)
	}
	expect(t, f.asStaff("POST", "/api/gym/pt/appointments/"+appt, map[string]any{"action": "complete"}), 409, "Sesi PT belum dimulai")

	f.now = wib("2031-03-03 10:55")
	done := f.asStaff("POST", "/api/gym/pt/appointments/"+appt, map[string]any{"action": "complete"})
	expect(t, done, 200, "")
	p := done.data()["participants"].([]any)[0].(map[string]any)
	if done.data()["status"] != "completed" || p["status"] != "completed" || p["credits_charged"] != float64(1) {
		t.Fatalf("completed: %s", done.Raw)
	}
	if pt, open := f.usable(alice, f.pt), f.usable(alice, f.group); pt != 1 || open != 5 {
		t.Fatalf("after completion PT=%d open=%d, want 1 and 5", pt, open)
	}
	if got := strings.Join(f.notifications(alice), ","); got != "gym_pt_confirmed,gym_pt_requested" {
		t.Fatalf("notifications = %s", got)
	}

	mine := f.asMember(alice, "GET", "/api/member-portal/gym/pt/appointments", nil)
	if l := mine.list(); len(l) != 1 || l[0].(map[string]any)["status"] != "completed" || l[0].(map[string]any)["free_cancel_until"] != "2031-03-02T23:00:00.000Z" {
		t.Fatalf("member sessions: %s", mine.Raw)
	}
}

func TestSmallGroupCancelAndNoShow(t *testing.T) {
	f := newFixture(t)
	alice, budi, citra, dewi := f.member("Alice", 2, 0), f.member("Budi", 0, 5), f.member("Citra", 1, 0), f.member("Dewi", 3, 0)
	start := wib("2031-03-04 18:00")

	book := func(members ...string) response {
		return f.asStaff("POST", "/api/gym/pt/appointments", map[string]any{
			"coach_id": f.coach, "class_type_id": f.smallGroup, "starts_at": iso(start), "capacity": 2, "customer_ids": members,
		})
	}
	expect(t, book(alice, budi), 409, "Kredit PT Budi "+f.sfx+" tidak cukup (tersedia 0, perlu 1)")
	expect(t, book(alice, citra, dewi), 400, "Pilih 1 sampai 2 member yang berbeda")
	res := book(alice)
	expect(t, res, 201, "")
	appt := res.data()["id"].(string)
	add := func(who string) response {
		return f.asStaff("POST", "/api/gym/pt/appointments/"+appt, map[string]any{"action": "add_member", "customer_id": who})
	}
	expect(t, add(alice), 409, "Alice "+f.sfx+" sudah punya sesi PT pada jam ini")
	expect(t, add(citra), 200, "")
	expect(t, add(dewi), 409, "Sesi PT sudah penuh")

	// Alice cancels two hours before: late, forfeits the session credit.
	f.now = start.Add(-2 * time.Hour)
	cancel := f.asMember(alice, "DELETE", "/api/member-portal/gym/pt/appointments/"+appt, nil)
	expect(t, cancel, 200, "")
	if cancel.data()["late"] != true || cancel.data()["penalty"] != float64(1) || f.usable(alice, f.pt) != 1 {
		t.Fatalf("late cancel: %s, PT left %d", cancel.Raw, f.usable(alice, f.pt))
	}
	expect(t, f.asMember(alice, "DELETE", "/api/member-portal/gym/pt/appointments/"+appt, nil), 404, "Sesi PT tidak ditemukan")

	citraPart := f.scalar(`SELECT id::text FROM gym.pt_participants WHERE appointment_id = $1 AND customer_id = $2`, appt, citra)
	noShow := func() response {
		return f.asStaff("POST", "/api/gym/pt/participants/"+citraPart, map[string]any{"action": "no_show"})
	}
	expect(t, noShow(), 409, "Sesi PT belum dimulai")
	f.now = start.Add(10 * time.Minute)
	ns := noShow()
	expect(t, ns, 200, "")
	if ns.data()["penalty"] != float64(1) || f.usable(citra, f.pt) != 0 {
		t.Fatalf("no-show: %s", ns.Raw)
	}
	done := f.asStaff("POST", "/api/gym/pt/appointments/"+appt, map[string]any{"action": "complete"})
	expect(t, done, 200, "")
	if got := f.scalar(`SELECT string_agg(status || ':' || credits_charged || ':' || late_cancel, ',' ORDER BY status)
	                     FROM gym.pt_participants WHERE appointment_id = $1`, appt); got != "cancelled:1:true,no_show:1:false" {
		t.Fatalf("participants = %s", got)
	}

	// The coach calling a session off frees everyone without a penalty.
	f.now = wib("2031-03-03 06:00")
	other := f.asStaff("POST", "/api/gym/pt/appointments", map[string]any{
		"coach_id": f.coach, "class_type_id": f.pt, "starts_at": iso(wib("2031-03-03 07:00")), "customer_ids": []string{dewi},
	})
	expect(t, other, 201, "")
	off := f.asStaff("POST", "/api/gym/pt/appointments/"+other.data()["id"].(string), map[string]any{"action": "cancel", "reason": "Coach sakit"})
	if off.Status != 200 || off.data()["status"] != "cancelled" || off.data()["cancel_reason"] != "Coach sakit" || f.usable(dewi, f.pt) != 3 {
		t.Fatalf("staff cancel: %s", off.Raw)
	}
	if got := strings.Join(f.notifications(dewi), ","); got != "gym_pt_cancelled,gym_pt_confirmed" {
		t.Fatalf("dewi notifications = %s", got)
	}
}

func TestCoachScope(t *testing.T) {
	// Created before the fixture: cleanups run last first, so the user row is
	// deleted after the transaction that references it rolls back.
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	f := newFixture(t)
	if _, err := f.tx.Exec(f.ctx, `UPDATE gym.coaches SET user_id = $2 WHERE id = $1`, f.coach, staff.UserID); err != nil {
		t.Fatal(err)
	}
	alice := f.member("Alice", 3, 0)
	mine := f.asStaff("POST", "/api/gym/pt/appointments", map[string]any{
		"coach_id": f.coach, "class_type_id": f.pt, "starts_at": iso(wib("2031-03-05 07:00")), "customer_ids": []string{alice}})
	theirs := f.asStaff("POST", "/api/gym/pt/appointments", map[string]any{
		"coach_id": f.otherCoach, "class_type_id": f.pt, "starts_at": iso(wib("2031-03-05 09:00")), "customer_ids": []string{alice}})
	expect(t, mine, 201, "")
	expect(t, theirs, 201, "")

	coach := map[string]string{"X-Test-Staff": staff.UserID, "X-Test-Grants": `{"gym.pt":["read_own","update"]}`}
	list := f.do("GET", "/api/gym/pt/appointments?from=2031-03-01T00:00:00Z&to=2031-03-10T00:00:00Z", coach, nil)
	if l := list.list(); len(l) != 1 || l[0].(map[string]any)["coach_id"] != f.coach {
		t.Fatalf("coach list: %s", list.Raw)
	}
	expect(t, f.do("GET", "/api/gym/pt/appointments/"+theirs.data()["id"].(string), coach, nil), 404, "Sesi PT tidak ditemukan")
	expect(t, f.do("PUT", "/api/gym/pt/availability/"+f.otherCoach, coach, map[string]any{"weekly": []Window{}}), 404, "Coach tidak ditemukan")
	expect(t, f.do("PUT", "/api/gym/pt/availability/"+f.coach, coach, map[string]any{"weekly": []Window{{Weekday: 2, StartTime: "06:00", EndTime: "09:00"}}}), 200, "")
	expect(t, f.do("POST", "/api/gym/pt/appointments", coach, map[string]any{
		"coach_id": f.otherCoach, "class_type_id": f.pt, "starts_at": iso(wib("2031-03-06 09:00")), "customer_ids": []string{alice}}), 404, "Sesi PT tidak ditemukan")
	expect(t, f.do("POST", "/api/gym/pt/appointments/"+mine.data()["id"].(string), coach, map[string]any{"action": "cancel"}), 200, "")

	desk := map[string]string{"X-Test-Staff": f.staff, "X-Test-Grants": `{"gym.pt":["read","create"]}`}
	expect(t, f.do("POST", "/api/gym/pt/appointments/"+theirs.data()["id"].(string), desk, map[string]any{"action": "cancel"}), 403, "Insufficient permissions")
	if l := f.do("GET", "/api/gym/pt/appointments?from=2031-03-01T00:00:00Z&to=2031-03-10T00:00:00Z", desk, nil).list(); len(l) != 2 {
		t.Fatalf("desk sees %d sessions, want 2", len(l))
	}
	unlinked := map[string]string{"X-Test-Staff": f.staff, "X-Test-Grants": `{"gym.pt":["read_own"]}`}
	expect(t, f.do("GET", "/api/gym/pt/appointments", unlinked, nil), 403, "Akun ini belum terhubung ke coach")
}

func TestAvailabilityExceptions(t *testing.T) {
	f := newFixture(t)
	f.setWeekly(f.coach, Window{Weekday: 2, StartTime: "06:00", EndTime: "10:00"})
	add := func(body map[string]any) response {
		return f.asStaff("POST", "/api/gym/pt/availability/"+f.coach+"/exceptions", body)
	}
	expect(t, add(map[string]any{"date": "2031-03-02", "kind": "off"}), 400, "Tanggal sudah lewat")
	expect(t, add(map[string]any{"date": "2031-03-04", "kind": "extra"}), 400, "Jam tidak valid")
	off := add(map[string]any{"date": "2031-03-04", "kind": "off", "start_time": "07:00", "end_time": "08:00", "note": "Dokter"})
	expect(t, off, 201, "")
	expect(t, add(map[string]any{"date": "2031-03-04", "kind": "extra", "start_time": "20:00", "end_time": "21:00"}), 201, "")

	slots := f.asStaff("GET", "/api/gym/pt/slots?coach_id="+f.coach+"&class_type_id="+f.pt+"&from=2031-03-04&days=1", nil)
	var starts []string
	for _, s := range slots.list() {
		starts = append(starts, s.(map[string]any)["starts_at"].(string))
	}
	want := "2031-03-03T23:00:00.000Z,2031-03-04T01:00:00.000Z,2031-03-04T01:30:00.000Z,2031-03-04T02:00:00.000Z,2031-03-04T13:00:00.000Z"
	if got := strings.Join(starts, ","); got != want {
		t.Fatalf("slots = %s\nwant    %s", got, want)
	}
	avail := f.asStaff("GET", "/api/gym/pt/availability/"+f.coach, nil)
	if ex := avail.data()["exceptions"].([]any); len(ex) != 2 || ex[0].(map[string]any)["note"] != "Dokter" {
		t.Fatalf("availability: %s", avail.Raw)
	}
	expect(t, f.asStaff("DELETE", "/api/gym/pt/availability/exceptions/"+off.data()["id"].(string), nil), 200, "")
	expect(t, f.asStaff("DELETE", "/api/gym/pt/availability/exceptions/"+off.data()["id"].(string), nil), 404, "Pengecualian tidak ditemukan")

	// A class type with open PT sessions keeps its flag.
	alice := f.member("Alice", 1, 0)
	expect(t, f.asStaff("POST", "/api/gym/pt/appointments", map[string]any{
		"coach_id": f.coach, "class_type_id": f.pt, "starts_at": iso(wib("2031-03-04 06:00")), "customer_ids": []string{alice}}), 201, "")
	expect(t, f.asStaff("PATCH", "/api/gym/pt/class-type-flags/"+f.pt, map[string]any{"is_personal": false}), 409, "Masih ada sesi PT terbuka untuk jenis ini")
	expect(t, f.asStaff("PATCH", "/api/gym/pt/class-type-flags/"+f.group, map[string]any{"is_personal": true}), 200, "")
}

func TestPTReminders(t *testing.T) {
	f := newFixture(t)
	alice, budi := f.member("Alice", 1, 0), f.member("Budi", 1, 0)
	if _, err := f.tx.Exec(f.ctx, `INSERT INTO gym.athlete_settings (customer_id, booking_reminders) VALUES ($1, false)`, budi); err != nil {
		t.Fatal(err)
	}
	start := wib("2031-03-03 08:00")
	for _, who := range []string{alice, budi} {
		coach := f.coach
		if who == budi {
			coach = f.otherCoach
		}
		expect(t, f.asStaff("POST", "/api/gym/pt/appointments", map[string]any{
			"coach_id": coach, "class_type_id": f.pt, "starts_at": iso(start), "customer_ids": []string{who}}), 201, "")
	}
	if err := f.svc.SendReminders(f.ctx, wib("2031-03-03 05:30")); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(f.notifications(alice), ","); got != "gym_pt_confirmed" {
		t.Fatalf("before the window: %s", got)
	}
	for range 2 {
		if err := f.svc.SendReminders(f.ctx, wib("2031-03-03 06:30")); err != nil {
			t.Fatal(err)
		}
	}
	if got := strings.Join(f.notifications(alice), ","); got != "gym_pt_confirmed,gym_pt_reminder" {
		t.Fatalf("alice: %s", got)
	}
	if got := strings.Join(f.notifications(budi), ","); got != "gym_pt_confirmed" {
		t.Fatalf("budi opted out: %s", got)
	}
}

func TestAssessments(t *testing.T) {
	f := newFixture(t)
	alice := f.member("Alice", 0, 0)
	body := map[string]any{
		"customer_id": alice, "coach_id": f.coach, "assessed_on": "2031-03-01",
		"weight_kg": 72.5, "body_fat_pct": 18.4, "muscle_mass_kg": 33.1, "resting_hr": 58,
		"run_1km_sec": 245, "ski_1km_sec": 250, "row_1km_sec": 230, "wall_balls_max_reps": 60,
		"sled_push_sec": 95, "sled_pull_sec": 110, "burpee_broad_jump_sec": 300,
		"notes": "Teknik sled pull perlu dirapikan", "goals": "Sub 90 menit di HYROX Jakarta",
	}
	expect(t, f.asStaff("POST", "/api/gym/assessments", map[string]any{"customer_id": alice, "assessed_on": "2031-03-01"}), 400, "Isi minimal satu metrik")
	expect(t, f.asStaff("POST", "/api/gym/assessments", map[string]any{"customer_id": alice, "assessed_on": "2031-03-04", "weight_kg": 70}), 400,
		"Tanggal asesmen tidak boleh di masa depan")
	res := f.asStaff("POST", "/api/gym/assessments", body)
	expect(t, res, 201, "")
	id := res.data()["id"].(string)
	body["assessed_on"], body["weight_kg"], body["run_1km_sec"] = "2031-03-03", 71.0, 238
	delete(body, "coach_id")
	second := f.asStaff("POST", "/api/gym/assessments", body)
	expect(t, second, 201, "")

	hist := f.asMember(alice, "GET", "/api/member-portal/gym/assessments", nil)
	l := hist.list()
	if len(l) != 2 {
		t.Fatalf("history: %s", hist.Raw)
	}
	latest, first := l[0].(map[string]any), l[1].(map[string]any)
	if latest["assessed_on"] != "2031-03-03" || latest["coach_id"] != nil || latest["created_by_name"] != "Staf Uji" ||
		first["weight_kg"] != 72.5 || first["body_fat_pct"] != 18.4 || first["coach_name"] != "Coach PT "+f.sfx {
		t.Fatalf("history rows: %s", hist.Raw)
	}

	body["assessed_on"], body["weight_kg"] = "2031-02-28", 73.0
	upd := f.asStaff("PUT", "/api/gym/assessments/"+id, body)
	if upd.Status != 200 || upd.data()["weight_kg"] != 73.0 || upd.data()["assessed_on"] != "2031-02-28" {
		t.Fatalf("update: %s", upd.Raw)
	}
	if l := f.asStaff("GET", "/api/gym/assessments?customer_id="+alice, nil).list(); len(l) != 2 {
		t.Fatalf("staff list: %d", len(l))
	}
	if l := f.asStaff("GET", "/api/gym/assessments?q=Alice+"+f.sfx, nil).list(); len(l) != 2 {
		t.Fatalf("recent search: %d", len(l))
	}
	expect(t, f.asStaff("DELETE", "/api/gym/assessments/"+id, nil), 200, "")
	expect(t, f.asStaff("GET", "/api/gym/assessments/"+id, nil), 404, "Asesmen tidak ditemukan")
}
