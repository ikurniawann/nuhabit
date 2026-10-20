package gymdesk

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymdesk/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests write their fixtures inside one rolled-back transaction
// (gym.credit_ledger is append-only) and date them in March 2031, so the
// reports only see this test's rows. The guard trusts X-Test-Staff.

type headerGuard struct{}

func (headerGuard) RequireMenuPrefix(r *http.Request, _ ...string) (*auth.User, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, httpx.Unauthorized("")
	}
	return &auth.User{ID: id, FullName: "Staf " + id[:4]}, nil
}

type fakeAccounts struct {
	registered []NewMember
	patched    map[string]ProfilePatch
}

func (f *fakeAccounts) Register(_ context.Context, _ database.DB, m NewMember) (string, error) {
	f.registered = append(f.registered, m)
	return "11111111-1111-4111-8111-111111111111", nil
}

func (f *fakeAccounts) UpdateProfile(_ context.Context, _ database.DB, id string, p ProfilePatch) error {
	f.patched[id] = p
	return nil
}

type fakeCredits struct{}

func (fakeCredits) MemberCredits(_ context.Context, id string) (json.RawMessage, error) {
	return json.RawMessage(`{"member":{"id":"` + id + `"},"balance":8}`), nil
}

var testNow = time.Date(2031, 3, 20, 12, 0, 0, 0, domain.WIB)

const (
	staffA = "6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11"
	staffB = "7a2d3b2f-1e8c-4d66-8b54-2c1c7b1f6f22"
)

type fixture struct {
	t        *testing.T
	ctx      context.Context
	tx       pgx.Tx
	mux      *http.ServeMux
	accounts *fakeAccounts
	sfx      string // hex suffix of names
	num      string // digit suffix of phone numbers
	branch   string
	m1       string // Alice: two classes attended, 8 credits expiring, upcoming booking
	m2       string // Budi: no-show, visited only in February, 5 credits
	m3       string // Citra: late cancel, denied scan, pass ending in April
}

func wib(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, domain.WIB)
	if err != nil {
		panic(err)
	}
	return t
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	f := &fixture{t: t, ctx: context.Background(), tx: tx, accounts: &fakeAccounts{patched: map[string]ProfilePatch{}},
		sfx: testutil.RandomHex(4), num: fmt.Sprintf("%07d", time.Now().UnixNano()%10_000_000)}
	svc := &Service{db: tx, ports: Ports{Accounts: f.accounts, Credits: fakeCredits{}, WaiverVersion: "1.0"}, now: func() time.Time { return testNow }}
	f.mux = testutil.Mux(mod{h: &handler{svc: svc, guard: headerGuard{}}})
	f.seed()
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

