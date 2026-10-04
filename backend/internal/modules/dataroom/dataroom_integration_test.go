package dataroom

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run every write in one rolled-back transaction. The
// guard reads the caller from headers (X-Test-Staff, X-Test-Role,
// X-Test-Deny for refused actions); departments come from rows created in
// the transaction. TestAuthWiring covers the real platform/auth guard.

type headerGuard struct{}

func (headerGuard) user(r *http.Request) (*auth.User, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, httpx.Unauthorized("")
	}
	return &auth.User{ID: id, Role: r.Header.Get("X-Test-Role"), FullName: "Dewi Arsip"}, nil
}

func (g headerGuard) RequireMenuPrefix(r *http.Request, _ ...string) (*auth.User, error) {
	return g.user(r)
}

func (g headerGuard) RequireMenuAction(r *http.Request, action string, _ ...string) (*auth.User, error) {
	if strings.Contains(r.Header.Get("X-Test-Deny"), action) {
		return nil, httpx.Forbidden("Insufficient permissions")
	}
	return g.user(r)
}

func (headerGuard) HasMenuAction(_ context.Context, u *auth.User, action string, _ ...string) (bool, error) {
	return action != "delete", nil
}

// testDirectory mirrors internal/app's adapter on the test transaction,
// with each user's department set by the test.
type testDirectory struct {
	q    database.Querier
	dept map[string]string
}

func (d testDirectory) ActorDepartment(_ context.Context, userID string) (*string, *string, error) {
	id, ok := d.dept[userID]
	if !ok {
		return nil, nil, nil
	}
	name := "Dept " + id[:4]
	return &id, &name, nil
}

func (d testDirectory) Departments(ctx context.Context) ([]DepartmentRef, error) {
	return d.list(ctx, `SELECT id::text, name FROM hris.departments WHERE COALESCE(is_active, true) ORDER BY name`)
}

func (d testDirectory) DepartmentsByID(ctx context.Context, ids []string) ([]DepartmentRef, error) {
	return d.list(ctx, `SELECT id::text, name FROM hris.departments WHERE id = ANY($1::uuid[]) ORDER BY name`, ids)
}

func (d testDirectory) list(ctx context.Context, sql string, args ...any) ([]DepartmentRef, error) {
	rows, err := d.q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[DepartmentRef])
}

type sentMail struct{ to, subject, html string }

type fakeMailer struct {
	mu   sync.Mutex
	sent []sentMail
	fail bool
}

func (m *fakeMailer) Send(_ context.Context, to, _, subject, html string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, sentMail{to, subject, html})
	return !m.fail
}

type fixture struct {
	t     *testing.T
	tx    pgx.Tx
	svc   *Service
	mux   http.Handler
	mail  *fakeMailer
	dir   testDirectory
	staff string
	now   time.Time
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	f := &fixture{t: t, tx: tx, mail: &fakeMailer{}, staff: newUUID(t, tx), now: time.Now()}
	f.dir = testDirectory{q: tx, dept: map[string]string{}}
	f.svc = NewService(tx, Ports{Directory: f.dir, Mailer: f.mail, AppOrigin: "https://app.example", Brand: "NüHabit",
		MailFrom: "Dataroom <x@y.id>", QuotaBytes: 50 * 1024 * 1024 * 1024, MaxFileBytes: 100 * 1024 * 1024}, nil, nil, false)
	f.mux = testutil.Mux(mod{h: &handler{svc: f.svc, guard: headerGuard{}, limiter: domain.NewRateLimiter()}})
	return f
}

