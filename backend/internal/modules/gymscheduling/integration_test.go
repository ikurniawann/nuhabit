package gymscheduling

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run every write inside one transaction that is rolled
// back: gym.credit_ledger is append-only, so committed fixtures could never
// be cleaned up. Handlers get a header-driven Guard; TestAuthWiring covers the
// real platform/auth guard.

type headerGuard struct{}

func (headerGuard) RequireMenuPrefix(r *http.Request, _ ...string) (*auth.User, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, httpx.Unauthorized("")
	}
	return &auth.User{ID: id}, nil
}

func (headerGuard) RequireMember(r *http.Request) (string, error) {
	id := r.Header.Get("X-Test-Member")
	if id == "" {
		return "", httpx.Unauthorized("Unauthorized")
	}
	return id, nil
}

type fixture struct {
	t       *testing.T
	credits testCredits
	ctx     context.Context
	tx      pgx.Tx
	mux     *http.ServeMux
	staff   string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pool := testutil.DB(t)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	credits := newTestCredits(tx)
	svc := NewService(tx, Postgres{}, Ports{
		Credits: credits, Packages: credits, Passes: credits, Rules: credits,
		Members: MembersSQL{}, Qr: QrTokensSQL{}, Notifier: NotificationsSQL{},
	}, nil)
	h := &handler{svc: svc, guard: headerGuard{}, log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	return &fixture{t: t, credits: credits, ctx: ctx, tx: tx, mux: testutil.Mux(mod{h: h}), staff: "6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11"}
}

type response struct {
	Status int
	Body   map[string]any
	Raw    string
}

func (r response) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }
func (r response) list() []any          { l, _ := r.Body["data"].([]any); return l }

func (f *fixture) do(method, target, who, id string, body any) response {
	f.t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		rd = strings.NewReader(string(raw))
	}
	req := httptest.NewRequest(method, target, rd)
	if who != "" {
		req.Header.Set(who, id)
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
	return out
}

func (f *fixture) asStaff(method, target string, body any) response {
	f.t.Helper()
	return f.do(method, target, "X-Test-Staff", f.staff, body)
}

func (f *fixture) asMember(customerID, method, target string, body any) response {
	f.t.Helper()
	return f.do(method, target, "X-Test-Member", customerID, body)
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
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

// member inserts a customer and grants credits through a lot + top_up entry.
func (f *fixture) member(credits int) string {
	f.t.Helper()
	phone := "+6298" + testutil.RandomHex(4)
	id := f.scalar(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, $2) RETURNING id::text`, phone, "Go Sched "+phone)
	if credits > 0 {
		lot := f.scalar(`INSERT INTO gym.credit_lots (customer_id, credits, expires_at)
			VALUES ($1, $2, now() + interval '30 days') RETURNING id::text`, id, credits)
		f.exec(`INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id, source_type) VALUES ($1, 'top_up', $2, $3, 'admin')`,
			id, credits, lot)
	}
	return id
}

func (f *fixture) classType(cost int) (id, name string) {
	f.t.Helper()
	name = "Go Class " + testutil.RandomHex(4)
	res := f.asStaff("POST", "/api/gym/class-types", map[string]any{
		"name": name, "default_duration_min": 60, "default_credit_cost": cost, "default_capacity": 10,
	})
	if res.Status != 200 {
		f.t.Fatalf("create class type: %d %s", res.Status, res.Raw)
	}
	return res.data()["id"].(string), name
}

func (f *fixture) session(classTypeID string, startsAt time.Time, capacity int) string {
	f.t.Helper()
	res := f.asStaff("POST", "/api/gym/sessions", map[string]any{
		"class_type_id": classTypeID, "starts_at": startsAt.UTC().Format(time.RFC3339), "capacity": capacity,
	})
	if res.Status != 200 {
		f.t.Fatalf("create session: %d %s", res.Status, res.Raw)
	}
	return res.data()["id"].(string)
}

func (f *fixture) balance(customerID string) int {
	f.t.Helper()
	n, err := f.credits.GetBalance(f.ctx, f.tx, customerID)
	if err != nil {
		f.t.Fatal(err)
	}
	return n
}

func expectError(t *testing.T, res response, status int, msg string) {
	t.Helper()
	if res.Status != status || res.Body["success"] != false || res.Body["error"] != msg {
		t.Fatalf("want %d %q, got %d %s", status, msg, res.Status, res.Raw)
	}
}

var jsDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`)

