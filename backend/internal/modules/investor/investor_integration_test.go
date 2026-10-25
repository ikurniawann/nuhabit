package investor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/accounting"
	"nuhabit/backend/internal/modules/gymdesk"
	gymdomain "nuhabit/backend/internal/modules/gymdesk/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/testutil"
)

// Figure tests seed one branch inside a rolled-back transaction, dated
// March 2031 so only this test's rows fall in the windows, and trust the
// X-Test-Staff header. The guard tests run on the pool with real IAM rows.

var testNow = time.Date(2031, 3, 20, 12, 0, 0, 0, localtime.Jakarta)

const (
	staffA = "6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11"
	staffB = "7a2d3b2f-1e8c-4d66-8b54-2c1c7b1f6f22"
)

type headerGuard struct{}

func (headerGuard) RequireAnyGrant(r *http.Request, _ ...iam.Grant) (*auth.User, int, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, -1, httpx.Unauthorized("")
	}
	return &auth.User{ID: id, FullName: "Direksi " + id[:4]}, 0, nil
}

// txGym serves the gym ports from gym-desk on the fixture transaction.
type txGym struct{ svc *gymdesk.Service }

func (g txGym) ClassReport(ctx context.Context, p gymdomain.Period, branchID *string) (gymdomain.ClassReport, error) {
	return g.svc.ClassReport(ctx, p, branchID)
}

func (g txGym) MemberStats(ctx context.Context, p gymdomain.Period, branchID *string) (MemberStats, error) {
	m, err := g.svc.MemberStats(ctx, p, branchID)
	return MemberStats{New: m.New, Active: m.Active, PreviousActive: m.PreviousActive, Churned: m.Churned, ChurnRate: m.ChurnRate}, err
}

type txAccounting struct{ svc *accounting.Service }

func (a txAccounting) MonthlyIncome(ctx context.Context, companyIDs []string, from, to string) ([]MonthIncome, error) {
	rows, err := a.svc.MonthlyIncome(ctx, companyIDs, from, to)
	out := make([]MonthIncome, len(rows))
	for i, r := range rows {
		out[i] = MonthIncome{Month: r.Month, Revenue: r.Revenue, Cogs: r.Cogs, Expenses: r.Expenses, OtherIncome: r.OtherIncome, OtherExpenses: r.OtherExpenses}
	}
	return out, err
}

type fakeMailer struct {
	configured bool
	fail       bool
	sent       []string
}

func (m *fakeMailer) Configured() bool { return m.configured }
func (m *fakeMailer) Send(_ context.Context, to, subject, html string) bool {
	if m.fail {
		return false
	}
	m.sent = append(m.sent, to+"|"+subject+"|"+html)
	return true
}

type fixture struct {
	t       *testing.T
	ctx     context.Context
	tx      pgx.Tx
	svc     *Service
	mux     *http.ServeMux
	mailer  *fakeMailer
	sfx     string
	cashier string
	company string
	branch  string
	m1, m2  string
}

func wib(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, localtime.Jakarta)
	if err != nil {
		panic(err)
	}
	return t
}