func newUUID(t *testing.T, q database.Querier) string {
	t.Helper()
	var id string
	if err := q.QueryRow(context.Background(), `SELECT gen_random_uuid()::text`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

type response struct {
	Status int
	Raw    string
	Body   map[string]any
	Header http.Header
}

func (r response) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }

type call struct {
	method, target string
	body           any
	staff, role    string
	deny           string
	headers        map[string]string
	cookie         *http.Cookie
}

func (f *fixture) do(c call) response {
	f.t.Helper()
	req := testutil.Request(c.method, c.target, c.body)
	if c.staff != "-" {
		staff := c.staff
		if staff == "" {
			staff = f.staff
		}
		req.Header.Set("X-Test-Staff", staff)
	}
	req.Header.Set("X-Test-Role", c.role)
	req.Header.Set("X-Test-Deny", c.deny)
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	if host := c.headers["Host"]; host != "" {
		req.Host = host
	}
	if c.cookie != nil {
		req.AddCookie(c.cookie)
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return response{Status: rec.Code, Raw: rec.Body.String(), Body: out, Header: rec.Header()}
}

func (f *fixture) ok(r response, status int) response {
	f.t.Helper()
	if r.Status != status {
		f.t.Fatalf("status %d, want %d: %s", r.Status, status, r.Raw)
	}
	return r
}

func (f *fixture) fail(r response, status int, msg string) {
	f.t.Helper()
	if r.Status != status || r.Body["error"] != msg {
		f.t.Fatalf("got %d %s, want %d %q", r.Status, r.Raw, status, msg)
	}
}

func (f *fixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var out string
	if err := f.tx.QueryRow(context.Background(), sql, args...).Scan(&out); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return out
}

func (f *fixture) folder(name string, parent *string) string {
	f.t.Helper()
	body := map[string]any{"name": name}
	if parent != nil {
		body["parent_id"] = *parent
	}
	return f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes", body: body}), 201).data()["id"].(string)
}

func (f *fixture) file(name string, parent string) string {
	return f.scalar(`INSERT INTO dataroom.nodes (parent_id, kind, name, mime, size_bytes, storage_path)
		VALUES ($1, 'file', $2, 'application/pdf', 2048, 'dataroom/2026/10/x.pdf') RETURNING id::text`, parent, name)
}

func (f *fixture) department(name string) string {
	return f.scalar(`INSERT INTO hris.departments (name, code) VALUES ($1, $2) RETURNING id::text`, name, "GT-"+testutil.RandomHex(4))
}

func TestFoldersAndAccess(t *testing.T) {
	f := newFixture(t)
	created := f.ok(f.do(call{method: "POST", target: "/api/dataroom/nodes", body: map[string]any{"name": "  Laporan/2026 "}}), 201)
	root := created.data()["id"].(string)
	if !regexp.MustCompile(`^\{"success":true,"data":\{"id":"[0-9a-f-]{36}","parent_id":null,"kind":"folder","name":"Laporan-2026","mime":null,"size_bytes":0,"storage_path":null,"created_by":"` + f.staff + `","created_by_name":"Dewi Arsip","created_at":"[^"]+Z","updated_at":"[^"]+Z"\}\}$`).MatchString(created.Raw) {
		t.Fatalf("create folder: %s", created.Raw)
	}
	sub := f.folder("Keuangan", &root)
	other := f.folder("Lain", &root)
	pdf := f.file("neraca.pdf", sub)
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/nodes", body: map[string]any{"name": "x", "parent_id": pdf}}), 404, "Folder induk tidak ditemukan")

	list := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes?parent=" + sub}), 200).data()
	items := list["items"].([]any)
	item := items[0].(map[string]any)
	if len(items) != 1 || item["size_bytes"] != float64(2048) || len(item["departments"].([]any)) != 0 {
		t.Fatalf("items: %v", items)
	}
	if crumbs := list["ancestors"].([]any); len(crumbs) != 2 || crumbs[0].(map[string]any)["id"] != root {
		t.Fatalf("ancestors: %v", crumbs)
	}
	if raw, _ := json.Marshal(list["usage"]); !strings.Contains(string(raw), `"quota":53687091200,"used":`) {
		t.Fatalf("usage: %s", raw)
	}
	if raw, _ := json.Marshal(list["permissions"]); string(raw) != `{"create":true,"delete":false,"manage_access":false,"update":true}` {
		t.Fatalf("permissions: %s", raw)
	}
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes?parent=" + pdf}), 404, "Folder tidak ditemukan")

	// PATCH (ported from nodes/[id]/route.test.ts): rename, bad body, missing item.
	renamed := f.ok(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + pdf, body: map[string]any{"name": "baru.pdf"}}), 200)
	if renamed.data()["name"] != "baru.pdf" || renamed.data()["id"] != pdf {
		t.Fatalf("rename: %s", renamed.Raw)
	}
	if bad := f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + pdf, body: map[string]any{"name": ""}}); bad.Status != 400 || bad.Body["success"] != false {
		t.Fatalf("bad body: %s", bad.Raw)
	}
	f.fail(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + newUUID(t, f.tx), body: map[string]any{"name": "x"}}), 404, "Item tidak ditemukan")
	f.fail(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + pdf, body: map[string]any{"name": "x"}, deny: "update"}), 403, "Insufficient permissions")
	f.fail(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + root, body: map[string]any{"parent_id": sub}}), 400, "Folder tidak bisa dipindahkan ke dalam dirinya sendiri")
	moved := f.ok(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + pdf, body: map[string]any{"parent_id": other}}), 200)
	if moved.data()["parent_id"] != other {
		t.Fatalf("move: %s", moved.Raw)
	}

	// Department access: only super admin configures; a configured folder
	// hides itself and everything below from other departments.
	hrd, fin := f.department("Go Test HRD"), f.department("Go Test FIN")
	f.fail(f.do(call{method: "PUT", target: "/api/dataroom/nodes/" + other + "/access", body: map[string]any{"department_ids": []string{hrd}}}), 403,
		"Hanya super admin yang bisa mengatur akses departemen")
	set := f.ok(f.do(call{method: "PUT", target: "/api/dataroom/nodes/" + other + "/access", role: "super_admin",
		body: map[string]any{"department_ids": []string{hrd, fin, hrd, newUUID(t, f.tx)}}}), 200)
	if !strings.HasPrefix(set.Raw, `{"success":true,"data":{"node_id":"`+other+`","departments":[{"id":"`+fin+`","name":"Go Test FIN"},{"id":"`+hrd+`","name":"Go Test HRD"}]}}`) {
		t.Fatalf("set access: %s", set.Raw)
	}
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes/" + pdf + "/access"}), 404, "Folder tidak ditemukan")

	ops := newUUID(t, f.tx)
	f.dir.dept[ops] = f.department("Go Test OPS")
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/nodes?parent=" + other, staff: ops}), 403, "Folder ini tidak dibuka untuk departemen Anda")
	f.fail(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + pdf, staff: ops, body: map[string]any{"name": "x"}}), 403, "Item ini tidak dibuka untuk departemen Anda")
	f.fail(f.do(call{method: "PATCH", target: "/api/dataroom/nodes/" + sub, staff: ops, body: map[string]any{"parent_id": other}}), 403, "Folder tujuan tidak dibuka untuk departemen Anda")
	visible := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes?parent=" + root, staff: ops}), 200).data()
	if items := visible["items"].([]any); len(items) != 1 || items[0].(map[string]any)["id"] != sub {
		t.Fatalf("ops sees: %v", items)
	}
	if actor, _ := json.Marshal(visible["actor"]); !strings.Contains(string(actor), `"is_admin":false`) {
		t.Fatalf("actor: %s", actor)
	}
	tree := f.ok(f.do(call{method: "GET", target: "/api/dataroom/tree", staff: ops}), 200)
	if strings.Contains(tree.Raw, other) || !strings.Contains(tree.Raw, sub) {
		t.Fatalf("tree: %s", tree.Raw)
	}
	hrdUser := newUUID(t, f.tx)
	f.dir.dept[hrdUser] = hrd
	hrdView := f.ok(f.do(call{method: "GET", target: "/api/dataroom/nodes?parent=" + root, staff: hrdUser}), 200).data()
	if items := hrdView["items"].([]any); len(items) != 2 || len(items[1].(map[string]any)["departments"].([]any)) != 2 {
		t.Fatalf("hrd sees: %v", items)
	}
	depts := f.ok(f.do(call{method: "GET", target: "/api/dataroom/departments"}), 200)
	if !strings.Contains(depts.Raw, `{"id":"`+hrd+`","name":"Go Test HRD"}`) {
		t.Fatalf("departments: %s", depts.Raw)
	}
	cleared := f.ok(f.do(call{method: "PUT", target: "/api/dataroom/nodes/" + other + "/access", role: "super_admin", body: map[string]any{"department_ids": []string{}}}), 200)
	if cleared.Raw != `{"success":true,"data":{"node_id":"`+other+`","departments":[]}}` {
		t.Fatalf("clear access: %s", cleared.Raw)
	}
}

