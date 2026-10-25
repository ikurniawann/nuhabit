package gymcare

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcare/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run inside one rolled-back transaction. The guard
// trusts X-Test-Staff (the account) and X-Test-Role: manager holds
// read_medical, desk the front desk menus, coach only Kelas Saya. Like the
// real guard it returns the first grant of the route the role holds.

type roleGuard struct{}

func roleHolds(role string, g iam.Grant) bool {
	switch role {
	case "manager":
		return g.Action == "read_medical"
	case "desk":
		return slices.Contains(g.Prefixes, "gym.members") || slices.Contains(g.Prefixes, "gym.checkin") ||
			(slices.Contains(g.Prefixes, "gym.member-flags") && g.Action != "read_medical")
	case "coach":
		return slices.Contains(g.Prefixes, "gym.my-classes")
	}
	return false
}

func (roleGuard) RequireAnyGrant(r *http.Request, grants ...iam.Grant) (*auth.User, int, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, -1, httpx.Unauthorized("")
	}
	for i, g := range grants {
		if roleHolds(r.Header.Get("X-Test-Role"), g) {
			return &auth.User{ID: id, FullName: "Staf " + id[:4]}, i, nil
		}
	}
	return nil, -1, httpx.Forbidden("Insufficient permissions")
}

func (roleGuard) RequireMember(r *http.Request) (string, error) {
	if id := r.Header.Get("X-Test-Member"); id != "" {
		return id, nil
	}
	return "", httpx.Unauthorized("Unauthorized")
}

var testNow = time.Date(2031, 5, 14, 10, 0, 0, 0, localtime.Jakarta)

type staffUser struct{ user, coach, role string }

type fixture struct {
	t     *testing.T
	ctx   context.Context
	tx    pgx.Tx
	clock time.Time
	svc   *Service
	mux   *http.ServeMux
	sfx   string
	ctype string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{t: t, ctx: context.Background(), tx: testutil.Tx(t), clock: testNow, sfx: testutil.RandomHex(4)}
	f.svc = NewService(f.tx, func() time.Time { return f.clock })
	f.mux = testutil.Mux(mod{h: &handler{svc: f.svc, guard: roleGuard{}}})
	f.ctype = f.id(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
	                VALUES ($1, 60, 1, 10)`, "Care Test "+f.sfx)
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

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

// staff creates a staff account, with a coach profile when coach is set.
func (f *fixture) staff(name, role string, coach bool) staffUser {
	f.t.Helper()
	email := "care-" + testutil.RandomHex(5) + "@test.local"
	u := staffUser{role: role, user: f.id(`INSERT INTO auth.users (email, password_hash) VALUES ($1, 'x')`, email)}
	f.exec(`INSERT INTO configuration.users (id, full_name, role, email) VALUES ($1, $2, 'pos', $3)`, u.user, name+" "+f.sfx, email)
	if coach {
		u.coach = f.id(`INSERT INTO gym.coaches (name, user_id) VALUES ($1, $2)`, "Coach "+name+" "+f.sfx, u.user)
	}
	return u
}

func (f *fixture) member(name string) string {
	return f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, $2)`, "+6293"+testutil.RandomHex(4), name+" "+f.sfx)
}

// class adds a session coached by coach starting at start, with the member
// booked in status.
func (f *fixture) class(coach string, start time.Time, customer, status string) string {
	f.t.Helper()
	session := f.id(`INSERT INTO gym.class_sessions (class_type_id, coach_id, starts_at, ends_at, capacity, credit_cost,
	                   booking_opens_at, booking_closes_at, status)
	                 VALUES ($1, $2, $3, $4, 10, 1, $3::timestamptz - interval '7 days', $3, 'published')`,
		f.ctype, coach, start, start.Add(time.Hour))
	f.exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, $3)`, session, customer, status)
	return session
}

// pt adds a confirmed PT session of coach with the member.
func (f *fixture) pt(coach string, start time.Time, customer string) string {
	f.t.Helper()
	appt := f.id(`INSERT INTO gym.pt_appointments (coach_id, class_type_id, starts_at, ends_at, capacity, credit_cost, status)
	              VALUES ($1, $2, $3, $4, 1, 1, 'confirmed')`, coach, f.ctype, start, start.Add(time.Hour))
	f.exec(`INSERT INTO gym.pt_participants (appointment_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, appt, customer)
	return appt
}