// newFixture opens the transaction after the committed staff rows exist,
// so their cleanups run after the rollback and never wait on its locks.
func newFixture(t *testing.T) *fixture {
	t.Helper()
	cashier := testutil.CreateStaff(t, testutil.StaffOptions{})
	tx := testutil.Tx(t)
	f := &fixture{t: t, ctx: context.Background(), tx: tx, mailer: &fakeMailer{configured: true}, sfx: testutil.RandomHex(4), cashier: cashier.UserID}
	now := func() time.Time { return testNow }
	ports := Ports{
		Gym:        txGym{svc: gymdesk.NewService(tx, gymdesk.Ports{}, now)},
		Accounting: txAccounting{svc: accounting.NewService(tx, accounting.Ports{}, nil, now)},
		Mailer:     f.mailer,
	}
	f.svc = NewService(tx, ports, now, nil)
	f.svc.store = storage.New(t.TempDir())
	f.mux = testutil.Mux(mod{h: &handler{svc: f.svc, guard: headerGuard{}}})
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

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) seed() {
	org := testutil.CreateOrg(f.t, f.tx)
	f.company, f.branch = org.CompanyID, org.BranchID
	num := fmt.Sprintf("%07d", time.Now().UnixNano()%10_000_000)
	member := func(name, digit, created string, ark float64) string {
		return f.id(`INSERT INTO pos.pos_customers (phone, name, created_at, ark_coin_balance) VALUES ($1, $2, $3, $4)`,
			"+62991"+num+digit, name+" "+f.sfx, wib(created), ark)
	}
	f.m1 = member("Alice", "1", "2031-03-02 09:00", 10_000)
	f.m2 = member("Budi", "2", "2031-01-10 09:00", 5_000)
	m3 := member("Citra", "3", "2031-03-05 09:00", 0)

	classType := f.id(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity) VALUES ($1, 60, 1, 10)`, "Investor Test "+f.sfx)
	coach := f.id(`INSERT INTO gym.coaches (name) VALUES ($1)`, "Coach "+f.sfx)
	session := func(start string, capacity int, status string) string {
		at := wib(start)
		return f.id(`INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, starts_at, ends_at, capacity, credit_cost,
		               booking_opens_at, booking_closes_at, status)
		             VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '1 hour', $5, 1, $4::timestamptz - interval '7 days', $4::timestamptz, $6)`,
			classType, coach, f.branch, at, capacity, status)
	}
	s1 := session("2031-03-10 07:00", 10, "completed")
	s2 := session("2031-03-11 18:00", 4, "completed")
	s3 := session("2031-03-22 07:00", 10, "published")
	book := func(sessionID, customerID, status string) string {
		return f.id(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, $3)`, sessionID, customerID, status)
	}
	b1 := book(s1, f.m1, "completed")
	book(s1, f.m2, "no_show")
	b2 := book(s2, f.m1, "completed")
	book(s3, f.m1, "confirmed")
	scan := func(customerID string, bookingID any, decision, at string) {
		f.id(`INSERT INTO gym.access_logs (customer_id, booking_id, branch_id, decision, entry_kind, credit_delta, created_at)
		      VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'allowed' THEN 'booking' END, CASE WHEN $4 = 'allowed' THEN -1 ELSE 0 END, $5)`,
			customerID, bookingID, f.branch, decision, wib(at))
	}
	scan(f.m1, b1, "allowed", "2031-03-10 06:50")
	scan(f.m1, b2, "allowed", "2031-03-11 17:50")
	scan(f.m2, nil, "allowed", "2031-02-15 07:00")
	scan(m3, nil, "denied", "2031-03-12 08:00")

	pkg := func(name, kind string, credits int, price float64, personal bool) string {
		return f.id(`INSERT INTO gym.credit_packages (name, kind, credits, price_idr, validity_days, covers_personal) VALUES ($1, $2, $3, $4, 30, $5)`,
			name+" "+f.sfx, kind, credits, price, personal)
	}
	credits := pkg("Inv 10", "credits", 10, 1_000_000, false)
	pass := pkg("Inv Pass", "pass", 0, 500_000, false)
	ptPass := pkg("Inv PT", "pass", 0, 800_000, true)
	purchase := func(customerID, packageID string, total float64, status, paid string, refunded any) string {
		return f.id(`INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, total_idr, channel, payment_method,
		               status, branch_id, paid_at, refunded_at, refunded_idr)
		             VALUES ($1, $2, 0, $3::numeric, $3::numeric, 'front_desk', 'cash', $4, $5, $6, $7, CASE WHEN $7::timestamptz IS NULL THEN NULL ELSE $3::numeric END)`,
			customerID, packageID, total, status, f.branch, wib(paid), refunded)
	}
	p1 := purchase(f.m1, credits, 1_000_000, "paid", "2031-03-02 10:00", nil)
	purchase(f.m2, credits, 500_000, "refunded", "2031-03-05 10:00", wib("2031-03-06 10:00"))
	p3 := purchase(m3, pass, 500_000, "paid", "2031-03-06 10:00", nil)
	purchase(f.m1, ptPass, 800_000, "paid", "2031-03-20 10:00", nil)
	purchase(f.m2, credits, 300_000, "paid", "2031-02-10 10:00", nil)
	purchase(f.m2, credits, 100_000, "paid", "2030-03-01 10:00", nil)

	l1 := f.id(`INSERT INTO gym.credit_lots (customer_id, package_id, purchase_id, credits, expires_at) VALUES ($1, $2, $3, 10, $4)`,
		f.m1, credits, p1, wib("2031-03-30 12:00"))
	f.id(`INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id) VALUES ($1, 'top_up', 10, $2)`, f.m1, l1)
	f.id(`INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id) VALUES ($1, 'class_deduction', -2, $2)`, f.m1, l1)
	mp := f.id(`INSERT INTO gym.member_passes (customer_id, package_id, purchase_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)`,
		m3, pass, p3, wib("2031-03-06 10:00"), wib("2031-04-05 10:00"))
	f.id(`INSERT INTO gym.pass_revenue_releases (pass_id, release_date, amount_idr, batch_id) VALUES ($1, '2031-03-07', 100000, gen_random_uuid())`, mp)

	order := func(total float64, at string) {
		f.id(`INSERT INTO pos.pos_orders (order_number, cashier_id, branch_id, company_id, status, payment_status, subtotal, total_amount, created_at)
		      VALUES ($1, $2, $3, $4, 'completed', 'paid', $5, $5, $6)`, "INV-"+testutil.RandomHex(4), f.cashier, f.branch, f.company, total, wib(at))
	}
	order(150_000, "2031-03-20 11:00")
	order(70_000, "2031-03-19 11:00")
	order(30_000, "2031-03-01 11:00")
	f.id(`INSERT INTO pos.pos_orders (order_number, cashier_id, branch_id, status, payment_status, subtotal, total_amount, voided_at, created_at)
	      VALUES ($1, $2, $3, 'completed', 'paid', 999999, 999999, now(), $4)`, "INV-"+testutil.RandomHex(4), f.cashier, f.branch, wib("2031-03-20 11:30"))

	pt := func(start, status string) {
		f.id(`INSERT INTO gym.pt_appointments (coach_id, class_type_id, branch_id, starts_at, ends_at, capacity, credit_cost, status)
		      VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '1 hour', 1, 2, $5)`, coach, classType, f.branch, wib(start), status)
	}
	pt("2031-03-10 09:00", "completed")
	pt("2031-03-15 09:00", "completed")
	pt("2031-03-16 09:00", "cancelled")
	pt("2031-02-12 09:00", "completed")

	// March journals: 2.000.000 revenue, 500.000 cost of sales, 300.000 rent.
	fy := f.id(`INSERT INTO accounting.fiscal_years (company_id, code, name, start_date, end_date) VALUES ($1, $2, $2, '2031-01-01', '2031-12-31')`, f.company, "FY31"+f.sfx)
	period := f.id(`INSERT INTO accounting.fiscal_periods (fiscal_year_id, period_no, name, start_date, end_date) VALUES ($1, 3, 'Mar 2031', '2031-03-01', '2031-03-31')`, fy)
	account := func(code, typ string) string {
		return f.id(`INSERT INTO accounting.chart_of_accounts (company_id, code, name, account_type_id, level, is_postable)
			SELECT $1, $2, $2, t.id, 1, true FROM accounting.account_types t WHERE t.code = $3`, f.company, code+f.sfx, typ)
	}
	cash, revenue, cogs, rent := account("1-1", "ASSET"), account("4-1", "REVENUE"), account("5-1", "COGS"), account("6-1", "EXPENSE")
	entry := func(date string, lines ...[3]any) {
		e := f.id(`INSERT INTO accounting.journal_entries (company_id, entry_no, entry_date, fiscal_period_id, status) VALUES ($1, $2, $3, $4, 'POSTED')`,
			f.company, "JE-"+testutil.RandomHex(4), date, period)
		for i, l := range lines {
			f.id(`INSERT INTO accounting.journal_entry_lines (entry_id, account_id, entry_side, amount, sort_order) VALUES ($1, $2, $3, $4, $5)`, e, l[0], l[1], l[2], i)
		}
	}
	entry("2031-03-05", [3]any{cash, "DEBIT", 2_000_000}, [3]any{revenue, "CREDIT", 2_000_000})
	entry("2031-03-10", [3]any{cogs, "DEBIT", 500_000}, [3]any{cash, "CREDIT", 500_000})
	entry("2031-03-12", [3]any{rent, "DEBIT", 300_000}, [3]any{cash, "CREDIT", 300_000})
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
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if staff != "" {
		req.Header.Set("X-Test-Staff", staff)
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{status: rec.Code, raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.body)
	return out
}

