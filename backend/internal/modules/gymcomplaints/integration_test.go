package gymcomplaints

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

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run in one rolled-back transaction. The clock starts on
// Monday 2 June 2031, 10:00 WITA, at a Makassar branch.

type headerGuard struct{}

func (headerGuard) RequireAnyGrant(r *http.Request, _ ...iam.Grant) (*auth.User, int, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, -1, httpx.Unauthorized("")
	}
	return &auth.User{ID: id}, 0, nil
}

func (headerGuard) RequireMember(r *http.Request) (string, error) {
	id := r.Header.Get("X-Test-Member")
	if id == "" {
		return "", httpx.Unauthorized("Unauthorized")
	}
	return id, nil
}

// sentWA records WhatsApp sends.
type sentWA struct{ to, text []string }

func (s *sentWA) SendWhatsApp(_ context.Context, phone, text string) bool {
	s.to, s.text = append(s.to, phone), append(s.text, text)
	return true
}

var wita = localtime.Zone("Asia/Makassar")

func witaAt(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, wita)
	if err != nil {
		panic(err)
	}
	return t
}

type fixture struct {
	t      *testing.T
	ctx    context.Context
	tx     pgx.Tx
	svc    *Service
	mux    *http.ServeMux
	wa     *sentWA
	now    time.Time
	sfx    string
	branch string
	staff  string // desk staff user
	head   string // head coach user, the branch's escalation contact
	coach  string
	member string
	class  string // a class session the member attended, coached by coach
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	f := &fixture{t: t, ctx: context.Background(), tx: tx, now: witaAt("2031-06-02 10:00"), wa: &sentWA{}, sfx: testutil.RandomHex(4)}
	f.svc = NewService(tx, Ports{WhatsApp: f.wa, AppOrigin: "https://app.test"}, func() time.Time { return f.now },
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	f.mux = testutil.Mux(mod{h: &handler{svc: f.svc, guard: headerGuard{}}})

	f.branch = testutil.CreateOrg(t, tx).BranchID
	f.exec(`UPDATE configuration.branches SET timezone = 'Asia/Makassar' WHERE id = $1`, f.branch)
	f.staff = f.user("Desk " + f.sfx)
	f.head = f.user("Head Coach " + f.sfx)
	f.id(`INSERT INTO hris.employees (full_name, nip, email, phone, join_date, user_id)
	      VALUES ($1, $2, $3, '081234500001', '2030-01-01', $4)`, "Head Coach "+f.sfx, "NIP"+f.sfx, f.sfx+"@head.test", f.head)
	f.exec(`INSERT INTO gym.complaint_settings (branch_id, escalation_user_id) VALUES ($1, $2)`, f.branch, f.head)
	f.coach = f.id(`INSERT INTO gym.coaches (name, branch_id) VALUES ($1, $2)`, "Coach "+f.sfx, f.branch)
	f.member = f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, $2)`, "+6298"+testutil.RandomHex(4), "Member "+f.sfx)
	f.class = f.session(f.coach, witaAt("2031-06-01 18:00"))
	f.book(f.class, f.member, "completed")
	return f
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
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

func (f *fixture) user(name string) string {
	f.t.Helper()
	id := f.id(`INSERT INTO auth.users (email, password_hash) VALUES ($1, 'x')`, testutil.RandomHex(6)+"@test.local")
	f.exec(`INSERT INTO configuration.users (id, full_name, role) VALUES ($1, $2, 'pos')`, id, name)
	return id
}

func (f *fixture) session(coachID string, start time.Time) string {
	f.t.Helper()
	ct := f.id(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
	            VALUES ($1, 60, 1, 12)`, "HYROX Engine "+testutil.RandomHex(3))
	return f.id(`INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, starts_at, ends_at, capacity, credit_cost,
	               booking_opens_at, booking_closes_at, status)
	             VALUES ($1, $2, $3, $4, $4::timestamptz + interval '1 hour', 12, 1, $4::timestamptz - interval '7 days', $4, 'completed')`,
		ct, coachID, f.branch, start)
}