// share creates a link on node and returns its id and token.
func (f *fixture) share(body map[string]any) (string, string, response) {
	f.t.Helper()
	r := f.ok(f.do(call{method: "POST", target: "/api/dataroom/shares", body: body}), 201)
	return r.data()["id"].(string), r.data()["token"].(string), r
}

func TestSharesAdmin(t *testing.T) {
	f := newFixture(t)
	root := f.folder("Data Room Investor", nil)
	f.file("deck.pdf", root)

	f.fail(f.do(call{method: "POST", target: "/api/dataroom/shares", body: map[string]any{"node_id": root, "access_type": "email", "emails": []string{"salah"}}}), 400,
		"Isi minimal satu email penerima yang valid")
	bad := f.do(call{method: "POST", target: "/api/dataroom/shares", body: map[string]any{"node_id": root, "access_type": "public", "pin": "12"}})
	if bad.Status != 400 || !strings.Contains(bad.Raw, "PIN harus 4–6 digit angka") {
		t.Fatalf("pin: %s", bad.Raw)
	}
	f.fail(f.do(call{method: "POST", target: "/api/dataroom/shares", body: map[string]any{"node_id": newUUID(t, f.tx), "access_type": "public"}}), 404, "Item tidak ditemukan")

	id, token, created := f.share(map[string]any{"node_id": root, "access_type": "email", "emails": []string{" Budi@Wit.id", "ani@wit.id"},
		"pin": "1234", "expires_days": 3, "send_email": true})
	if strings.Contains(created.Raw, "pin_hash") ||
		!strings.Contains(created.Raw, `"allowed_emails":["budi@wit.id","ani@wit.id"],"watermark":false,`) ||
		!strings.Contains(created.Raw, `"has_pin":true,"url":"https://app.example/share/`+token+`","node_name":"Data Room Investor","node_kind":"folder","access_count":0,"mail":{"sent":2,"failed":[]}}}`) {
		t.Fatalf("create share: %s", created.Raw)
	}
	if len(f.mail.sent) != 2 || f.mail.sent[0].subject != `Dewi Arsip membagikan "Data Room Investor" (NüHabit Dataroom)` ||
		!strings.Contains(f.mail.sent[0].html, "dan memasukkan PIN yang diberikan pengirim") {
		t.Fatalf("mail: %+v", f.mail.sent)
	}
	if h := f.scalar(`SELECT pin_hash FROM dataroom.shares WHERE id = $1`, id); !strings.HasPrefix(h, "$2a$10$") {
		t.Fatalf("pin hash %q", h)
	}
	_, publicToken, public := f.share(map[string]any{"node_id": root, "access_type": "public", "emails": []string{"x@y.id"}})
	if !strings.Contains(public.Raw, `"allowed_emails":[]`) || !strings.Contains(public.Raw, `"has_pin":false`) || !strings.HasSuffix(public.Raw, `"mail":null}}`) {
		t.Fatalf("public share: %s", public.Raw)
	}

	list := f.ok(f.do(call{method: "GET", target: "/api/dataroom/shares?node_id=" + root}), 200)
	if !strings.Contains(list.Raw, `"node_name":"Data Room Investor","node_kind":"folder","node_parent_id":null,"access_count":0,"has_pin":true,"url":"https://app.example/share/`+token+`"}`) {
		t.Fatalf("list shares: %s", list.Raw)
	}

	// Opening the public link counts a view and logs it once per visitor.
	f.ok(f.do(call{method: "GET", target: "/api/share/" + publicToken, staff: "-"}), 200)
	logs := f.ok(f.do(call{method: "GET", target: "/api/dataroom/shares/" + id}), 200)
	if logs.Raw != `{"success":true,"data":{"logs":[]}}` {
		t.Fatalf("logs: %s", logs.Raw)
	}
	f.fail(f.do(call{method: "GET", target: "/api/dataroom/shares/" + newUUID(t, f.tx)}), 404, "Link tidak ditemukan")
	f.fail(f.do(call{method: "DELETE", target: "/api/dataroom/shares/" + id, deny: "update"}), 403, "Insufficient permissions")
	if r := f.ok(f.do(call{method: "DELETE", target: "/api/dataroom/shares/" + id}), 200); r.Raw != `{"success":true,"data":{"revoked":"`+id+`"}}` {
		t.Fatalf("revoke: %s", r.Raw)
	}
	f.fail(f.do(call{method: "GET", target: "/api/share/" + token, staff: "-"}), 410, "Link sudah dicabut oleh pemilik")
}