func (f *fixture) get(target string) response {
	f.t.Helper()
	r := f.call("GET", target, staffA, nil)
	if r.status != http.StatusOK {
		f.t.Fatalf("GET %s = %d %s", target, r.status, r.raw)
	}
	return r
}

func near(a any, b float64) bool {
	v, ok := a.(float64)
	return ok && math.Abs(v-b) < 1e-6
}

func num(m map[string]any, path ...string) any {
	var cur any = m
	for _, p := range path {
		cur = cur.(map[string]any)[p]
	}
	return cur
}

func TestOverviewFigures(t *testing.T) {
	f := newFixture(t)
	r := f.get("/api/investor/overview?branch_id=" + f.branch)
	d := r.data()
	if d["timezone"] != "Asia/Jakarta" || d["today"] != "2031-03-20" || r.body["cached"] != false {
		t.Fatalf("header = %v %v %v", d["timezone"], d["today"], r.body["cached"])
	}
	rev := d["revenue"].(map[string]any)
	if !near(num(rev, "today", "value"), 950_000) || !near(num(rev, "today", "previous"), 70_000) {
		t.Errorf("today = %v", rev["today"])
	}
	if !near(num(rev, "mtd", "value"), 2_550_000) || !near(num(rev, "mtd", "previous"), 300_000) || !near(num(rev, "mtd", "change"), 7.5) {
		t.Errorf("mtd = %v", rev["mtd"])
	}
	if !near(num(rev, "ytd", "value"), 2_850_000) || !near(num(rev, "ytd", "previous"), 100_000) {
		t.Errorf("ytd = %v", rev["ytd"])
	}
	streams := rev["mtd_streams"].(map[string]any)
	if !near(streams["packages"], 1_000_000) || !near(streams["passes"], 500_000) || !near(streams["pt"], 800_000) || !near(streams["pos"], 250_000) {
		t.Errorf("streams = %v", streams)
	}
	members := d["members"].(map[string]any)
	if !near(members["active"], 1) || !near(members["previous_active"], 1) || !near(members["churned"], 1) || !near(members["churn_rate"], 1) {
		t.Errorf("members = %v", members)
	}
	if !near(num(members, "new", "value"), 2) || !near(num(members, "new", "previous"), 0) || num(members, "new", "change") != nil {
		t.Errorf("new members = %v", members["new"])
	}
	classes := d["classes"].(map[string]any)
	if !near(classes["sessions"], 2) || !near(classes["checked_in"], 2) || !near(classes["avg_fill"], 0.225) || !near(classes["no_show_rate"], 1.0/3) {
		t.Errorf("classes = %v", classes)
	}
	if !near(num(d, "pt_sessions", "value"), 2) || !near(num(d, "pt_sessions", "previous"), 1) {
		t.Errorf("pt = %v", d["pt_sessions"])
	}
	if ark := d["ark_coin_outstanding"].(float64); ark < 15_000 {
		t.Errorf("ark coin = %v", ark)
	}
	deferred := d["deferred_revenue"].(map[string]any)
	if !near(deferred["credits"], 800_000) || !near(deferred["passes"], 400_000) || !near(deferred["total"], 1_200_000) {
		t.Errorf("deferred = %v", deferred)
	}
	daily := d["daily"].([]any)
	last := daily[len(daily)-1].(map[string]any)
	if len(daily) != 90 || last["day"] != "2031-03-20" || !near(last["total"], 950_000) || !near(last["branches"].(map[string]any)[f.branch], 950_000) {
		t.Errorf("daily = %d %v", len(daily), last)
	}
	if !near(last["streams"].(map[string]any)["pt"], 800_000) {
		t.Errorf("last day streams = %v", last["streams"])
	}
	found := false
	for _, b := range d["branches"].([]any) {
		found = found || b.(map[string]any)["id"] == f.branch
	}
	if !found {
		t.Errorf("branches = %v", d["branches"])
	}

	if again := f.get("/api/investor/overview?branch_id=" + f.branch); again.body["cached"] != true {
		t.Errorf("second read not cached: %v", again.body["cached"])
	}
	if all := f.get("/api/investor/overview").data(); !near(num(all, "revenue", "today", "value"), 950_000) {
		t.Errorf("unfiltered today = %v", num(all, "revenue", "today"))
	}
	if r := f.call("GET", "/api/investor/overview?branch_id=nope", staffA, nil); r.status != http.StatusBadRequest {
		t.Errorf("bad branch = %d", r.status)
	}
	if r := f.call("GET", "/api/investor/overview", "", nil); r.status != http.StatusUnauthorized {
		t.Errorf("anonymous = %d", r.status)
	}
}