func (f *fixture) seed() {
	f.branch = testutil.CreateOrg(f.t, f.tx).BranchID
	member := func(name, digit, created string) string {
		return f.id(`INSERT INTO pos.pos_customers (phone, name, email, created_at) VALUES ($1, $2, $3, $4)`,
			"+62990"+f.num+digit, name+" "+f.sfx, strings.ToLower(name)+f.sfx+"@test.local", wib(created))
	}
	f.m1 = member("Alice", "1", "2031-03-02 09:00")
	f.m2 = member("Budi", "2", "2031-01-10 09:00")
	f.m3 = member("Citra", "3", "2031-03-05 09:00")
	f.id(`INSERT INTO crm.crm_member_profiles (customer_id, member_code, tier_id)
	      VALUES ($1, $2, (SELECT id FROM crm.crm_membership_tiers ORDER BY rank LIMIT 1))`, f.m1, "ARK-T"+f.sfx)

	classType := f.id(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity) VALUES ($1, 60, 1, 10)`, "Desk Test "+f.sfx)
	coach := f.id(`INSERT INTO gym.coaches (name) VALUES ($1)`, "Coach "+f.sfx)
	session := func(start string, minutes, capacity int, status string) string {
		at := wib(start)
		return f.id(`INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, starts_at, ends_at, capacity, credit_cost,
		               booking_opens_at, booking_closes_at, status)
		             VALUES ($1, $2, $3, $4::timestamptz, $5, $6, 1, $4::timestamptz - interval '7 days', $4::timestamptz, $7)`,
			classType, coach, f.branch, at, at.Add(time.Duration(minutes)*time.Minute), capacity, status)
	}
	s1 := session("2031-03-10 07:00", 60, 10, "completed")
	s2 := session("2031-03-11 18:00", 60, 4, "completed")
	s3 := session("2031-03-22 07:00", 60, 10, "published")
	book := func(sessionID, customerID, status string, late bool) string {
		return f.id(`INSERT INTO gym.bookings (session_id, customer_id, status, late_cancel) VALUES ($1, $2, $3, $4)`, sessionID, customerID, status, late)
	}
	b1 := book(s1, f.m1, "completed", false)
	book(s1, f.m2, "no_show", false)
	book(s1, f.m3, "cancelled", true)
	b2 := book(s2, f.m1, "completed", false)
	book(s3, f.m1, "confirmed", false)

	scan := func(customerID string, bookingID any, decision string, reason any, at string) {
		f.id(`INSERT INTO gym.access_logs (customer_id, booking_id, branch_id, decision, reason, entry_kind, credit_delta, created_at)
		      VALUES ($1, $2, $3, $4, $5, CASE WHEN $4 = 'allowed' THEN 'booking' END, CASE WHEN $4 = 'allowed' THEN -1 ELSE 0 END, $6)`,
			customerID, bookingID, f.branch, decision, reason, wib(at))
	}
	scan(f.m1, b1, "allowed", nil, "2031-03-10 06:50")
	scan(f.m1, b2, "allowed", nil, "2031-03-11 17:50")
	scan(f.m2, nil, "allowed", nil, "2031-02-15 07:00")
	scan(f.m3, nil, "denied", "no_booking", "2031-03-12 08:00")

	credits := f.id(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days) VALUES ($1, 10, 1000000, 30)`, "Desk 10 "+f.sfx)
	pass := f.id(`INSERT INTO gym.credit_packages (name, kind, credits, price_idr, validity_days) VALUES ($1, 'pass', 0, 500000, 30)`, "Desk Pass "+f.sfx)
	purchase := func(customerID, packageID string, credits int, total float64, method, status, paid string, refunded any) string {
		return f.id(`INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, total_idr, channel, payment_method,
		               status, branch_id, paid_at, refunded_at)
		             VALUES ($1, $2, $3, $4, $4, 'front_desk', $5, $6, $7, $8, $9)`,
			customerID, packageID, credits, total, method, status, f.branch, wib(paid), refunded)
	}
	p1 := purchase(f.m1, credits, 10, 1_000_000, "cash", "paid", "2031-03-02 10:00", nil)
	purchase(f.m2, credits, 10, 500_000, "qris", "refunded", "2031-03-05 10:00", wib("2031-03-06 10:00"))
	p3 := purchase(f.m3, pass, 0, 500_000, "transfer", "paid", "2031-03-06 10:00", nil)

	lot := func(customerID string, packageID, purchaseID any, credits int, expires string) string {
		return f.id(`INSERT INTO gym.credit_lots (customer_id, package_id, purchase_id, credits, expires_at) VALUES ($1, $2, $3, $4, $5)`,
			customerID, packageID, purchaseID, credits, wib(expires))
	}
	l1 := lot(f.m1, credits, p1, 10, "2031-03-30 12:00")
	l2 := lot(f.m2, nil, nil, 5, "2031-05-01 12:00")
	entry := func(customerID, kind string, amount int, lotID any) {
		f.id(`INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id) VALUES ($1, $2, $3, $4)`, customerID, kind, amount, lotID)
	}
	entry(f.m1, "top_up", 10, l1)
	entry(f.m1, "class_deduction", -2, nil)
	entry(f.m2, "bonus", 5, l2)
	f.id(`INSERT INTO gym.member_passes (customer_id, package_id, purchase_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)`,
		f.m3, pass, p3, wib("2031-03-06 10:00"), wib("2031-04-05 10:00"))
}

type response struct {
	status int
	raw    string
	body   map[string]any
}

func (r response) data() map[string]any { m, _ := r.body["data"].(map[string]any); return m }