func TestClassTypesAndCoaches(t *testing.T) {
	f := newFixture(t)

	expectError(t, f.do("GET", "/api/gym/class-types", "", "", nil), 401, "Authentication required")
	res := f.asStaff("POST", "/api/gym/class-types", "{oops")
	expectError(t, res, 400, "Data tidak valid")
	expectError(t, f.asStaff("POST", "/api/gym/class-types", map[string]any{"name": "ab"}), 400, "Data tidak valid: name")
	if res := f.asStaff("POST", "/api/gym/class-types", map[string]any{"name": "abc", "default_duration_min": "60"}); res.Body["error"] != "Data tidak valid: default_duration_min" || res.Body["details"] == nil {
		t.Fatalf("field error with details: %s", res.Raw)
	}

	id, name := f.classType(2)
	expectError(t, f.asStaff("POST", "/api/gym/class-types", map[string]any{
		"name": strings.ToUpper(name), "default_duration_min": 60, "default_credit_cost": 1, "default_capacity": 5,
	}), 409, "Nama jenis kelas sudah dipakai")

	var row map[string]any
	for _, r := range f.asStaff("GET", "/api/gym/class-types", nil).list() {
		if m := r.(map[string]any); m["id"] == id {
			row = m
		}
	}
	if row == nil || row["description"] != "" || row["color"] != "lime" || row["upcoming_sessions"] != float64(0) ||
		!jsDate.MatchString(row["created_at"].(string)) {
		t.Fatalf("class type row: %v", row)
	}

	expectError(t, f.asStaff("PATCH", "/api/gym/class-types/nope", map[string]any{}), 400, "ID tidak valid")
	expectError(t, f.asStaff("PATCH", "/api/gym/class-types/0b9e4a52-3f7d-4d8e-8f61-5c2a9d1e7b30", map[string]any{}), 404,
		"Jenis kelas tidak ditemukan")
	if res := f.asStaff("PATCH", "/api/gym/class-types/"+id, map[string]any{"default_capacity": 12}); res.Status != 200 || res.data()["id"] != id {
		t.Fatalf("patch: %s", res.Raw)
	}
	if res := f.asStaff("DELETE", "/api/gym/class-types/"+id, nil); res.Status != 200 {
		t.Fatalf("archive: %s", res.Raw)
	}
	if got := f.scalar(`SELECT status||':'||default_capacity FROM gym.class_types WHERE id = $1`, id); got != "archived:12" {
		t.Fatalf("archived class type = %s", got)
	}

	coach := f.asStaff("POST", "/api/gym/coaches", map[string]any{"name": "Go Coach " + testutil.RandomHex(3), "photo_url": "https://cdn.test/a.png"})
	coachID, _ := coach.data()["id"].(string)
	if coachID == "" {
		t.Fatalf("create coach: %s", coach.Raw)
	}
	expectError(t, f.asStaff("POST", "/api/gym/coaches", map[string]any{"name": "Go Coach", "photo_url": "not a url"}), 400,
		"Data tidak valid: photo_url")
	if res := f.asStaff("PATCH", "/api/gym/coaches/"+coachID, map[string]any{"photo_url": nil, "bio": "Pelatih"}); res.Status != 200 {
		t.Fatalf("patch coach: %s", res.Raw)
	}
	if got := f.scalar(`SELECT COALESCE(photo_url, '<null>')||'|'||bio FROM gym.coaches WHERE id = $1`, coachID); got != "<null>|Pelatih" {
		t.Fatalf("coach after patch = %s", got)
	}
	found := false
	for _, r := range f.asStaff("GET", "/api/gym/coaches", nil).list() {
		if m := r.(map[string]any); m["id"] == coachID {
			_, hasBranch := m["branch_name"]
			found = hasBranch && m["completed_sessions"] == float64(0)
		}
	}
	if !found {
		t.Fatal("coach missing from list")
	}
}