func TestPerformanceFigures(t *testing.T) {
	f := newFixture(t)
	r := f.get("/api/investor/performance?months=3&branch_id=" + f.branch)
	d := r.data()
	if d["from"] != "2031-01-01" || d["to"] != "2031-03-31" {
		t.Fatalf("span = %v .. %v", d["from"], d["to"])
	}
	months := d["months"].([]any)
	if len(months) != 3 {
		t.Fatalf("months = %d", len(months))
	}
	jan, feb, mar := months[0].(map[string]any), months[1].(map[string]any), months[2].(map[string]any)
	if jan["month"] != "2031-01" || !near(num(jan, "revenue", "total"), 0) || jan["accounting"] != nil {
		t.Errorf("jan = %v", jan)
	}
	if !near(num(feb, "revenue", "total"), 300_000) || !near(num(feb, "members", "active"), 1) || num(feb, "members", "retention_rate") != nil || !near(feb["pt_sessions"], 1) {
		t.Errorf("feb = %v", feb)
	}
	if !near(num(mar, "revenue", "total"), 2_550_000) || !near(num(mar, "revenue", "streams", "pos"), 250_000) {
		t.Errorf("mar revenue = %v", mar["revenue"])
	}
	acc := mar["accounting"].(map[string]any)
	if !near(acc["revenue"], 2_000_000) || !near(acc["cogs"], 500_000) || !near(acc["gross_profit"], 1_500_000) || !near(acc["gross_margin"], 0.75) ||
		!near(acc["expenses"], 300_000) || !near(acc["operating_income"], 1_200_000) || !near(acc["net_income"], 1_200_000) {
		t.Errorf("mar accounting = %v", acc)
	}
	if !near(num(mar, "members", "new"), 2) || !near(num(mar, "members", "active"), 1) || !near(num(mar, "members", "retained"), 0) || !near(num(mar, "members", "retention_rate"), 0) {
		t.Errorf("mar members = %v", mar["members"])
	}
	if !near(num(mar, "classes", "sessions"), 2) || !near(num(mar, "classes", "checked_in"), 2) || !near(mar["pt_sessions"], 2) {
		t.Errorf("mar classes = %v pt %v", mar["classes"], mar["pt_sessions"])
	}
	if again := f.get("/api/investor/performance?months=3&branch_id=" + f.branch); again.body["cached"] != true {
		t.Errorf("second read not cached")
	}
	// Default span is twelve months, capped at twenty-four.
	if all := f.get("/api/investor/performance").data(); len(all["months"].([]any)) != 12 {
		t.Errorf("default months = %d", len(all["months"].([]any)))
	}
	if capped := f.get("/api/investor/performance?months=99").data(); len(capped["months"].([]any)) != 24 {
		t.Errorf("capped months = %d", len(capped["months"].([]any)))
	}
}