func TestPublicShareLink(t *testing.T) {
	f := newFixture(t)
	root := f.folder("Proposal", nil)
	sub := f.folder("Lampiran", &root)
	f.file("ringkasan.pdf", root)
	outside := f.folder("Rahasia", nil)
	_, token, _ := f.share(map[string]any{"node_id": root, "access_type": "public"})

	f.fail(f.do(call{method: "GET", target: "/api/share/pendek", staff: "-"}), 404, "Link tidak ditemukan")
	open := f.ok(f.do(call{method: "GET", target: "/api/share/" + token, staff: "-", headers: map[string]string{"cf-connecting-ip": "203.0.113.9", "User-Agent": "Go-Test"}}), 200)
	if !regexp.MustCompile(`^\{"success":true,"data":\{"name":"Proposal","kind":"folder","access_type":"public","requires_pin":false,"watermark":false,"expires_at":"[^"]+Z","shared_by":"Dewi Arsip","steps":\{"needEmail":false,"needPin":false\},"verified":true,"email":null,"root":\{"id":"` + root + `","parent_id":null,"kind":"folder","name":"Proposal","mime":null,"size_bytes":0,"updated_at":"[^"]+"\},"items":\[\{"id":"` + sub + `".*"name":"ringkasan.pdf".*\]\}\}$`).MatchString(open.Raw) {
		t.Fatalf("open: %s", open.Raw)
	}
	if got := f.scalar(`SELECT s.view_count || '|' || l.action || '|' || l.ip || '|' || l.user_agent FROM dataroom.shares s
		JOIN dataroom.share_access_logs l ON l.share_id = s.id WHERE s.token = $1`, token); got != "1|open|203.0.113.9|Go-Test" {
		t.Fatalf("open log: %s", got)
	}

	listed := f.ok(f.do(call{method: "GET", target: "/api/share/" + token + "/list?folder=" + sub, staff: "-"}), 200)
	if !strings.Contains(listed.Raw, `"ancestors":[{"id":"`+root+`","name":"Proposal"},{"id":"`+sub+`","name":"Lampiran"}],"items":[]`) {
		t.Fatalf("list: %s", listed.Raw)
	}
	f.fail(f.do(call{method: "GET", target: "/api/share/" + token + "/list?folder=" + outside, staff: "-"}), 404, "Folder tidak ditemukan")
	f.fail(f.do(call{method: "POST", target: "/api/share/" + token + "/request-code", staff: "-", body: map[string]any{"email": "a@b.id"}}), 400,
		"Link ini tidak memerlukan verifikasi email")

	f.tx.Exec(context.Background(), `UPDATE dataroom.shares SET expires_at = now() - interval '1 minute' WHERE token = $1`, token)
	f.fail(f.do(call{method: "GET", target: "/api/share/" + token, staff: "-"}), 410, "Link sudah kedaluwarsa")
}