func TestBookingLifecycle(t *testing.T) {
	f := newFixture(t)
	rules, err := f.credits.ForBranch(f.ctx, f.tx, nil)
	if err != nil {
		t.Fatal(err)
	}
	typeID, typeName := f.classType(2)
	start := time.Now().Add(72 * time.Hour).Truncate(time.Minute)
	sessionID := f.session(typeID, start, 1)
	a, b, broke := f.member(5), f.member(5), f.member(0)

	expectError(t, f.asMember(broke, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": sessionID}), 409,
		"Kredit tidak cukup untuk kelas ini")

	res := f.asMember(a, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": sessionID})
	if res.Status != 200 || res.data()["status"] != "confirmed" || res.data()["waitlistPosition"] != nil {
		t.Fatalf("book A: %s", res.Raw)
	}
	bookingA := res.data()["bookingId"].(string)
	if got := f.scalar(`SELECT status FROM gym.class_sessions WHERE id = $1`, sessionID); got != "full" {
		t.Fatalf("last seat should fill the session, got %s", got)
	}
	expectError(t, f.asMember(a, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": sessionID}), 409,
		"Anda sudah punya tempat di kelas ini")

	res = f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": b})
	if res.data()["status"] != "waitlist" || res.data()["waitlistPosition"] != float64(1) {
		t.Fatalf("book B: %s", res.Raw)
	}
	bookingB := res.data()["bookingId"].(string)

	day := start.In(time.FixedZone("WIB", 7*3600)).Format(time.DateOnly)
	res = f.asMember(a, "GET", "/api/member-portal/gym/sessions?date="+day, nil)
	var listed map[string]any
	for _, s := range res.data()["sessions"].([]any) {
		if m := s.(map[string]any); m["id"] == sessionID {
			listed = m
		}
	}
	if listed == nil || res.data()["credits"] != float64(5) {
		t.Fatalf("member sessions: %s", res.Raw)
	}
	mine := listed["my_booking"].(map[string]any)
	info, _ := listed["cancel_info"].(map[string]any)
	if mine["status"] != "confirmed" || info == nil || info["late"] != false || !jsDate.MatchString(info["deadline"].(string)) ||
		listed["seats_left"] != float64(0) {
		t.Fatalf("listed session: %v", listed)
	}

	detail := f.asStaff("GET", "/api/gym/sessions/"+sessionID, nil)
	roster := detail.data()["roster"].([]any)
	if len(roster) != 2 || roster[0].(map[string]any)["status"] != "confirmed" || roster[1].(map[string]any)["status"] != "waitlist" {
		t.Fatalf("roster: %s", detail.Raw)
	}
	expectError(t, f.asStaff("PATCH", "/api/gym/sessions/"+sessionID, map[string]any{"capacity": 0}), 400, "Data tidak valid: capacity")

	res = f.asMember(a, "DELETE", "/api/member-portal/gym/bookings/"+bookingA, nil)
	if res.Status != 200 || res.data()["late"] != false || res.data()["penalty_credits"] != float64(0) {
		t.Fatalf("cancel A: %s", res.Raw)
	}
	if rules.WaitlistAutoPromote {
		if got := f.scalar(`SELECT status FROM gym.bookings WHERE id = $1`, bookingB); got != "confirmed" {
			t.Fatalf("auto promote: B is %s", got)
		}
	} else {
		if res := f.asMember(b, "POST", "/api/member-portal/gym/bookings/"+bookingB, map[string]any{"action": "confirm_offer"}); res.data()["status"] != "confirmed" {
			t.Fatalf("confirm offer: %s", res.Raw)
		}
	}
	expectError(t, f.asMember(a, "DELETE", "/api/member-portal/gym/bookings/"+bookingB, nil), 404, "Booking tidak ditemukan")

	upcoming := f.asMember(b, "GET", "/api/member-portal/gym/bookings", nil).list()
	if len(upcoming) != 1 || upcoming[0].(map[string]any)["cancel_info"] == nil {
		t.Fatalf("upcoming for B: %v", upcoming)
	}
	if past := f.asMember(a, "GET", "/api/member-portal/gym/bookings?scope=past", nil).list(); len(past) != 1 ||
		past[0].(map[string]any)["status"] != "cancelled" || past[0].(map[string]any)["cancel_info"] != nil {
		t.Fatalf("past for A: %v", past)
	}

	expectError(t, f.asStaff("POST", "/api/gym/bookings/"+bookingB, map[string]any{"action": "delete"}), 400, "Data tidak valid: action")
	res = f.asStaff("POST", "/api/gym/bookings/"+bookingB, map[string]any{"action": "check_in"})
	want := "Check-in " + typeName + " · 2 kredit dipotong · sisa 3 kredit"
	if d := res.data(); d["decision"] != "allowed" || d["creditsDeducted"] != float64(2) || d["balanceAfter"] != float64(3) ||
		d["message"] != want || d["booking"].(map[string]any)["sessionId"] != sessionID {
		t.Fatalf("manual check-in: %s", res.Raw)
	}
	expectError(t, f.asStaff("POST", "/api/gym/bookings/"+bookingB, map[string]any{"action": "no_show"}), 409,
		"Hanya booking terkonfirmasi yang bisa ditandai tidak hadir")
	if f.balance(b) != 3 || f.balance(a) != 5 {
		t.Fatalf("balances A=%d B=%d", f.balance(a), f.balance(b))
	}

	res = f.asStaff("POST", "/api/gym/sessions/"+sessionID, map[string]any{"action": "complete"})
	if d := res.data(); d["action"] != "complete" || d["completed"] != float64(1) || d["noShows"] != float64(0) || d["penaltyCredits"] != float64(0) {
		t.Fatalf("complete: %s", res.Raw)
	}
	expectError(t, f.asStaff("DELETE", "/api/gym/sessions/"+sessionID, nil), 409, "Sesi ini punya booking. Batalkan sesi, jangan dihapus.")
	expectError(t, f.asStaff("POST", "/api/gym/sessions/"+sessionID, map[string]any{"action": "cancel"}), 409,
		"Sesi ini sudah selesai atau sudah batal")
}

func TestNoShowAndLateCancel(t *testing.T) {
	f := newFixture(t)
	rules, err := f.credits.ForBranch(f.ctx, f.tx, nil)
	if err != nil {
		t.Fatal(err)
	}
	typeID, _ := f.classType(1)
	// Starts inside the free-cancel deadline, so cancelling is late.
	start := time.Now().Add(time.Duration(rules.CancellationDeadlineHours)*time.Hour - 30*time.Minute)
	if rules.CancellationDeadlineHours == 0 {
		t.Skip("cancellation deadline is 0 in this database")
	}
	sessionID := f.session(typeID, start, 5)
	late, absent := f.member(3), f.member(3)
	bookLate := f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": late}).data()["bookingId"].(string)
	f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": absent})

	res := f.asStaff("POST", "/api/gym/bookings/"+bookLate, map[string]any{"action": "cancel"})
	wantPenalty := 0.0
	if rules.LateCancelPolicy == "forfeit" {
		wantPenalty = 1
	}
	if d := res.data(); d["late"] != true || d["penaltyCredits"] != wantPenalty || !jsDate.MatchString(d["deadline"].(string)) {
		t.Fatalf("late cancel: %s", res.Raw)
	}

	res = f.asStaff("POST", "/api/gym/sessions/"+sessionID, map[string]any{"action": "complete"})
	wantNoShow := 0.0
	if rules.NoShowPolicy == "forfeit" {
		wantNoShow = 1
	}
	if d := res.data(); d["noShows"] != float64(1) || d["penaltyCredits"] != wantNoShow {
		t.Fatalf("complete with no-show: %s", res.Raw)
	}
	if f.balance(absent) != 3-int(wantNoShow) {
		t.Fatalf("no-show balance = %d", f.balance(absent))
	}
}

func TestGateScan(t *testing.T) {
	f := newFixture(t)
	typeID, typeName := f.classType(1)
	sessionID := f.session(typeID, time.Now().Add(20*time.Minute), 5)
	m := f.member(3)
	f.asMember(m, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": sessionID})

	token := func() string {
		tok := "nhqr_" + testutil.RandomHex(8)
		f.exec(`INSERT INTO crm.member_qr_tokens (token, customer_id, expires_at) VALUES ($1, $2, now() + interval '5 minutes')`, tok, m)
		return tok
	}
	first := token()
	res := f.asStaff("POST", "/api/gym/checkin", map[string]any{"token": "  " + strings.ToUpper(first) + " "})
	if d := res.data(); d["decision"] != "allowed" || d["entryKind"] != "booking" || d["creditsDeducted"] != float64(1) ||
		d["balanceAfter"] != float64(2) || d["message"] != "Check-in "+typeName+" · 1 kredit dipotong · sisa 2 kredit" ||
		d["customerId"] != m || d["booking"].(map[string]any)["sessionId"] != sessionID {
		t.Fatalf("scan: %s", res.Raw)
	}
	res = f.asStaff("POST", "/api/gym/checkin", map[string]any{"token": first})
	if d := res.data(); d["decision"] != "denied" || d["reason"] != "token_consumed" || d["message"] != "QR sudah dipakai" || d["balanceAfter"] != nil {
		t.Fatalf("consumed token: %s", res.Raw)
	}
	res = f.asStaff("POST", "/api/gym/checkin", map[string]any{"token": token()})
	if d := res.data(); d["decision"] != "allowed" || d["entryKind"] != "re_entry" || d["creditsDeducted"] != float64(0) {
		t.Fatalf("re-entry: %s", res.Raw)
	}
	if d := f.asStaff("POST", "/api/gym/checkin", map[string]any{"token": "nhqr_unknown"}).data(); d["reason"] != "token_invalid" || d["customerId"] != nil {
		t.Fatalf("unknown token: %v", d)
	}
	expectError(t, f.asStaff("POST", "/api/gym/checkin", map[string]any{"token": "short"}), 400, "Data tidak valid: token")

	logView := f.asStaff("GET", "/api/gym/checkin", nil).data()
	today := logView["today"].(map[string]any)
	if len(logView["log"].([]any)) < 4 || today["checked_in"].(float64) < 1 || today["credits"].(float64) < 1 {
		t.Fatalf("access log: %v", logView)
	}
	if n := f.scalar(`SELECT count(*)::text FROM crm.member_notifications WHERE customer_id = $1`, m); n != "2" {
		t.Fatalf("notifications (booked + checked in) = %s", n)
	}
}

// passFor issues an active pass of `days` days to the member, starting now.
func (f *fixture) passFor(customerID string, days int) string {
	f.t.Helper()
	pkg := f.scalar(`INSERT INTO gym.credit_packages (name, kind, credits, price_idr, validity_days)
		VALUES ($1, 'pass', 0, 1000000, $2) RETURNING id::text`, "Go Pass "+testutil.RandomHex(4), days)
	return f.scalar(`INSERT INTO gym.member_passes (customer_id, package_id, starts_at, ends_at)
		VALUES ($1, $2, now(), now() + make_interval(days => $3)) RETURNING id::text`, customerID, pkg, days)
}

func TestPassBookingAndCheckIn(t *testing.T) {
	f := newFixture(t)
	rules, err := f.credits.ForBranch(f.ctx, f.tx, nil)
	if err != nil {
		t.Fatal(err)
	}
	typeID, typeName := f.classType(2)
	holder := f.member(0)
	f.passFor(holder, 2)

	// No credits, but the pass covers a class inside its window.
	soon := f.session(typeID, time.Now().Add(20*time.Minute), 5)
	res := f.asMember(holder, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": soon})
	if res.Status != 200 || res.data()["status"] != "confirmed" {
		t.Fatalf("book with pass: %s", res.Raw)
	}
	bookingSoon := res.data()["bookingId"].(string)
	listed := f.asMember(holder, "GET", "/api/member-portal/gym/sessions", nil).data()
	if listed["credits"] != float64(0) || listed["active_pass"] == nil {
		t.Fatalf("member sessions: %v", listed)
	}

	// A class after the pass ends still needs credits.
	later := f.session(typeID, time.Now().Add(3*24*time.Hour), 5)
	expectError(t, f.asMember(holder, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": later}), 409,
		"Kredit tidak cukup untuk kelas ini")

	// Check-in deducts nothing.
	res = f.asStaff("POST", "/api/gym/bookings/"+bookingSoon, map[string]any{"action": "check_in"})
	if d := res.data(); d["decision"] != "allowed" || d["creditsDeducted"] != float64(0) || d["balanceAfter"] != nil ||
		d["message"] != "Check-in "+typeName+" · pass aktif, tanpa potong kredit" {
		t.Fatalf("pass check-in: %s", res.Raw)
	}
	if f.balance(holder) != 0 {
		t.Fatalf("balance %d", f.balance(holder))
	}

	// The gate admits a pass holder for a confirmed booking without credits.
	gateSession := f.session(typeID, time.Now().Add(40*time.Minute), 5)
	f.asMember(holder, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": gateSession})
	tok := "nhqr_" + testutil.RandomHex(8)
	f.exec(`INSERT INTO crm.member_qr_tokens (token, customer_id, expires_at) VALUES ($1, $2, now() + interval '5 minutes')`, tok, holder)
	f.exec(`DELETE FROM gym.access_logs WHERE customer_id = $1`, holder)
	res = f.asStaff("POST", "/api/gym/checkin", map[string]any{"token": tok})
	if d := res.data(); d["decision"] != "allowed" || d["entryKind"] != "booking" || d["creditsDeducted"] != float64(0) {
		t.Fatalf("gate with pass: %s", res.Raw)
	}

	// A late cancel records a strike instead of a credit penalty.
	if rules.CancellationDeadlineHours > 0 && rules.LateCancelPolicy == "forfeit" {
		lateSession := f.session(typeID, time.Now().Add(time.Duration(rules.CancellationDeadlineHours)*time.Hour-30*time.Minute), 5)
		bookLate := f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": lateSession, "customer_id": holder}).data()["bookingId"].(string)
		preview := f.asMember(holder, "GET", "/api/member-portal/gym/bookings", nil).list()
		var info map[string]any
		for _, b := range preview {
			if m := b.(map[string]any); m["id"] == bookLate {
				info, _ = m["cancel_info"].(map[string]any)
			}
		}
		if info == nil || info["late"] != true || info["pass_strike"] != true || info["penalty_credits"] != float64(0) {
			t.Fatalf("cancel preview: %v", preview)
		}
		res = f.asMember(holder, "DELETE", "/api/member-portal/gym/bookings/"+bookLate, nil)
		if d := res.data(); d["late"] != true || d["penalty_credits"] != float64(0) || d["pass_strike"] != true {
			t.Fatalf("late cancel with pass: %s", res.Raw)
		}
		if got := f.scalar(`SELECT pass_strike::text FROM gym.bookings WHERE id = $1`, bookLate); got != "true" {
			t.Fatalf("strike flag = %s", got)
		}
	}
}

func TestSessionAdmin(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(1)
	start := time.Now().Add(48 * time.Hour).Truncate(time.Minute)
	sessionID := f.session(typeID, start, 3)
	for range 2 {
		f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": f.member(2)})
	}
	expectError(t, f.asStaff("PATCH", "/api/gym/sessions/"+sessionID, map[string]any{"capacity": 1}), 409,
		"2 member sudah terdaftar; kapasitas tidak bisa di bawah itu")

	moved := start.Add(time.Hour)
	res := f.asStaff("PATCH", "/api/gym/sessions/"+sessionID, map[string]any{
		"starts_at": moved.Format(time.RFC3339), "capacity": 2, "coach_id": nil, "notes": "  Bawa handuk  ",
	})
	if res.Status != 200 {
		t.Fatalf("patch session: %s", res.Raw)
	}
	s := f.asStaff("GET", "/api/gym/sessions/"+sessionID, nil).data()["session"].(map[string]any)
	if s["status"] != "full" || s["notes"] != "Bawa handuk" || s["starts_at"] != moved.UTC().Format("2006-01-02T15:04:05.000Z") ||
		s["ends_at"] != moved.Add(time.Hour).UTC().Format("2006-01-02T15:04:05.000Z") {
		t.Fatalf("patched session: %v", s)
	}
	if n := f.scalar(`SELECT count(*)::text FROM crm.member_notifications n JOIN gym.bookings b ON b.customer_id = n.customer_id
		WHERE b.session_id = $1 AND n.type = 'gym_session_moved'`, sessionID); n != "2" {
		t.Fatalf("moved notifications = %s", n)
	}
	res = f.asStaff("POST", "/api/gym/sessions/"+sessionID, map[string]any{"action": "cancel"})
	if d := res.data(); d["id"] != sessionID || d["action"] != "cancel" || d["notified"] != float64(2) {
		t.Fatalf("cancel session: %s", res.Raw)
	}

	draft := f.asStaff("POST", "/api/gym/sessions", map[string]any{
		"class_type_id": typeID, "starts_at": start.Format(time.RFC3339), "publish": false,
	}).data()["id"].(string)
	if res := f.asStaff("POST", "/api/gym/sessions/"+draft, map[string]any{"action": "publish"}); res.Raw !=
		`{"success":true,"data":{"id":"`+draft+`","action":"publish"}}` {
		t.Fatalf("publish: %s", res.Raw)
	}
	expectError(t, f.asStaff("POST", "/api/gym/sessions/"+draft, map[string]any{"action": "publish"}), 409,
		"Hanya sesi draf yang bisa diterbitkan")
	if res := f.asStaff("DELETE", "/api/gym/sessions/"+draft, nil); res.Status != 200 {
		t.Fatalf("delete: %s", res.Raw)
	}
	expectError(t, f.asStaff("GET", "/api/gym/sessions/"+draft, nil), 404, "Sesi tidak ditemukan")
	expectError(t, f.asStaff("POST", "/api/gym/sessions", map[string]any{
		"class_type_id": "0b9e4a52-3f7d-4d8e-8f61-5c2a9d1e7b30", "starts_at": start.Format(time.RFC3339),
	}), 404, "Jenis kelas tidak ditemukan atau diarsipkan")
	expectError(t, f.asStaff("POST", "/api/gym/sessions", map[string]any{"class_type_id": typeID, "starts_at": "besok"}), 400,
		"Data tidak valid: starts_at")

	listed := f.asStaff("GET", "/api/gym/sessions?from="+start.Format(time.DateOnly)+"&class_type_id="+typeID+"&status=cancelled,bogus", nil).list()
	if len(listed) != 1 || listed[0].(map[string]any)["my_booking"] != nil {
		t.Fatalf("filtered sessions: %v", listed)
	}
}

func TestDuplicateWeek(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(1)
	wib := time.FixedZone("WIB", 7*3600)
	source := time.Date(2031, 3, 3, 0, 0, 0, 0, wib) // Monday
	target := source.AddDate(0, 0, 7)
	f.session(typeID, source.Add(2*24*time.Hour+10*time.Hour), 4)

	week := func(src, dst time.Time) response {
		return f.asStaff("POST", "/api/gym/sessions/duplicate-week", map[string]any{
			"source_week": src.Format(time.DateOnly), "target_week": dst.Format(time.DateOnly), "publish": true,
		})
	}
	expectError(t, week(source, source), 400, "Minggu tujuan harus berbeda dari minggu sumber")
	if res := week(source, target); res.Raw != `{"success":true,"data":{"created":1,"skipped":0}}` {
		t.Fatalf("duplicate: %s", res.Raw)
	}
	if res := week(source, target); res.Raw != `{"success":true,"data":{"created":0,"skipped":1}}` {
		t.Fatalf("duplicate again: %s", res.Raw)
	}
	expectError(t, f.asStaff("POST", "/api/gym/sessions/duplicate-week", map[string]any{"source_week": "2031/03/03"}), 400,
		"Data tidak valid: source_week")
}

func TestMemberPortalReads(t *testing.T) {
	f := newFixture(t)
	m := f.member(2)
	typeID, _ := f.classType(1)
	coach := f.asStaff("POST", "/api/gym/coaches", map[string]any{"name": "Go Coach " + testutil.RandomHex(3)}).data()["id"].(string)
	res := f.asStaff("POST", "/api/gym/sessions", map[string]any{
		"class_type_id": typeID, "coach_id": coach, "starts_at": time.Now().Add(26 * time.Hour).Format(time.RFC3339),
	})
	sessionID := res.data()["id"].(string)

	expectError(t, f.do("GET", "/api/member-portal/gym/coaches", "", "", nil), 401, "Unauthorized")
	expectError(t, f.asMember(m, "GET", "/api/member-portal/gym/sessions/xyz", nil), 400, "ID kelas tidak valid")
	expectError(t, f.asMember(m, "GET", "/api/member-portal/gym/sessions/0b9e4a52-3f7d-4d8e-8f61-5c2a9d1e7b30", nil), 404, "Kelas tidak ditemukan")
	expectError(t, f.asMember(m, "POST", "/api/member-portal/gym/bookings", "{oops"), 500, "Gagal booking kelas")
	expectError(t, f.asMember(m, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": "x"}), 400, "Data tidak valid")
	expectError(t, f.asMember(m, "DELETE", "/api/member-portal/gym/bookings/x", nil), 400, "Data tidak valid")
	expectError(t, f.asMember(m, "GET", "/api/member-portal/gym/coaches/xyz", nil), 400, "ID coach tidak valid")

	detail := f.asMember(m, "GET", "/api/member-portal/gym/sessions/"+sessionID, nil).data()
	if detail["id"] != sessionID || detail["my_booking"] != nil || detail["cancel_info"] != nil {
		t.Fatalf("session detail: %v", detail)
	}
	if _, ok := detail["coach_bio"]; !ok {
		t.Fatalf("session detail lacks coach profile: %v", detail)
	}
	c := f.asMember(m, "GET", "/api/member-portal/gym/coaches/"+coach, nil).data()
	if c["id"] != coach || len(c["sessions"].([]any)) != 1 {
		t.Fatalf("coach detail: %v", c)
	}
	found := false
	for _, r := range f.asMember(m, "GET", "/api/member-portal/gym/coaches", nil).list() {
		if r := r.(map[string]any); r["id"] == coach {
			found = r["upcoming_sessions"] == float64(1)
		}
	}
	if !found {
		t.Fatal("coach missing from member list")
	}
	catalog := f.asMember(m, "GET", "/api/member-portal/app/classes/catalog", nil)
	if !strings.HasPrefix(catalog.Raw, `{"success":true,"data":{"branches":[`) {
		t.Fatalf("catalog: %.200s", catalog.Raw)
	}
	for _, key := range []string{"class_types", "packages", "coaches"} {
		if _, ok := catalog.data()[key].([]any); !ok {
			t.Fatalf("catalog.%s missing: %.300s", key, catalog.Raw)
		}
	}

	hits := f.asStaff("GET", "/api/gym/bookings/members?q=a", nil)
	if hits.Raw != `{"success":true,"data":[]}` {
		t.Fatalf("short query: %s", hits.Raw)
	}
	phone := f.scalar(`SELECT phone FROM pos.pos_customers WHERE id = $1`, m)
	list := f.asStaff("GET", "/api/gym/bookings/members?q="+strings.TrimPrefix(phone, "+"), nil).list()
	if len(list) != 1 || list[0].(map[string]any)["credits"] != float64(2) {
		t.Fatalf("member search: %v", list)
	}
	if rows := f.asStaff("GET", "/api/gym/bookings?session_id="+sessionID, nil).list(); len(rows) != 0 {
		t.Fatalf("bookings: %v", rows)
	}
}

// TestAuthWiring mounts the module through New with the real platform/auth
// guard: no session means 401 on both sides.
func TestAuthWiring(t *testing.T) {
	deps := testutil.Deps(t, nil)
	mux := testutil.Mux(New(deps, Ports{}))
	rec, body := testutil.Do(t, mux, testutil.Request("GET", "/api/gym/class-types", nil))
	if rec.Code != 401 || body["error"] != "Authentication required" {
		t.Fatalf("staff without session: %d %v", rec.Code, body)
	}
	rec, body = testutil.Do(t, mux, testutil.Request("GET", "/api/member-portal/gym/bookings", nil))
	if rec.Code != 401 || body["error"] != "Unauthorized" {
		t.Fatalf("member without session: %d %v", rec.Code, body)
	}
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"gym.schedule": nil}})
	rec, body = testutil.Do(t, mux, testutil.AsStaff(testutil.Request("GET", "/api/gym/class-types", nil), staff))
	if rec.Code != 200 || body["success"] != true {
		t.Fatalf("staff with gym.schedule: %d %v", rec.Code, body)
	}
}