func fileForm(t *testing.T, name string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(data)
	_ = w.Close()
	return &body, w.FormDataContentType()
}

func TestUpdatesEditorAndDocuments(t *testing.T) {
	f := newFixture(t)
	if list := f.get("/api/investor/updates").body["data"].([]any); len(list) != 0 {
		t.Fatalf("published before any update = %v", list)
	}
	if r := f.call("POST", "/api/investor/updates", staffA, map[string]string{"title": "  ", "body": "x"}); r.status != http.StatusBadRequest {
		t.Fatalf("empty title = %d %s", r.status, r.raw)
	}
	created := f.call("POST", "/api/investor/updates", staffA, map[string]string{"title": "  Cabang kedua dibuka  ", "body": "Kemang buka 1 April."})
	if created.status != http.StatusCreated || created.data()["title"] != "Cabang kedua dibuka" || created.data()["status"] != "draft" || created.data()["created_by_name"] != "Direksi 6f1c" {
		t.Fatalf("create = %d %s", created.status, created.raw)
	}
	id := created.data()["id"].(string)
	if list := f.get("/api/investor/updates").body["data"].([]any); len(list) != 0 {
		t.Fatalf("draft visible to investors: %v", list)
	}
	if list := f.get("/api/investor/updates/manage").body["data"].([]any); len(list) != 1 {
		t.Fatalf("manage = %v", list)
	}

	body, ctype := fileForm(t, "rencana.pdf", []byte("%PDF-1.4 investor"))
	req := httptest.NewRequest("POST", "/api/investor/updates/"+id+"/attachments", body)
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("X-Test-Staff", staffA)
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	var attached map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &attached)
	if rec.Code != http.StatusCreated {
		t.Fatalf("attach = %d %s", rec.Code, rec.Body.String())
	}
	atts := attached["data"].(map[string]any)["attachments"].([]any)
	att := atts[0].(map[string]any)
	if len(atts) != 1 || att["name"] != "rencana.pdf" || att["mime"] != "application/pdf" || !strings.HasPrefix(att["url"].(string), "/api/files/investor-updates/") {
		t.Fatalf("attachment = %v", atts)
	}
	rel := strings.TrimPrefix(att["url"].(string), "/api/files/")
	if _, ok := f.svc.store.UploadFile(strings.SplitN(rel, "/", 2)[0], strings.Split(strings.SplitN(rel, "/", 2)[1], "/")); !ok {
		t.Fatalf("file not stored at %s", rel)
	}
	body, ctype = fileForm(t, "virus.exe", []byte("MZ...."))
	req = httptest.NewRequest("POST", "/api/investor/updates/"+id+"/attachments", body)
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("X-Test-Staff", staffA)
	rec = httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("exe accepted: %d %s", rec.Code, rec.Body.String())
	}

	published := f.call("PUT", "/api/investor/updates/"+id+"/published", staffA, map[string]bool{"published": true})
	if published.status != http.StatusOK || published.data()["status"] != "published" || published.data()["published_at"] == nil {
		t.Fatalf("publish = %d %s", published.status, published.raw)
	}
	list := f.get("/api/investor/updates").body["data"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["title"] != "Cabang kedua dibuka" {
		t.Fatalf("published = %v", list)
	}
	if _, has := list[0].(map[string]any)["created_by_name"]; has {
		t.Fatalf("investor payload names the author: %v", list[0])
	}
	docs := f.get("/api/investor/documents").body["data"].([]any)
	if len(docs) != 1 || docs[0].(map[string]any)["update_title"] != "Cabang kedua dibuka" || docs[0].(map[string]any)["name"] != "rencana.pdf" {
		t.Fatalf("documents = %v", docs)
	}

	edited := f.call("PATCH", "/api/investor/updates/"+id, staffA, map[string]string{"title": "Cabang kedua", "body": "Kemang buka 2 April."})
	if edited.status != http.StatusOK || edited.data()["body"] != "Kemang buka 2 April." || edited.data()["status"] != "published" {
		t.Fatalf("edit = %d %s", edited.status, edited.raw)
	}
	unpublished := f.call("PUT", "/api/investor/updates/"+id+"/published", staffA, map[string]bool{"published": false})
	if unpublished.data()["status"] != "draft" || unpublished.data()["published_at"] != nil {
		t.Fatalf("unpublish = %s", unpublished.raw)
	}
	if docs := f.get("/api/investor/documents").body["data"].([]any); len(docs) != 0 {
		t.Fatalf("documents of a draft listed: %v", docs)
	}
	detached := f.call("DELETE", "/api/investor/updates/"+id+"/attachments/"+att["id"].(string), staffA, nil)
	if detached.status != http.StatusOK || len(detached.data()["attachments"].([]any)) != 0 {
		t.Fatalf("detach = %d %s", detached.status, detached.raw)
	}
	if r := f.call("DELETE", "/api/investor/updates/"+id+"/attachments/"+att["id"].(string), staffA, nil); r.status != http.StatusNotFound {
		t.Fatalf("detach twice = %d", r.status)
	}
	if r := f.call("DELETE", "/api/investor/updates/"+id, staffA, nil); r.status != http.StatusOK {
		t.Fatalf("delete = %d %s", r.status, r.raw)
	}
	if r := f.call("PATCH", "/api/investor/updates/"+id, staffA, map[string]string{"title": "x"}); r.status != http.StatusNotFound {
		t.Fatalf("edit deleted = %d", r.status)
	}
}