func (f *fixture) typeID(code string) string {
	f.t.Helper()
	var id string
	if err := f.tx.QueryRow(f.ctx, `SELECT id::text FROM gym.member_flag_types WHERE code = $1`, code).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	return id
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

func (f *fixture) as(u staffUser, method, target string, body any) response {
	f.t.Helper()
	return f.do(method, target, map[string]string{"X-Test-Staff": u.user, "X-Test-Role": u.role}, body)
}

func (f *fixture) asMember(customer, method, target string, body any) response {
	f.t.Helper()
	return f.do(method, target, map[string]string{"X-Test-Member": customer}, body)
}

func (f *fixture) want(res response, status int) response {
	f.t.Helper()
	if res.Status != status {
		f.t.Fatalf("want %d, got %d %s", status, res.Status, res.Raw)
	}
	return res
}

// flagCodes renders a roster lookup as "member: code,code (+hidden)".
func flagCodes(res response) []string {
	var out []string
	for _, raw := range res.list() {
		m := raw.(map[string]any)
		var codes []string
		for _, fl := range m["flags"].([]any) {
			codes = append(codes, fl.(map[string]any)["type_code"].(string))
		}
		slices.Sort(codes)
		line := strings.Join(codes, ",")
		if n := m["hidden_medical"].(float64); n > 0 {
			line += " +" + strings.Repeat("m", int(n))
		}
		out = append(out, line)
	}
	return out
}

func TestMedicalFlagVisibility(t *testing.T) {
	f := newFixture(t)
	manager := f.staff("Manajer", "manager", false)
	desk := f.staff("Desk", "desk", false)
	coachA := f.staff("A", "coach", true)
	coachB := f.staff("B", "coach", true)
	coachC := f.staff("C", "coach", true)
	// D has Kelas Saya (front desk staff do) but no coach profile.
	noProfile := f.staff("D", "coach", false)

	m1, m2 := f.member("Mira"), f.member("Nadia")
	f.class(coachA.coach, f.clock.Add(24*time.Hour), m1, "confirmed")  // A coaches Mira tomorrow
	f.class(coachB.coach, f.clock.Add(48*time.Hour), m1, "cancelled")  // B's seat for Mira was cancelled
	f.class(coachC.coach, f.clock.Add(-24*time.Hour), m1, "completed") // C coached Mira yesterday
	f.pt(coachB.coach, f.clock.Add(-2*time.Hour), m2)                  // B trained Nadia earlier today

	add := func(customer, code, note string) string {
		return f.id(`INSERT INTO gym.member_flags (customer_id, type_id, note, created_by_name) VALUES ($1, $2, $3, 'seed')`,
			customer, f.typeID(code), note)
	}
	add(m1, "beginner", "baru mulai")
	injury := add(m1, "injury", "lutut kiri cedera ACL")
	add(m2, "pregnant", "trimester dua")
	// Expired and removed flags never show.
	f.exec(`INSERT INTO gym.member_flags (customer_id, type_id, expires_on) VALUES ($1, $2, '2031-05-13')`, m1, f.typeID("vip"))
	f.exec(`INSERT INTO gym.member_flags (customer_id, type_id, removed_at) VALUES ($1, $2, now())`, m2, f.typeID("vip"))

	lookup := "/api/gym/member-flags/members?ids=" + m1 + "," + m2
	matrix := []struct {
		who  staffUser
		want []string
	}{
		{manager, []string{"beginner,injury", "pregnant"}},
		{coachA, []string{"beginner,injury", " +m"}},
		{coachB, []string{"beginner +m", "pregnant"}},
		{coachC, []string{"beginner +m", " +m"}},
		{noProfile, []string{"beginner +m", " +m"}},
		{desk, []string{"beginner +m", " +m"}},
	}
	for _, c := range matrix {
		res := f.want(f.as(c.who, "GET", lookup, nil), 200)
		if got := flagCodes(res); !slices.Equal(got, c.want) {
			t.Errorf("%s: got %q, want %q", c.who.role+" "+c.who.user[:4], got, c.want)
		}
		if !slices.Contains(c.want[0:1], "beginner,injury") && strings.Contains(res.Raw, "ACL") {
			t.Errorf("medical note leaked to %s: %s", c.who.user[:4], res.Raw)
		}
	}

	// The dashboard list filters the same way and only counts the rest.
	res := f.want(f.as(desk, "GET", "/api/gym/member-flags?q="+f.sfx, nil), 200)
	if d := res.data(); d["total"] != 1.0 || d["hidden_medical"] != 2.0 || strings.Contains(res.Raw, "ACL") || strings.Contains(res.Raw, "trimester") {
		t.Fatalf("desk list: %s", res.Raw)
	}
	res = f.want(f.as(manager, "GET", "/api/gym/member-flags?q="+f.sfx+"&category=medical", nil), 200)
	if d := res.data(); d["total"] != 2.0 || d["hidden_medical"] != 0.0 {
		t.Fatalf("manager list: %s", res.Raw)
	}
	// Coaches cannot open the dashboard list.
	f.want(f.as(coachA, "GET", "/api/gym/member-flags", nil), 403)

	// Writes follow the same rule: a medical flag outside the caller's
	// reach is 404, adding one is 403.
	f.want(f.as(desk, "DELETE", "/api/gym/member-flags/"+injury, nil), 404)
	f.want(f.as(coachB, "POST", "/api/gym/member-flags/"+injury+"/review", map[string]any{"decision": "restricted"}), 404)
	f.want(f.as(desk, "POST", "/api/gym/member-flags", map[string]any{"customer_id": m1, "type_id": f.typeID("pregnant")}), 403)
	f.want(f.as(noProfile, "POST", "/api/gym/member-flags", map[string]any{"customer_id": m1, "type_id": f.typeID("vip")}), 403)

	// Desk staff add general flags with the type's default expiry; coaches
	// of the member add medical ones.
	res = f.want(f.as(desk, "POST", "/api/gym/member-flags", map[string]any{"customer_id": m2, "type_id": f.typeID("beginner")}), 201)
	if d := res.data(); d["expires_on"] != "2031-06-13" || d["source"] != "staff" {
		t.Fatalf("desk flag: %s", res.Raw)
	}
	res = f.want(f.as(coachA, "POST", "/api/gym/member-flags", map[string]any{
		"customer_id": m1, "type_id": f.typeID("medical_condition"), "note": "asma", "expires_on": nil}), 201)
	if d := res.data(); d["expires_on"] != nil || d["source"] != "coach" {
		t.Fatalf("coach flag: %s", res.Raw)
	}
	f.want(f.as(coachA, "POST", "/api/gym/member-flags", map[string]any{
		"customer_id": m1, "type_id": f.typeID("injury"), "expires_on": "2031-05-13"}), 400)
	// The PAR-Q type is the system's own.
	f.want(f.as(manager, "POST", "/api/gym/member-flags", map[string]any{"customer_id": m1, "type_id": f.typeID("parq_review")}), 400)

	// A coach of the member reviews and removes.
	f.want(f.as(coachA, "POST", "/api/gym/member-flags/"+injury+"/review", map[string]any{"decision": "doctor_note", "note": "minta surat"}), 200)
	res = f.want(f.as(coachA, "GET", "/api/gym/member-flags/members?ids="+m1, nil), 200)
	if !strings.Contains(res.Raw, `"review_status":"doctor_note"`) || !strings.Contains(res.Raw, `"review_note":"minta surat"`) {
		t.Fatalf("reviewed: %s", res.Raw)
	}
	f.want(f.as(coachA, "DELETE", "/api/gym/member-flags/"+injury, nil), 200)
	f.want(f.as(manager, "DELETE", "/api/gym/member-flags/"+injury, nil), 404)
}

func allNo() map[string]any {
	out := map[string]any{}
	for _, q := range domain.ParqQuestions {
		out[q.Code] = false
	}
	return out
}

func TestParqDeclarationAndReviewFlag(t *testing.T) {
	f := newFixture(t)
	manager := f.staff("Manajer", "manager", false)
	desk := f.staff("Desk", "desk", false)
	m := f.member("Putri")
	path := "/api/member-portal/gym/health"

	res := f.want(f.asMember(m, "GET", path, nil), 200)
	if d := res.data(); d["due"] != true || d["last"] != nil || d["version"] != domain.ParqVersion || len(d["questions"].([]any)) != 7 {
		t.Fatalf("first status: %s", res.Raw)
	}
	f.want(f.do("GET", path, nil, nil), 401)
	incomplete := allNo()
	delete(incomplete, "medication")
	if res := f.want(f.asMember(m, "POST", path, map[string]any{"answers": incomplete}), 400); res.Body["code"] != "PARQ_INCOMPLETE" {
		t.Fatalf("incomplete: %s", res.Raw)
	}

	parqFlags := func() []map[string]any {
		t.Helper()
		res := f.want(f.as(manager, "GET", "/api/gym/member-flags/members?ids="+m, nil), 200)
		var out []map[string]any
		for _, fl := range res.list()[0].(map[string]any)["flags"].([]any) {
			out = append(out, fl.(map[string]any))
		}
		return out
	}
	submit := func(answers map[string]any, details string) map[string]any {
		t.Helper()
		f.clock = f.clock.Add(time.Minute)
		return f.want(f.asMember(m, "POST", path, map[string]any{"answers": answers, "details": details}), 201).data()
	}

	// All no: current for 12 months, no flag.
	d := submit(allNo(), "")
	if d["due"] != false || len(parqFlags()) != 0 {
		t.Fatalf("all no: %v", d)
	}
	if ok, err := ParqCurrent(f.ctx, f.tx, m, f.clock); err != nil || !ok {
		t.Fatalf("current: %v %v", ok, err)
	}

	// A yes opens the review flag with the summary for coaches.
	yes := allNo()
	yes["chest_pain"] = true
	submit(yes, "kadang sesak")
	flags := parqFlags()
	if len(flags) != 1 || flags[0]["type_code"] != domain.ParqTypeCode || flags[0]["review_status"] != "pending" ||
		flags[0]["category"] != "medical" || flags[0]["note"] != "PAR-Q ya: nyeri dada saat istirahat atau beraktivitas. Keterangan member: kadang sesak" {
		t.Fatalf("yes flag: %v", flags)
	}
	flagID := flags[0]["id"].(string)
	// The desk sees a count, never the answers.
	res = f.want(f.as(desk, "GET", "/api/gym/member-flags/members?ids="+m, nil), 200)
	if got := flagCodes(res); !slices.Equal(got, []string{" +m"}) || strings.Contains(res.Raw, "nyeri") {
		t.Fatalf("desk: %s", res.Raw)
	}
	f.want(f.as(desk, "GET", "/api/gym/health-declarations/"+m, nil), 403)
	res = f.want(f.as(manager, "GET", "/api/gym/health-declarations/"+m, nil), 200)
	if last := res.data()["last"].(map[string]any); last["answers"].(map[string]any)["chest_pain"] != true || last["details"] != "kadang sesak" {
		t.Fatalf("staff parq: %s", res.Raw)
	}

	// The same answers keep the flag; a reviewed restriction survives an
	// all-no declaration; new answers reopen the review.
	submit(yes, "kadang sesak")
	if flags := parqFlags(); len(flags) != 1 || flags[0]["id"] != flagID {
		t.Fatalf("same answers: %v", flags)
	}
	f.want(f.as(manager, "POST", "/api/gym/member-flags/"+flagID+"/review", map[string]any{"decision": "restricted", "note": "tanpa sprint"}), 200)
	submit(allNo(), "")
	if flags := parqFlags(); len(flags) != 1 || flags[0]["review_status"] != "restricted" {
		t.Fatalf("restriction kept: %v", flags)
	}
	yes["bone_joint"] = true
	submit(yes, "")
	if flags := parqFlags(); len(flags) != 1 || flags[0]["id"] != flagID || flags[0]["review_status"] != "pending" ||
		!strings.Contains(flags[0]["note"].(string), "masalah tulang") {
		t.Fatalf("reopened: %v", flags)
	}
	// Cleared removes it; a pending flag goes away on an all-no declaration.
	f.want(f.as(manager, "POST", "/api/gym/member-flags/"+flagID+"/review", map[string]any{"decision": "bogus"}), 400)
	f.want(f.as(manager, "POST", "/api/gym/member-flags/"+flagID+"/review", map[string]any{"decision": "cleared"}), 200)
	if flags := parqFlags(); len(flags) != 0 {
		t.Fatalf("cleared: %v", flags)
	}
	submit(yes, "")
	submit(allNo(), "")
	if flags := parqFlags(); len(flags) != 0 {
		t.Fatalf("pending removed: %v", flags)
	}

	// Twelve months later the declaration has expired.
	f.clock = f.clock.AddDate(1, 0, 0).Add(-time.Second)
	if d := f.want(f.asMember(m, "GET", path, nil), 200).data(); d["due"] != false {
		t.Fatalf("expires a year after the last declaration: %v", d)
	}
	f.clock = f.clock.Add(time.Second)
	if d := f.want(f.asMember(m, "GET", path, nil), 200).data(); d["due"] != true {
		t.Fatalf("expired: %v", d)
	}
	if ok, err := ParqCurrent(f.ctx, f.tx, m, f.clock); err != nil || ok {
		t.Fatalf("expired current: %v %v", ok, err)
	}
}

func noteBodies(res response) []string {
	var out []string
	for _, raw := range res.list() {
		for _, n := range raw.(map[string]any)["notes"].([]any) {
			note := n.(map[string]any)
			body := note["body"].(string)
			if note["pinned"] == true {
				body += "*"
			}
			out = append(out, body)
		}
	}
	return out
}

func TestCoachNotesCarryForward(t *testing.T) {
	f := newFixture(t)
	manager := f.staff("Manajer", "manager", false)
	coachA := f.staff("A", "coach", true)
	coachB := f.staff("B", "coach", true)
	coachC := f.staff("C", "coach", true)
	m, other := f.member("Rani"), f.member("Lain")

	yesterday := f.class(coachA.coach, f.clock.Add(-24*time.Hour), m, "completed")
	f.class(coachB.coach, f.clock.Add(24*time.Hour), m, "confirmed")
	pt := f.pt(coachA.coach, f.clock.Add(-time.Hour), m)
	old := f.class(coachA.coach, f.clock.AddDate(0, 0, -8), m, "completed")
	future := f.class(coachA.coach, f.clock.Add(3*time.Hour), m, "confirmed")

	note := func(who staffUser, body map[string]any, status int) map[string]any {
		t.Helper()
		return f.want(f.as(who, "POST", "/api/gym/coach-notes", body), status).data()
	}
	carried := note(coachA, map[string]any{"customer_id": m, "session_id": yesterday, "body": "hindari lunge, lutut kiri", "carry_forward": true}, 201)
	f.clock = f.clock.Add(time.Minute)
	note(coachA, map[string]any{"customer_id": m, "session_id": yesterday, "body": "pace bagus"}, 201)
	f.clock = f.clock.Add(time.Minute)
	ptNote := note(coachA, map[string]any{"customer_id": m, "pt_appointment_id": pt, "body": "deadlift 60 kg", "carry_forward": true}, 201)
	if carried["pinned"] != true || carried["mine"] != true || carried["session_label"] != "Care Test "+f.sfx {
		t.Fatalf("note: %v", carried)
	}
	// The write window, the roster and the coach.
	note(coachA, map[string]any{"customer_id": m, "session_id": old, "body": "terlambat"}, 409)
	note(coachA, map[string]any{"customer_id": m, "session_id": future, "body": "terlalu cepat"}, 409)
	note(coachA, map[string]any{"customer_id": other, "session_id": yesterday, "body": "bukan member sesi"}, 400)
	note(coachB, map[string]any{"customer_id": m, "session_id": yesterday, "body": "bukan sesi B"}, 404)
	note(manager, map[string]any{"customer_id": m, "session_id": yesterday, "body": "manajer"}, 403)
	note(coachA, map[string]any{"customer_id": m, "session_id": yesterday, "pt_appointment_id": pt, "body": "dua sesi"}, 400)

	roster := "/api/gym/coach-notes?customer_ids=" + m
	// B coaches Rani tomorrow and sees what A carried forward; C does not
	// coach her and sees nothing.
	if got := noteBodies(f.want(f.as(coachB, "GET", roster, nil), 200)); !slices.Equal(got, []string{"deadlift 60 kg*", "hindari lunge, lutut kiri*", "pace bagus"}) {
		t.Fatalf("coach B roster: %q", got)
	}
	if got := noteBodies(f.want(f.as(coachC, "GET", roster, nil), 200)); len(got) != 0 {
		t.Fatalf("coach C roster: %q", got)
	}
	f.want(f.as(coachC, "POST", "/api/gym/coach-notes/"+carried["id"].(string)+"/release", nil), 404)
	if got := noteBodies(f.want(f.as(manager, "GET", roster, nil), 200)); len(got) != 3 {
		t.Fatalf("manager roster: %q", got)
	}

	// B releases the knee note: it drops to history.
	f.want(f.as(coachB, "POST", "/api/gym/coach-notes/"+carried["id"].(string)+"/release", nil), 200)
	f.want(f.as(coachB, "POST", "/api/gym/coach-notes/"+carried["id"].(string)+"/release", nil), 200)
	if got := noteBodies(f.want(f.as(coachB, "GET", roster, nil), 200)); !slices.Equal(got, []string{"deadlift 60 kg*", "pace bagus", "hindari lunge, lutut kiri"}) {
		t.Fatalf("after release: %q", got)
	}
	// Only the author deletes.
	f.want(f.as(coachB, "DELETE", "/api/gym/coach-notes/"+ptNote["id"].(string), nil), 403)

	// Two months on, only the note still carried forward shows on B's
	// next class.
	f.clock = f.clock.AddDate(0, 0, 61)
	f.class(coachB.coach, f.clock.Add(time.Hour), m, "confirmed")
	if got := noteBodies(f.want(f.as(coachB, "GET", roster, nil), 200)); !slices.Equal(got, []string{"deadlift 60 kg*"}) {
		t.Fatalf("after 61 days: %q", got)
	}
	res := f.want(f.as(coachB, "GET", "/api/gym/coach-notes/members/"+m, nil), 200)
	if len(res.list()) != 1 {
		t.Fatalf("history: %s", res.Raw)
	}
	f.want(f.as(coachA, "DELETE", "/api/gym/coach-notes/"+ptNote["id"].(string), nil), 200)
	if got := noteBodies(f.want(f.as(coachB, "GET", roster, nil), 200)); len(got) != 0 {
		t.Fatalf("after delete: %q", got)
	}
}

func TestFlagTypes(t *testing.T) {
	f := newFixture(t)
	manager := f.staff("Manajer", "manager", false)
	label := "Cedera Bahu " + f.sfx
	body := map[string]any{"label": label, "category": "medical", "icon": "bandage", "color": "danger", "default_expiry_days": 14}
	first := f.want(f.as(manager, "POST", "/api/gym/member-flag-types", body), 201).data()
	second := f.want(f.as(manager, "POST", "/api/gym/member-flag-types", body), 201).data()
	if first["code"] != domain.TypeCode(label) || second["code"] != domain.TypeCode(label)+"_2" || first["default_expiry_days"] != 14.0 {
		t.Fatalf("codes %v %v", first["code"], second["code"])
	}
	f.want(f.as(manager, "POST", "/api/gym/member-flag-types", map[string]any{"label": "X", "category": "medical", "icon": "skull"}), 400)

	id := second["id"].(string)
	f.want(f.as(manager, "PATCH", "/api/gym/member-flag-types/"+id, map[string]any{"is_active": false, "default_expiry_days": nil}), 200)
	active := f.want(f.as(manager, "GET", "/api/gym/member-flag-types", nil), 200).list()
	all := f.want(f.as(manager, "GET", "/api/gym/member-flag-types?all=1", nil), 200).list()
	if len(all) != len(active)+1 {
		t.Fatalf("inactive type: %d active, %d all", len(active), len(all))
	}
	// The PAR-Q type stays on and medical.
	parq := f.typeID(domain.ParqTypeCode)
	f.want(f.as(manager, "PATCH", "/api/gym/member-flag-types/"+parq, map[string]any{"is_active": false}), 400)
	f.want(f.as(manager, "PATCH", "/api/gym/member-flag-types/"+parq, map[string]any{"category": "general"}), 400)
	f.want(f.as(manager, "PATCH", "/api/gym/member-flag-types/"+parq, map[string]any{"color": "danger"}), 200)
}