func (f *fixture) call(method, target, staff string, body any) response {
	f.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = strings.NewReader(string(raw))
	}
	req := httptest.NewRequest(method, target, rd)
	if staff != "" {
		req.Header.Set("X-Test-Staff", staff)
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{status: rec.Code, raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.body)
	return out
}

func (f *fixture) get(target string) map[string]any {
	f.t.Helper()
	r := f.call("GET", target, staffA, nil)
	if r.status != http.StatusOK {
		f.t.Fatalf("GET %s = %d %s", target, r.status, r.raw)
	}
	return r.data()
}

func ids(rows any) []string {
	var out []string
	for _, row := range rows.([]any) {
		out = append(out, row.(map[string]any)["id"].(string))
	}
	return out
}

func sameIDs(t *testing.T, label string, got []string, want ...string) {
	t.Helper()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("%s = %v, want %v", label, got, want)
	}
}

func near(a any, b float64) bool { return math.Abs(a.(float64)-b) < 1e-9 }

func TestMemberSearchAndFilters(t *testing.T) {
	f := newFixture(t)
	base := "/api/gym/members?branch_id=" + f.branch

	page := f.get(base)
	if page["total"].(float64) != 3 {
		t.Fatalf("branch members = %v", page)
	}
	sameIDs(t, "ordered by name", ids(page["rows"]), f.m1, f.m2, f.m3)
	alice := page["rows"].([]any)[0].(map[string]any)
	if alice["balance"].(float64) != 8 || alice["bookings_next_7_days"].(float64) != 1 || alice["member_code"] != "ARK-T"+f.sfx {
		t.Errorf("alice row = %v", alice)
	}
	if last, _ := time.Parse(time.RFC3339, alice["last_visit"].(string)); !last.Equal(wib("2031-03-11 17:50")) {
		t.Errorf("alice last visit = %v", alice["last_visit"])
	}
	citra := page["rows"].([]any)[2].(map[string]any)
	if citra["pass_until"] == nil || citra["pass_name"] != "Desk Pass "+f.sfx {
		t.Errorf("citra pass = %v", citra)
	}

	sameIDs(t, "active pass", ids(f.get(base + "&active_pass=1")["rows"]), f.m3)
	sameIDs(t, "has credits", ids(f.get(base + "&has_credits=1")["rows"]), f.m1, f.m2)
	sameIDs(t, "expiring credits", ids(f.get(base + "&expiring=1")["rows"]), f.m1)
	sameIDs(t, "inactive 30 days", ids(f.get(base + "&inactive=1")["rows"]), f.m2)

	sameIDs(t, "name search", ids(f.get("/api/gym/members?q=budi+" + f.sfx)["rows"]), f.m2)
	sameIDs(t, "email search", ids(f.get("/api/gym/members?q=citra" + f.sfx + "%40test")["rows"]), f.m3)
	sameIDs(t, "member code search", ids(f.get("/api/gym/members?q=ark-t" + f.sfx)["rows"]), f.m1)
	sameIDs(t, "phone search with 62 prefix", ids(f.get("/api/gym/members?q=%2B62+990" + f.num + "1")["rows"]), f.m1)
	sameIDs(t, "local phone search", ids(f.get("/api/gym/members?q=0990" + f.num)["rows"]), f.m1, f.m2, f.m3)

	second := f.get(base + "&page=2&page_size=2")
	if second["total"].(float64) != 3 || second["page"].(float64) != 2 {
		t.Fatalf("page 2 = %v", second)
	}
	sameIDs(t, "page 2", ids(second["rows"]), f.m3)

	if r := f.call("GET", "/api/gym/members?branch_id=nope", staffA, nil); r.status != http.StatusBadRequest {
		t.Errorf("bad branch = %d", r.status)
	}
	if r := f.call("GET", "/api/gym/members", "", nil); r.status != http.StatusUnauthorized {
		t.Errorf("anonymous = %d", r.status)
	}
}