func TestDigestSettingAndJob(t *testing.T) {
	investor := testutil.CreateStaff(t, testutil.StaffOptions{Role: "investor"})
	f := newFixture(t)
	if r := f.call("GET", "/api/investor/digest", investor.UserID, nil); r.data()["enabled"] != false {
		t.Fatalf("default = %s", r.raw)
	}
	if r := f.call("PUT", "/api/investor/digest", investor.UserID, map[string]bool{"enabled": true}); r.status != http.StatusOK || r.data()["enabled"] != true {
		t.Fatalf("enable = %d %s", r.status, r.raw)
	}
	if r := f.call("GET", "/api/investor/digest", investor.UserID, nil); r.data()["enabled"] != true {
		t.Fatalf("stored = %s", r.raw)
	}

	// Before 07:00 WIB nothing goes out; after it, once per day.
	if err := f.svc.SendDailyDigest(f.ctx, wib("2031-03-20 06:30")); err != nil || len(f.mailer.sent) != 0 {
		t.Fatalf("early run: %v %v", err, f.mailer.sent)
	}
	if err := f.svc.SendDailyDigest(f.ctx, wib("2031-03-20 07:30")); err != nil || len(f.mailer.sent) != 1 {
		t.Fatalf("first run: %v %v", err, f.mailer.sent)
	}
	mail := f.mailer.sent[0]
	if !strings.HasPrefix(mail, investor.Email+"|Ringkasan harian NüHabit 20 Mar 2031|") || !strings.Contains(mail, "Rp 2.550.000") || !strings.Contains(mail, "Rp 70.000") {
		t.Fatalf("mail = %s", mail)
	}
	if err := f.svc.SendDailyDigest(f.ctx, wib("2031-03-20 09:00")); err != nil || len(f.mailer.sent) != 1 {
		t.Fatalf("same day again: %v %d", err, len(f.mailer.sent))
	}
	if err := f.svc.SendDailyDigest(f.ctx, wib("2031-03-21 07:05")); err != nil || len(f.mailer.sent) != 2 {
		t.Fatalf("next day: %v %d", err, len(f.mailer.sent))
	}
	// A failed send releases the claim for the next run.
	f.mailer.fail = true
	if err := f.svc.SendDailyDigest(f.ctx, wib("2031-03-22 07:05")); err == nil {
		t.Fatal("failed send reported no error")
	}
	f.mailer.fail = false
	if err := f.svc.SendDailyDigest(f.ctx, wib("2031-03-22 07:15")); err != nil || len(f.mailer.sent) != 3 {
		t.Fatalf("retry: %v %d", err, len(f.mailer.sent))
	}
	// Turned off, no mail.
	f.call("PUT", "/api/investor/digest", investor.UserID, map[string]bool{"enabled": false})
	if err := f.svc.SendDailyDigest(f.ctx, wib("2031-03-23 07:05")); err != nil || len(f.mailer.sent) != 3 {
		t.Fatalf("disabled: %v %d", err, len(f.mailer.sent))
	}
	if r := f.call("GET", "/api/investor/digest", staffB, nil); r.data()["enabled"] != false {
		t.Fatalf("another user's setting leaked: %s", r.raw)
	}
}