func (f *fixture) book(sessionID, customerID, status string) {
	f.t.Helper()
	f.exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, $3)`, sessionID, customerID, status)
}

type response struct {
	Status int
	Body   map[string]any
	Raw    string
}

func (r response) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }

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

func expect(t *testing.T, res response, status int, code string) {
	t.Helper()
	if res.Status != status || (code != "" && res.Body["code"] != code) {
		t.Fatalf("want %d %s, got %d %s", status, code, res.Status, res.Raw)
	}
}

func (f *fixture) ticket(id string) map[string]any {
	f.t.Helper()
	res := f.asStaff("GET", "/api/gym/complaints/"+id, nil)
	expect(f.t, res, 200, "")
	return res.data()
}

func TestCreateFromFrontDesk(t *testing.T) {
	f := newFixture(t)
	res := f.asStaff("POST", "/api/gym/complaints", map[string]any{
		"category": "coach", "description": "Coach datang terlambat 15 menit", "customer_id": f.member, "session_id": f.class,
	})
	expect(t, res, 201, "")
	id, code := res.data()["id"].(string), res.data()["code"].(string)
	if code != "KEL-3106-0001" {
		t.Errorf("code = %s", code)
	}
	tk := f.ticket(id)
	if tk["source"] != "front_desk" || tk["coach_id"] != f.coach || tk["branch_id"] != f.branch || tk["status"] != "received" ||
		tk["priority"] != "normal" || tk["title"] != "Coach datang terlambat 15 menit" || tk["timezone"] != "Asia/Makassar" {
		t.Fatalf("ticket = %v", tk)
	}
	// Normal priority counts 08.00-21.00 WITA: 8h respond lands at 18.00, 48h resolve on Thursday 19.00.
	if tk["respond_by"] != witaAt("2031-06-02 18:00").UTC().Format(httpx.JSTimeLayout) ||
		tk["resolve_by"] != witaAt("2031-06-05 19:00").UTC().Format(httpx.JSTimeLayout) {
		t.Errorf("deadlines = %v / %v", tk["respond_by"], tk["resolve_by"])
	}
	events := tk["events"].([]any)
	if len(events) != 1 || events[0].(map[string]any)["kind"] != "created" {
		t.Errorf("events = %v", events)
	}

	// A staff ticket without a member needs a contact.
	expect(t, f.asStaff("POST", "/api/gym/complaints", map[string]any{"category": "fasilitas", "source": "staff"}), 400, "")
	res = f.asStaff("POST", "/api/gym/complaints", map[string]any{"category": "kebersihan", "source": "staff", "priority": "urgent",
		"contact_name": "Tamu", "branch_id": f.branch, "owner_user_id": f.head})
	expect(t, res, 201, "")
	if res.data()["code"] != "KEL-3106-0002" {
		t.Errorf("second code = %v", res.data()["code"])
	}
	tk = f.ticket(res.data()["id"].(string))
	if tk["source"] != "staff" || tk["owner_user_id"] != f.head || tk["respond_by"] != f.now.Add(time.Hour).UTC().Format(httpx.JSTimeLayout) {
		t.Errorf("staff ticket = %v", tk)
	}
	if n := f.scalar(`SELECT count(*)::text FROM public.notifications WHERE user_id = $1 AND metadata->>'gym_type' = 'gym_complaint_assigned'`, f.head); n != "1" {
		t.Errorf("owner notices = %s", n)
	}
	expect(t, f.asStaff("POST", "/api/gym/complaints", map[string]any{"category": "nope", "contact_name": "x"}), 400, "COMPLAINT_CATEGORY_INVALID")

	list := f.asStaff("GET", "/api/gym/complaints?status=open&branch_id="+f.branch, nil)
	expect(t, list, 200, "")
	if list.data()["total"].(float64) != 2 {
		t.Errorf("list = %s", list.Raw)
	}
	mine := f.asStaff("GET", "/api/gym/complaints/member-classes?customer_id="+f.member, nil)
	expect(t, mine, 200, "")
	if rows, _ := mine.Body["data"].([]any); len(rows) != 1 {
		t.Errorf("member classes = %s", mine.Raw)
	}
}

func TestCreateFromInboxConversation(t *testing.T) {
	f := newFixture(t)
	conv := f.id(`INSERT INTO crm.wa_conversations (phone, external_id, customer_id, display_name, category, priority,
	                sla_response_breached, last_message_preview)
	              VALUES ($1, $3, $2, 'Rina', 'pembayaran', 'normal', true, 'Kredit saya terpotong dua kali')`,
		"62811"+testutil.RandomHex(3), f.member, "wa-"+testutil.RandomHex(4))
	view := f.asStaff("GET", "/api/gym/complaints/conversations/"+conv+"/ticket", nil)
	expect(t, view, 200, "")
	sug := view.data()["suggestion"].(map[string]any)
	if view.data()["ticket"] != nil || sug["category"] != "pembayaran" || sug["priority"] != "high" || sug["customer_id"] != f.member {
		t.Fatalf("view = %s", view.Raw)
	}

	res := f.asStaff("POST", "/api/gym/complaints/conversations/"+conv+"/ticket", map[string]any{"branch_id": f.branch})
	expect(t, res, 201, "")
	tk := f.ticket(res.data()["id"].(string))
	if tk["source"] != "wa_inbox" || tk["conversation_id"] != conv || tk["priority"] != "high" || tk["category"] != "pembayaran" ||
		tk["description"] != "Kredit saya terpotong dua kali" || tk["contact_name"] != "Rina" {
		t.Fatalf("ticket = %v", tk)
	}
	if f.scalar(`SELECT is_complaint::text FROM crm.wa_conversations WHERE id = $1`, conv) != "true" {
		t.Error("conversation not flagged as complaint")
	}
	again := f.asStaff("POST", "/api/gym/complaints/conversations/"+conv+"/ticket", nil)
	expect(t, again, 409, "COMPLAINT_EXISTS")
	if again.Body["params"].(map[string]any)["id"] != tk["id"] {
		t.Errorf("409 params = %s", again.Raw)
	}
	view = f.asStaff("GET", "/api/gym/complaints/conversations/"+conv+"/ticket", nil)
	if view.data()["ticket"].(map[string]any)["id"] != tk["id"] {
		t.Errorf("view after create = %s", view.Raw)
	}
}

func TestMemberAppReportAndResolution(t *testing.T) {
	f := newFixture(t)
	opts := f.asMember(f.member, "GET", "/api/member-portal/gym/feedback/options", nil)
	expect(t, opts, 200, "")
	classes := opts.data()["classes"].([]any)
	if len(classes) != 1 || classes[0].(map[string]any)["coach_id"] != f.coach || len(opts.data()["categories"].([]any)) != 7 {
		t.Fatalf("options = %s", opts.Raw)
	}

	expect(t, f.asMember(f.member, "POST", "/api/member-portal/gym/feedback", map[string]any{"category": "kelas", "message": "pendek"}), 400, "FEEDBACK_TOO_SHORT")
	other := f.session(f.coach, witaAt("2031-06-01 07:00"))
	expect(t, f.asMember(f.member, "POST", "/api/member-portal/gym/feedback", map[string]any{
		"category": "kelas", "message": "Kelas ini terlalu penuh", "session_id": other}), 404, "SESSION_NOT_FOUND")

	res := f.asMember(f.member, "POST", "/api/member-portal/gym/feedback", map[string]any{
		"kind": "problem", "category": "coach", "message": "Coach tidak memberi pemanasan sama sekali", "session_id": f.class})
	expect(t, res, 201, "")
	id := res.data()["id"].(string)
	tk := f.ticket(id)
	if tk["source"] != "member_app" || tk["coach_id"] != f.coach || tk["created_by_name"] != nil || tk["priority"] != "normal" {
		t.Fatalf("ticket = %v", tk)
	}
	if n := f.scalar(`SELECT count(*)::text FROM public.notifications WHERE user_id = $1 AND metadata->>'gym_type' = 'gym_complaint_new'`, f.head); n != "1" {
		t.Errorf("head coach new-report notices = %s", n)
	}

	// Staff handle, note internally, reply publicly and resolve.
	expect(t, f.asStaff("POST", "/api/gym/complaints/"+id+"/status", map[string]any{"status": "in_progress"}), 200, "")
	expect(t, f.asStaff("POST", "/api/gym/complaints/"+id+"/notes", map[string]any{"body": "Sudah bicara dengan coach"}), 200, "")
	expect(t, f.asStaff("POST", "/api/gym/complaints/"+id+"/notes", map[string]any{"body": "Terima kasih, kami tindak lanjuti", "public": true}), 200, "")
	expect(t, f.asStaff("POST", "/api/gym/complaints/"+id+"/status", map[string]any{"status": "resolved"}), 400, "COMPLAINT_NOTE_REQUIRED")
	expect(t, f.asStaff("POST", "/api/gym/complaints/"+id+"/status", map[string]any{"status": "confirmed"}), 409, "COMPLAINT_BAD_STATUS")
	f.now = f.now.Add(3 * time.Hour)
	res = f.asStaff("POST", "/api/gym/complaints/"+id+"/status", map[string]any{"status": "resolved", "note": "Coach sudah diingatkan SOP pemanasan"})
	expect(t, res, 200, "")
	if res.data()["owner_user_id"] != f.staff || res.data()["first_response_at"] == nil || res.data()["resolved_at"] == nil {
		t.Fatalf("resolved = %s", res.Raw)
	}
	if n := f.scalar(`SELECT count(*)::text FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_complaint'`, f.member); n != "3" {
		t.Errorf("member notices = %s, want in_progress, reply and resolved", n)
	}

	// The member sees public entries only, then reopens with a reason.
	mine := f.asMember(f.member, "GET", "/api/member-portal/gym/feedback/"+id, nil)
	expect(t, mine, 200, "")
	for _, e := range mine.data()["events"].([]any) {
		if body, _ := e.(map[string]any)["body"].(string); body == "Sudah bicara dengan coach" {
			t.Error("internal note leaked to the member")
		}
	}
	if strings.Contains(mine.Raw, "Desk "+f.sfx) {
		t.Error("staff name leaked to the member")
	}
	stranger := f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Lain')`, "+6297"+testutil.RandomHex(4))
	expect(t, f.asMember(stranger, "GET", "/api/member-portal/gym/feedback/"+id, nil), 404, "COMPLAINT_NOT_FOUND")
	expect(t, f.asMember(f.member, "POST", "/api/member-portal/gym/feedback/"+id+"/reopen", map[string]any{}), 400, "COMPLAINT_NOTE_REQUIRED")
	f.now = f.now.Add(time.Hour)
	res = f.asMember(f.member, "POST", "/api/member-portal/gym/feedback/"+id+"/reopen", map[string]any{"reason": "Minggu ini terulang lagi"})
	expect(t, res, 200, "")
	tk = f.ticket(id)
	if tk["status"] != "reopened" || tk["reopen_count"].(float64) != 1 || tk["resolved_at"] != nil ||
		tk["resolve_by"] != witaAt("2031-06-06 10:00").UTC().Format(httpx.JSTimeLayout) {
		t.Fatalf("reopened = %v", tk)
	}
	if n := f.scalar(`SELECT count(*)::text FROM public.notifications WHERE metadata->>'gym_type' = 'gym_complaint_reopened'
	                    AND metadata->>'complaint_id' = $1`, id); n != "2" {
		t.Errorf("reopen notices = %s, want owner and head coach", n)
	}
	expect(t, f.asMember(f.member, "POST", "/api/member-portal/gym/feedback/"+id+"/confirm", nil), 409, "FEEDBACK_NOT_RESOLVED")
	expect(t, f.asStaff("POST", "/api/gym/complaints/"+id+"/status", map[string]any{"status": "resolved", "note": "Jadwal coach diganti"}), 200, "")
	expect(t, f.asMember(f.member, "POST", "/api/member-portal/gym/feedback/"+id+"/confirm", nil), 200, "")
	if f.ticket(id)["status"] != "confirmed" {
		t.Error("member confirm")
	}
	list := f.asMember(f.member, "GET", "/api/member-portal/gym/feedback", nil)
	if rows, _ := list.Body["data"].([]any); len(rows) != 1 || rows[0].(map[string]any)["status"] != "confirmed" {
		t.Errorf("my tickets = %s", list.Raw)
	}

	// Kelas Saya: the coach's account sees the ticket.
	coachUser := f.user("Coach User " + f.sfx)
	f.exec(`UPDATE gym.coaches SET user_id = $2 WHERE id = $1`, f.coach, coachUser)
	cres := f.do("GET", "/api/gym/my-classes/complaints", map[string]string{"X-Test-Staff": coachUser}, nil)
	expect(t, cres, 200, "")
	if tickets := cres.data()["tickets"].([]any); len(tickets) != 1 || strings.Contains(cres.Raw, "member_phone") {
		t.Errorf("coach view = %s", cres.Raw)
	}
}