// Ported from share/[token]/verify/route.test.ts: PIN failures count per
// link in the database (not per IP); the cookie is Secure on https only.
func TestVerifyPin(t *testing.T) {
	f := newFixture(t)
	root := f.folder("Kontrak", nil)
	shareID, token, _ := f.share(map[string]any{"node_id": root, "access_type": "public", "pin": "1234"})
	verify := func(pin, ip, host string) response {
		return f.do(call{method: "POST", target: "/api/share/" + token + "/verify", staff: "-", body: map[string]any{"pin": pin},
			headers: map[string]string{"cf-connecting-ip": ip, "Host": host}})
	}

	if r := f.ok(f.do(call{method: "GET", target: "/api/share/" + token, staff: "-"}), 200); r.data()["verified"] != false || r.data()["root"] != nil {
		t.Fatalf("locked link: %s", r.Raw)
	}
	f.fail(f.do(call{method: "GET", target: "/api/share/" + token + "/list", staff: "-"}), 401, "Verifikasi dulu")
	f.fail(verify("", "203.0.113.1", "sulu.example.com"), 400, "Masukkan PIN")
	f.fail(verify("1111", "203.0.113.1", "sulu.example.com"), 400, "PIN salah")
	if got := f.scalar(`SELECT failures::text FROM auth.attempt_limits WHERE scope = 'dataroom_share_pin' AND subject = $1`, "share:"+shareID); got != "1" {
		t.Fatalf("failures %s", got)
	}
	for _, ip := range []string{"198.51.100.1", "198.51.100.2", "198.51.100.3"} {
		f.fail(verify("2222", ip, "sulu.example.com"), 400, "PIN salah")
	}
	// The fifth failure locks the link for 30 minutes, whatever the IP.
	f.fail(verify("3333", "198.51.100.7", "sulu.example.com"), 429, "Terlalu banyak percobaan PIN. Coba lagi dalam 30 menit.")
	f.fail(verify("1234", "192.0.2.50", "sulu.example.com"), 429, "Terlalu banyak percobaan PIN. Coba lagi dalam 30 menit.")
	if got := f.scalar(`SELECT count(*)::text FROM dataroom.share_access_logs WHERE share_id = $1 AND action = 'pin_failed'`, shareID); got != "5" {
		t.Fatalf("pin_failed logs %s", got)
	}

	f.tx.Exec(context.Background(), `DELETE FROM auth.attempt_limits WHERE subject = $1`, "share:"+shareID)
	ok := f.ok(verify("1234", "203.0.113.1", "sulu.example.com"), 200)
	if ok.Raw != `{"success":true,"data":{"steps":{"needEmail":false,"needPin":false},"verified":true}}` {
		t.Fatalf("verified: %s", ok.Raw)
	}
	cookie := ok.Header.Get("Set-Cookie")
	if !strings.HasPrefix(cookie, "drs_"+token+"=") || !strings.Contains(cookie, "HttpOnly") || !strings.Contains(cookie, "Secure") || !strings.Contains(cookie, "SameSite=Lax") {
		t.Fatalf("cookie: %s", cookie)
	}
	if f.scalar(`SELECT count(*)::text FROM auth.attempt_limits WHERE subject = $1`, "share:"+shareID) != "0" {
		t.Fatal("success must clear the failures")
	}
	lan := f.ok(verify("1234", "10.20.89.9", "10.20.89.5:3000"), 200)
	if strings.Contains(lan.Header.Get("Set-Cookie"), "Secure") {
		t.Fatalf("LAN cookie: %s", lan.Header.Get("Set-Cookie"))
	}

	// With the session cookie the link opens without counting another view.
	session := &http.Cookie{Name: "drs_" + token, Value: strings.SplitN(strings.SplitN(cookie, ";", 2)[0], "=", 2)[1]}
	opened := f.ok(f.do(call{method: "GET", target: "/api/share/" + token, staff: "-", cookie: session}), 200)
	if opened.data()["verified"] != true || f.scalar(`SELECT view_count::text FROM dataroom.shares WHERE id = $1`, shareID) != "1" {
		t.Fatalf("session open: %s", opened.Raw)
	}
}