// piiKeys never appear in a payload investors read.
var piiKeys = map[string]bool{
	"name": true, "full_name": true, "phone": true, "email": true, "customer_id": true, "user_id": true,
	"employee_id": true, "employee": true, "nik": true, "address": true, "birth_date": true, "member_code": true,
	"created_by": true, "created_by_name": true, "cashier_id": true, "coach": true, "members_list": true,
}

// piiAllowed are keys that look personal but name a branch, a package or a
// file: "name" is allowed only on branch rows and attachments.
func walkPII(t *testing.T, path string, v any) {
	t.Helper()
	switch x := v.(type) {
	case map[string]any:
		for k, child := range x {
			if piiKeys[k] && !(k == "name" && (strings.Contains(path, "branches") || strings.Contains(path, "attachments") || strings.HasPrefix(path, "documents"))) {
				t.Errorf("PII key %q at %s", k, path)
			}
			walkPII(t, path+"."+k, child)
		}
	case []any:
		for _, child := range x {
			walkPII(t, path+"[]", child)
		}
	}
}

func TestInvestorPayloadsHaveNoPII(t *testing.T) {
	f := newFixture(t)
	created := f.call("POST", "/api/investor/updates", staffA, map[string]string{"title": "Q1", "body": "Pertumbuhan 20%."})
	id := created.data()["id"].(string)
	body, ctype := fileForm(t, "laporan.pdf", []byte("%PDF-1.4 x"))
	req := httptest.NewRequest("POST", "/api/investor/updates/"+id+"/attachments", body)
	req.Header.Set("Content-Type", ctype)
	req.Header.Set("X-Test-Staff", staffA)
	f.mux.ServeHTTP(httptest.NewRecorder(), req)
	f.call("PUT", "/api/investor/updates/"+id+"/published", staffA, map[string]bool{"published": true})

	for _, path := range []string{"/api/investor/overview", "/api/investor/overview?branch_id=" + f.branch, "/api/investor/performance?months=2",
		"/api/investor/branches", "/api/investor/updates", "/api/investor/documents", "/api/investor/digest"} {
		r := f.get(path)
		var v any
		if err := json.Unmarshal([]byte(r.raw), &v); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		root := strings.TrimPrefix(strings.SplitN(strings.TrimPrefix(path, "/api/investor/"), "?", 2)[0], "")
		walkPII(t, root, v.(map[string]any)["data"])
		for _, needle := range []string{"Alice " + f.sfx, "Budi " + f.sfx, "+62991", "@test.local", "Direksi 6f1c"} {
			if strings.Contains(r.raw, needle) {
				t.Errorf("%s leaks %q", path, needle)
			}
		}
	}
}