func TestMemberDailyLimit(t *testing.T) {
	f := newFixture(t)
	for i := range 5 {
		expect(t, f.asMember(f.member, "POST", "/api/member-portal/gym/feedback", map[string]any{
			"kind": "feedback", "category": "fasilitas", "message": "Tolong tambah loker nomor " + string(rune('A'+i))}), 201, "")
	}
	expect(t, f.asMember(f.member, "POST", "/api/member-portal/gym/feedback", map[string]any{
		"category": "fasilitas", "message": "Satu laporan lagi hari ini"}), 429, "FEEDBACK_DAILY_LIMIT")
	if p := f.scalar(`SELECT min(priority) FROM gym.complaints WHERE customer_id = $1`, f.member); p != "low" {
		t.Errorf("feedback priority = %s", p)
	}
	f.now = f.now.Add(25 * time.Hour)
	expect(t, f.asMember(f.member, "POST", "/api/member-portal/gym/feedback", map[string]any{
		"category": "fasilitas", "message": "Besoknya boleh lapor lagi"}), 201, "")
}

func TestEscalationOnceAndQuietHours(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE gym.complaint_settings SET escalation_phone = '0812 9999 0001' WHERE branch_id = $1`, f.branch)
	owner := f.user("Owner " + f.sfx)
	f.id(`INSERT INTO hris.employees (full_name, nip, email, phone, join_date, user_id)
	      VALUES ('Owner', $1, $2, '081277770002', '2030-01-01', $3)`, "NIPO"+f.sfx, f.sfx+"@owner.test", owner)
	normal, err := f.svc.Create(f.ctx, f.staff, NewTicket{Source: "front_desk", Category: "fasilitas", CustomerID: &f.member, BranchID: &f.branch, OwnerUserID: &owner})
	if err != nil {
		t.Fatal(err)
	}
	urgent, err := f.svc.Create(f.ctx, f.staff, NewTicket{Source: "front_desk", Category: "kebersihan", Priority: "urgent", CustomerID: &f.member, BranchID: &f.branch})
	if err != nil {
		t.Fatal(err)
	}

	// 22.00 WITA: the normal ticket missed respond, the urgent one missed
	// both. Only the urgent one goes out at night, as one resolve message.
	night := witaAt("2031-06-02 22:00")
	if err := f.svc.Escalate(f.ctx, night); err != nil {
		t.Fatal(err)
	}
	if len(f.wa.to) != 1 || f.wa.to[0] != "6281299990001" || !strings.Contains(f.wa.text[0], urgent.Code+" belum selesai") ||
		!strings.Contains(f.wa.text[0], "https://app.test/dashboard/gym/complaints/"+urgent.ID) {
		t.Fatalf("night sends = %v %v", f.wa.to, f.wa.text)
	}
	if f.scalar(`SELECT (respond_escalated_at IS NOT NULL AND resolve_escalated_at IS NOT NULL)::text FROM gym.complaints WHERE id = $1`, urgent.ID) != "true" {
		t.Error("the resolve escalation closes the pending respond one")
	}
	if f.scalar(`SELECT (respond_escalated_at IS NULL)::text FROM gym.complaints WHERE id = $1`, normal.ID) != "true" {
		t.Error("normal ticket escalated at night")
	}
	// A second run in the same night sends nothing new.
	if err := f.svc.Escalate(f.ctx, night.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if len(f.wa.to) != 1 {
		t.Fatalf("dedupe: %v", f.wa.to)
	}

	// 08.30 next day: the normal ticket escalates to the head coach and its owner.
	morning := witaAt("2031-06-03 08:30")
	if err := f.svc.Escalate(f.ctx, morning); err != nil {
		t.Fatal(err)
	}
	if len(f.wa.to) != 3 || f.wa.to[1] != "6281299990001" || f.wa.to[2] != "6281277770002" || !strings.Contains(f.wa.text[1], normal.Code+" belum ditangani") {
		t.Fatalf("morning sends = %v", f.wa.to)
	}
	alerts := f.scalar(`SELECT string_agg(user_id::text || ':' || (metadata->>'kind'), ',' ORDER BY user_id, metadata->>'kind')
	  FROM public.notifications WHERE metadata->>'gym_type' = 'gym_complaint_sla' AND metadata->>'complaint_id' = $1`, normal.ID)
	if !strings.Contains(alerts, f.head+":respond") || !strings.Contains(alerts, owner+":respond") {
		t.Errorf("inbox alerts = %s", alerts)
	}
	if n := f.scalar(`SELECT count(*)::text FROM gym.complaint_events WHERE complaint_id = $1 AND kind = 'escalated'`, normal.ID); n != "1" {
		t.Errorf("escalated events = %s", n)
	}
	if err := f.svc.Escalate(f.ctx, witaAt("2031-06-03 09:00")); err != nil {
		t.Fatal(err)
	}
	if len(f.wa.to) != 3 {
		t.Fatalf("morning dedupe = %v", f.wa.to)
	}

	// A reopened ticket gets a new deadline and may escalate again once.
	f.now = witaAt("2031-06-03 09:10")
	if err := f.svc.Move(f.ctx, f.staff, urgent.ID, "resolved", "Toilet sudah dibersihkan"); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Move(f.ctx, f.staff, urgent.ID, "reopened", "Member bilang masih kotor"); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Escalate(f.ctx, witaAt("2031-06-03 09:20")); err != nil {
		t.Fatal(err)
	}
	if len(f.wa.to) != 3 {
		t.Fatalf("fresh deadline escalated early: %v", f.wa.text)
	}
	for _, at := range []string{"2031-06-03 17:30", "2031-06-03 17:35"} {
		if err := f.svc.Escalate(f.ctx, witaAt(at)); err != nil {
			t.Fatal(err)
		}
	}
	if len(f.wa.to) != 4 || !strings.Contains(f.wa.text[3], urgent.Code+" belum selesai") {
		t.Fatalf("reopened escalation = %v", f.wa.text)
	}
}

func TestReportFigures(t *testing.T) {
	f := newFixture(t)
	other := f.id(`INSERT INTO gym.coaches (name, branch_id) VALUES ($1, $2)`, "Coach B "+f.sfx, f.branch)
	// Coach A: 4 attendees in June (the fixture's member plus three), Coach B: 2.
	for i := range 3 {
		m := f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, $2)`, "+6296"+testutil.RandomHex(4), "Peserta "+string(rune('A'+i)))
		f.book(f.class, m, "checked_in")
	}
	bClass := f.session(other, witaAt("2031-06-01 07:00"))
	f.book(bClass, f.member, "completed")
	f.book(bClass, f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Peserta B')`, "+6295"+testutil.RandomHex(4)), "checked_in")
	f.book(bClass, f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Absen')`, "+6294"+testutil.RandomHex(4)), "no_show")

	mk := func(category, source string, coach *string, created time.Time, resolvedAfter time.Duration, reopened int) {
		f.t.Helper()
		var resolved any
		status := "received"
		if resolvedAfter > 0 {
			resolved, status = created.Add(resolvedAfter), "resolved"
		}
		f.exec(`INSERT INTO gym.complaints (code, source, category, priority, status, title, customer_id, coach_id, branch_id,
		          sla_started_at, respond_by, resolve_by, first_response_at, resolved_at, reopen_count, created_at)
		        VALUES ($1, $2, $3, 'normal', $4, 'x', $5, $6, $7, $8, $8, $8, $9, $9, $10, $8)`,
			"T-"+testutil.RandomHex(4), source, category, status, f.member, coach, f.branch, created, resolved, reopened)
	}
	june := witaAt("2031-06-01 12:00")
	mk("coach", "member_app", &f.coach, june, 2*time.Hour, 0)
	mk("coach", "front_desk", &f.coach, june, 4*time.Hour, 1)
	mk("kelas", "wa_inbox", &f.coach, june, 10*time.Hour, 0)
	mk("fasilitas", "front_desk", nil, june, 0, 0)
	mk("coach", "staff", &other, june, 6*time.Hour, 0)
	mk("coach", "staff", &f.coach, witaAt("2031-05-20 12:00"), time.Hour, 0) // May: outside the period

	res := f.asStaff("GET", "/api/gym/complaints/report?from=2031-06-01&to=2031-06-30&branch_id="+f.branch, nil)
	expect(t, res, 200, "")
	var rep Report
	raw, _ := json.Marshal(res.data())
	if err := json.Unmarshal(raw, &rep); err != nil {
		t.Fatal(err)
	}
	s := rep.Summary
	// Resolution hours 2, 4, 10, 6: median 5, p90 8.8; one of four resolved reopened.
	if s.Total != 5 || s.Open != 1 || s.Resolved != 4 || s.Reopened != 1 || s.ReopenedRate == nil || *s.ReopenedRate != 0.25 ||
		s.ResolveMedianH == nil || *s.ResolveMedianH != 5 || s.ResolveP90H == nil || *s.ResolveP90H != 8.8 {
		t.Fatalf("summary = %+v", s)
	}
	cats := map[string]int{}
	for _, m := range rep.ByCategory {
		cats[m.Key] = m.Total
	}
	if cats["coach"] != 3 || cats["kelas"] != 1 || cats["fasilitas"] != 1 || rep.ByCategory[0].Label != "Coach" {
		t.Errorf("by category = %+v", rep.ByCategory)
	}
	srcs := map[string]int{}
	for _, m := range rep.BySource {
		srcs[m.Key] = m.Total
	}
	if srcs["front_desk"] != 2 || srcs["member_app"] != 1 || srcs["wa_inbox"] != 1 || srcs["staff"] != 1 {
		t.Errorf("by source = %+v", rep.BySource)
	}
	if len(rep.ByBranch) != 1 || rep.ByBranch[0].Key != f.branch || rep.ByBranch[0].Total != 5 {
		t.Errorf("by branch = %+v", rep.ByBranch)
	}
	coaches := map[string]CoachMetrics{}
	for _, m := range rep.ByCoach {
		coaches[m.Key] = m
	}
	a, b := coaches[f.coach], coaches[other]
	if a.Total != 3 || a.Attendees != 4 || a.RatePer100 == nil || *a.RatePer100 != 75 {
		t.Errorf("coach A = %+v", a)
	}
	if b.Total != 1 || b.Attendees != 2 || b.RatePer100 == nil || *b.RatePer100 != 50 {
		t.Errorf("coach B = %+v", b)
	}
	expect(t, f.asStaff("GET", "/api/gym/complaints/report?from=2031-06-30&to=2031-06-01", nil), 400, "")
}

func TestSettingsAndCategories(t *testing.T) {
	f := newFixture(t)
	res := f.asStaff("GET", "/api/gym/complaints/settings?branch_id="+f.branch, nil)
	expect(t, res, 200, "")
	if res.data()["inherited"] != false || res.data()["escalation_user_id"] != f.head || res.data()["work_start"] != "08:00" {
		t.Fatalf("settings = %s", res.Raw)
	}
	expect(t, f.asStaff("PUT", "/api/gym/complaints/settings", map[string]any{"branch_id": f.branch, "work_start": "21:00", "work_end": "08:00"}), 400, "")
	res = f.asStaff("PUT", "/api/gym/complaints/settings", map[string]any{"branch_id": f.branch, "work_start": "06:00", "work_end": "22:00",
		"sla": map[string]any{"normal": map[string]any{"respond_hours": 2, "resolve_hours": 1, "business_hours": true}}})
	expect(t, res, 200, "")
	sla := res.data()["sla"].(map[string]any)["normal"].(map[string]any)
	if sla["respond_hours"].(float64) != 2 || sla["resolve_hours"].(float64) != 2 || res.data()["escalation_user_id"] != nil {
		t.Errorf("saved = %s", res.Raw)
	}
	created, err := f.svc.Create(f.ctx, f.staff, NewTicket{Source: "staff", Category: "lainnya", ContactName: ptr("Tamu"), BranchID: &f.branch})
	if err != nil {
		t.Fatal(err)
	}
	if got := f.ticket(created.ID)["respond_by"]; got != f.now.Add(2*time.Hour).UTC().Format(httpx.JSTimeLayout) {
		t.Errorf("respond_by with new SLA = %v", got)
	}
	res = f.asStaff("PUT", "/api/gym/complaints/settings", map[string]any{"branch_id": f.branch, "reset": true})
	if res.data()["inherited"] != true {
		t.Errorf("reset = %s", res.Raw)
	}

	cats := f.asStaff("PUT", "/api/gym/complaints/categories", map[string]any{"categories": []map[string]any{
		{"code": "parkir", "label": "Parkir", "sort_order": 70, "is_active": true},
		{"code": "kebersihan", "label": "Kebersihan", "sort_order": 40, "is_active": false},
	}})
	expect(t, cats, 200, "")
	expect(t, f.asStaff("POST", "/api/gym/complaints", map[string]any{"category": "kebersihan", "contact_name": "x"}), 400, "COMPLAINT_CATEGORY_INVALID")
	expect(t, f.asStaff("POST", "/api/gym/complaints", map[string]any{"category": "parkir", "contact_name": "x"}), 201, "")
	expect(t, f.asStaff("PUT", "/api/gym/complaints/categories", map[string]any{"categories": []map[string]any{
		{"code": "Bad Code", "label": "x", "is_active": true}}}), 400, "")
}

func ptr(s string) *string { return &s }