func TestVerifyEmailCode(t *testing.T) {
	f := newFixture(t)
	root := f.folder("Due Diligence", nil)
	shareID, token, _ := f.share(map[string]any{"node_id": root, "access_type": "email", "emails": []string{"budi@wit.id"}, "pin": "4321"})
	post := func(path string, body any, cookie *http.Cookie) response {
		return f.do(call{method: "POST", target: "/api/share/" + token + path, staff: "-", body: body, cookie: cookie,
			headers: map[string]string{"cf-connecting-ip": "203.0.113.5", "X-Forwarded-Proto": "https"}})
	}

	f.fail(post("/request-code", map[string]any{"email": "bukan"}, nil), 400, "Email tidak valid")
	f.fail(post("/request-code", map[string]any{"email": "lain@wit.id"}, nil), 403, "Email ini tidak termasuk penerima link")
	if r := f.ok(post("/request-code", map[string]any{"email": " Budi@Wit.id "}, nil), 200); r.Raw != `{"success":true,"data":{"sent":true}}` {
		t.Fatalf("request code: %s", r.Raw)
	}
	mail := f.mail.sent[len(f.mail.sent)-1]
	code := regexp.MustCompile(`Kode akses Dataroom: (\d{6})`).FindStringSubmatch(mail.subject)
	if mail.to != "budi@wit.id" || code == nil || !strings.Contains(mail.html, "Kode berlaku 10 menit") {
		t.Fatalf("code mail: %+v", mail)
	}

	f.fail(post("/verify", map[string]any{"email": "lain@wit.id", "code": code[1]}, nil), 403, "Email tidak termasuk penerima link")
	f.fail(post("/verify", map[string]any{"email": "budi@wit.id"}, nil), 400, "Masukkan kode verifikasi")
	f.fail(post("/verify", map[string]any{"email": "budi@wit.id", "code": "000000"}, nil), 400, "Kode salah")
	// Email passes, PIN still missing: progress saved in the session cookie.
	half := f.ok(post("/verify", map[string]any{"email": "budi@wit.id", "code": code[1]}, nil), 200)
	if half.Raw != `{"success":true,"data":{"steps":{"needEmail":false,"needPin":true},"verified":false}}` {
		t.Fatalf("email step: %s", half.Raw)
	}
	f.fail(post("/verify", map[string]any{"email": "budi@wit.id", "code": code[1]}, nil), 400, "Minta kode verifikasi terlebih dahulu")
	cookie := half.Header.Get("Set-Cookie")
	session := &http.Cookie{Name: "drs_" + token, Value: strings.SplitN(strings.SplitN(cookie, ";", 2)[0], "=", 2)[1]}
	done := f.ok(post("/verify", map[string]any{"pin": "4321"}, session), 200)
	if done.Raw != `{"success":true,"data":{"steps":{"needEmail":false,"needPin":false},"verified":true}}` {
		t.Fatalf("pin step: %s", done.Raw)
	}
	if got := f.scalar(`SELECT string_agg(action || ':' || COALESCE(email, '-'), ',' ORDER BY action, email) FROM dataroom.share_access_logs WHERE share_id = $1`, shareID); got != "code_failed:budi@wit.id,code_failed:budi@wit.id,code_failed:lain@wit.id,code_sent:budi@wit.id,verified:budi@wit.id" {
		t.Fatalf("logs: %s", got)
	}
	info := f.ok(f.do(call{method: "GET", target: "/api/share/" + token, staff: "-", cookie: session}), 200)
	if info.data()["email"] != "budi@wit.id" || info.data()["verified"] != true {
		t.Fatalf("info: %s", info.Raw)
	}

	// The per-IP brake: five code requests a minute.
	for range 4 {
		post("/request-code", map[string]any{"email": "budi@wit.id"}, nil)
	}
	f.fail(post("/request-code", map[string]any{"email": "budi@wit.id"}, nil), 429, "Terlalu banyak permintaan. Coba lagi sebentar.")
}