func TestMember360AndNotes(t *testing.T) {
	f := newFixture(t)
	m := f.get("/api/gym/members/" + f.m1)
	profile := m["profile"].(map[string]any)
	if profile["name"] != "Alice "+f.sfx || profile["member_code"] != "ARK-T"+f.sfx || profile["crm_member_id"] == "pos-"+f.m1 {
		t.Errorf("profile = %v", profile)
	}
	if w := profile["waiver"].(map[string]any); w["current"] != false || w["current_version"] != "1.0" {
		t.Errorf("waiver = %v", w)
	}
	if m["credits"].(map[string]any)["balance"].(float64) != 8 {
		t.Errorf("credits = %v", m["credits"])
	}
	if a := m["attendance"].(map[string]any); a["attended"].(float64) != 2 || a["no_show"].(float64) != 0 {
		t.Errorf("attendance = %v", a)
	}
	if len(m["upcoming_bookings"].([]any)) != 1 || len(m["past_bookings"].([]any)) != 2 || len(m["checkins"].([]any)) != 2 {
		t.Errorf("bookings/checkins = %v / %v / %v", m["upcoming_bookings"], m["past_bookings"], m["checkins"])
	}
	if p := f.get("/api/gym/members/" + f.m2)["profile"].(map[string]any); p["crm_member_id"] != "pos-"+f.m2 {
		t.Errorf("no CRM profile links pos-<id>: %v", p["crm_member_id"])
	}
	if r := f.call("GET", "/api/gym/members/00000000-0000-4000-8000-000000000000", staffA, nil); r.status != http.StatusNotFound {
		t.Errorf("missing member = %d", r.status)
	}

	created := f.call("POST", "/api/gym/members/"+f.m1+"/notes", staffA, map[string]string{"body": "  Cedera lutut kiri, hindari lunge.  "})
	if created.status != http.StatusCreated || created.data()["body"] != "Cedera lutut kiri, hindari lunge." || created.data()["author_name"] != "Staf 6f1c" {
		t.Fatalf("add note = %d %s", created.status, created.raw)
	}
	noteID := created.data()["id"].(string)
	if r := f.call("POST", "/api/gym/members/"+f.m1+"/notes", staffA, map[string]string{"body": "  "}); r.status != http.StatusBadRequest {
		t.Errorf("empty note = %d", r.status)
	}
	if r := f.call("DELETE", "/api/gym/members/"+f.m1+"/notes/"+noteID, staffB, nil); r.status != http.StatusForbidden {
		t.Errorf("delete by another staff = %d", r.status)
	}
	if notes := f.get("/api/gym/members/" + f.m1)["notes"].([]any); len(notes) != 1 {
		t.Errorf("notes = %v", notes)
	}
	if r := f.call("DELETE", "/api/gym/members/"+f.m1+"/notes/"+noteID, staffA, nil); r.status != http.StatusOK {
		t.Errorf("delete own note = %d %s", r.status, r.raw)
	}
	if r := f.call("DELETE", "/api/gym/members/"+f.m1+"/notes/"+noteID, staffA, nil); r.status != http.StatusNotFound {
		t.Errorf("delete twice = %d", r.status)
	}
}

func TestRegisterAndProfilePassThrough(t *testing.T) {
	f := newFixture(t)
	r := f.call("POST", "/api/gym/members", staffA, map[string]string{"name": "Dewi", "phone": "0812", "email": "d@x.id"})
	if r.status != http.StatusCreated || r.data()["id"] == nil || len(f.accounts.registered) != 1 || f.accounts.registered[0].Phone != "0812" {
		t.Fatalf("register = %d %s", r.status, r.raw)
	}
	r = f.call("PATCH", "/api/gym/members/"+f.m1, staffA, map[string]any{"name": "Alicia", "emergency_contact": nil})
	p := f.accounts.patched[f.m1]
	if r.status != http.StatusOK || *p.Name != "Alicia" || p.Phone != nil || !p.EmergencyContactSet || p.EmergencyContact != nil {
		t.Fatalf("patch = %d %s %+v", r.status, r.raw, p)
	}
	f.call("PATCH", "/api/gym/members/"+f.m2, staffA, map[string]any{"email": ""})
	if p := f.accounts.patched[f.m2]; p.EmergencyContactSet || *p.Email != "" {
		t.Errorf("absent contact must stay unset: %+v", p)
	}
}