// Every investor route needs read on an investor menu and nothing else;
// the editor routes need the matching action on investor.updates.
func TestInvestorRouteGuards(t *testing.T) {
	deps := testutil.Deps(t, func() time.Time { return testNow })
	m := New(deps, Ports{Gym: txGym{svc: gymdesk.NewService(deps.DB, gymdesk.Ports{}, deps.Now)},
		Accounting: txAccounting{svc: accounting.NewService(deps.DB, accounting.Ports{}, nil, deps.Now)}})
	mux := testutil.Mux(m)
	none := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"gym.reports": {"read"}}})
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"investor.overview": {"read"}}})
	editor := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"investor.updates": {"read", "create", "update", "delete"}}})
	t.Cleanup(func() {
		_, _ = deps.DB.Exec(context.Background(), `DELETE FROM investor.updates WHERE created_by = $1`, editor.UserID)
	})

	serve := func(method, target string, s testutil.Staff) int {
		t.Helper()
		var body any
		if method != "GET" && method != "DELETE" {
			body = map[string]any{"title": "x", "body": "y", "enabled": true, "published": true}
		}
		rec, _ := testutil.Do(t, mux, testutil.AsStaff(testutil.Request(method, target, body), s))
		return rec.Code
	}
	missing := "/api/investor/updates/00000000-0000-4000-8000-000000000000"
	var reads, writes []string
	for _, r := range m.Routes() {
		method, pattern, _ := strings.Cut(r.Pattern, " ")
		target := strings.NewReplacer("{id}", "00000000-0000-4000-8000-000000000000", "{attachmentId}", "00000000-0000-4000-8000-000000000001").Replace(pattern)
		if strings.HasPrefix(target, missing) || target == "/api/investor/updates/manage" || (method == "POST" && target == "/api/investor/updates") {
			writes = append(writes, method+" "+target)
		} else {
			reads = append(reads, method+" "+target)
		}
	}
	if len(reads) != 7 || len(writes) != 7 {
		t.Fatalf("routes split %d/%d: %v %v", len(reads), len(writes), reads, writes)
	}
	for _, route := range append(append([]string{}, reads...), writes...) {
		method, target, _ := strings.Cut(route, " ")
		if code := serve(method, target, none); code != http.StatusForbidden {
			t.Errorf("%s without investor menus = %d", route, code)
		}
	}
	for _, route := range reads {
		method, target, _ := strings.Cut(route, " ")
		if code := serve(method, target, reader); code != http.StatusOK {
			t.Errorf("%s with read on investor.overview = %d", route, code)
		}
	}
	for _, route := range writes {
		method, target, _ := strings.Cut(route, " ")
		if code := serve(method, target, reader); code != http.StatusForbidden {
			t.Errorf("%s with read only = %d", route, code)
		}
		if code := serve(method, target, editor); code == http.StatusForbidden || code == http.StatusUnauthorized {
			t.Errorf("%s with the editor grants = %d", route, code)
		}
	}
}