// The real guard: read routes need the dataroom menu, writes its action;
// share links need no session.
func TestAuthWiring(t *testing.T) {
	deps := testutil.Deps(t, nil)
	mux := testutil.Mux(New(deps, Ports{Directory: testDirectory{q: deps.DB}, Mailer: &fakeMailer{}}))
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"dataroom": {"read"}}})
	stranger := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm": {"read"}}})
	expect := func(r *http.Request, status int, msg string) {
		t.Helper()
		rec, body := testutil.Do(t, mux, r)
		if rec.Code != status || (msg != "" && body["error"] != msg) {
			t.Fatalf("%s %s: %d %s", r.Method, r.URL, rec.Code, rec.Body.String())
		}
	}
	expect(testutil.Request("GET", "/api/dataroom/tree", nil), 401, "Authentication required")
	expect(testutil.AsStaff(testutil.Request("GET", "/api/dataroom/tree", nil), stranger), 403, "Insufficient permissions")
	expect(testutil.AsStaff(testutil.Request("GET", "/api/dataroom/departments", nil), reader), 200, "")
	expect(testutil.AsStaff(testutil.Request("POST", "/api/dataroom/nodes", map[string]any{"name": "x"}), reader), 403, "Insufficient permissions")
	expect(testutil.Request("GET", "/api/share/"+strings.Repeat("z", 30), nil), 404, "Link tidak ditemukan")
}