func TestReports(t *testing.T) {
	f := newFixture(t)
	q := "?from=2031-03-01&to=2031-03-20&branch_id=" + f.branch

	classes := f.get("/api/gym/reports/classes" + q)
	totals := classes["totals"].(map[string]any)
	if totals["sessions"].(float64) != 2 || totals["checked_in"].(float64) != 2 || totals["no_show"].(float64) != 1 ||
		totals["late_cancel"].(float64) != 1 || !near(totals["avg_fill"], 0.225) || !near(totals["no_show_rate"], 1.0/3) ||
		!near(totals["late_cancel_rate"], 0.25) {
		t.Errorf("class totals = %v", totals)
	}
	if days := classes["per_day"].([]any); len(days) != 20 || days[9].(map[string]any)["checked_in"].(float64) != 1 {
		t.Errorf("per day = %v", days)
	}
	if heat := classes["heatmap"].([]any); len(heat) != 2 {
		t.Errorf("heatmap = %v", heat)
	}
	if coaches := classes["per_coach"].([]any); len(coaches) != 1 || coaches[0].(map[string]any)["hours"].(float64) != 2 {
		t.Errorf("per coach = %v", coaches)
	}

	revenue := f.get("/api/gym/reports/revenue" + q)
	rt := revenue["totals"].(map[string]any)
	if rt["sales"].(float64) != 3 || rt["gross"].(float64) != 2_000_000 || rt["refunds"].(float64) != 1 ||
		rt["refund_amount"].(float64) != 500_000 || rt["net"].(float64) != 1_500_000 {
		t.Errorf("revenue totals = %v", rt)
	}
	if len(revenue["per_package"].([]any)) != 2 || len(revenue["per_method"].([]any)) != 3 || len(revenue["per_branch"].([]any)) != 1 {
		t.Errorf("revenue groups = %v", revenue)
	}

	members := f.get("/api/gym/reports/members" + q)
	if members["new_members"].(float64) != 2 || members["active_members"].(float64) != 1 ||
		members["previous_active_members"].(float64) != 1 || members["churned_members"].(float64) != 1 || !near(members["churn_rate"], 1) {
		t.Errorf("member counts = %v", members)
	}
	sameIDs(t, "churned", ids(members["churned"]), f.m2)
	sameIDs(t, "expiring passes", ids(members["expiring_passes"]), f.m3)
	expiring := members["expiring_credits"].([]any)
	sameIDs(t, "expiring credits", ids(expiring), f.m1)
	if expiring[0].(map[string]any)["credits"].(float64) != 8 {
		t.Errorf("expiring credits = %v", expiring)
	}

	if r := f.call("GET", "/api/gym/reports/classes?from=2031-03-10&to=2031-03-01", staffA, nil); r.status != http.StatusBadRequest {
		t.Errorf("reversed range = %d", r.status)
	}
	if branches := f.call("GET", "/api/gym/reports/branches", staffA, nil); branches.status != http.StatusOK {
		t.Errorf("branches = %d", branches.status)
	}
}

func TestCheckinLog(t *testing.T) {
	f := newFixture(t)
	page := f.get("/api/gym/checkin/log?from=2031-03-10&to=2031-03-12&page_size=2")
	if page["total"].(float64) != 3 || len(page["rows"].([]any)) != 2 {
		t.Fatalf("log page = %v", page)
	}
	first := page["rows"].([]any)[0].(map[string]any)
	if first["customer_id"] != f.m3 || first["decision"] != "denied" {
		t.Errorf("newest first = %v", first)
	}
	if denied := f.get("/api/gym/checkin/log?from=2031-03-10&to=2031-03-12&decision=denied"); denied["total"].(float64) != 1 {
		t.Errorf("denied = %v", denied)
	}

	r := f.call("GET", "/api/gym/checkin/log?from=2031-03-10&to=2031-03-12&format=csv", staffA, nil)
	lines := strings.Split(strings.TrimSpace(r.raw), "\n")
	if r.status != http.StatusOK || len(lines) != 4 || !strings.HasPrefix(lines[0], "Waktu (WIB),Member") ||
		!strings.Contains(lines[1], "Tidak ada booking kelas") || !strings.Contains(lines[2], "Alice "+f.sfx) {
		t.Errorf("csv = %d %q", r.status, r.raw)
	}
}
