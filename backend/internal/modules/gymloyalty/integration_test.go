package gymloyalty

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run inside one rolled-back transaction. The clock is
// Thursday 20 March 2031, 12:00 WIB, so nothing the other packages commit
// falls in the windows these tests read. XP goes to a recording port; the
// CRM ledger wiring is covered in internal/app.

type headerGuard struct{}

func (headerGuard) RequireAnyGrant(r *http.Request, grants ...iam.Grant) (*auth.User, int, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, -1, httpx.Unauthorized("")
	}
	return &auth.User{ID: id, FullName: "Manajer Uji"}, 0, nil
}

func (headerGuard) RequireMember(r *http.Request) (string, error) {
	id := r.Header.Get("X-Test-Member")
	if id == "" {
		return "", httpx.Unauthorized("Unauthorized")
	}
	return id, nil
}

// recordingXP keeps one award per idempotency key, like the CRM ledger.
type recordingXP struct{ awards map[string]XPAward }

func (x *recordingXP) Award(_ context.Context, _ database.DB, a XPAward) (bool, error) {
	if _, dup := x.awards[a.IdempotencyKey]; dup {
		return false, nil
	}
	x.awards[a.IdempotencyKey] = a
	return true, nil
}

func (x *recordingXP) Standing(_ context.Context, _ database.Querier, customerID string) (XPStanding, error) {
	out := XPStanding{}
	for _, a := range x.awards {
		if a.CustomerID == customerID {
			out.LifetimeXP += float64(a.XP)
		}
	}
	return out, nil
}

func (x *recordingXP) History(context.Context, database.Querier, string, int) ([]XPEntry, error) {
	return nil, nil
}

func (x *recordingXP) total(customerID string) (n int) {
	for _, a := range x.awards {
		if a.CustomerID == customerID {
			n += a.XP
		}
	}
	return n
}

type fixture struct {
	t     *testing.T
	ctx   context.Context
	tx    pgx.Tx
	clock time.Time
	xp    *recordingXP
	svc   *Service
	mux   *http.ServeMux
	staff string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{t: t, ctx: context.Background(), tx: testutil.Tx(t), xp: &recordingXP{awards: map[string]XPAward{}},
		clock: time.Date(2031, 3, 20, 12, 0, 0, 0, localtime.Jakarta), staff: "6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11"}
	f.svc = NewService(f.tx, Ports{XP: f.xp}, func() time.Time { return f.clock }, nil)
	f.mux = testutil.Mux(mod{h: &handler{svc: f.svc, guard: headerGuard{}}})
	return f
}

type response struct {
	Status int
	Body   map[string]any
	Raw    string
}

func (r response) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }

func (f *fixture) do(method, target, header, id string, body any) response {
	f.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = strings.NewReader(string(raw))
	}
	req := httptest.NewRequest(method, target, rd)
	if header != "" {
		req.Header.Set(header, id)
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
	return out
}

func (f *fixture) staffDo(method, target string, body any) response {
	f.t.Helper()
	return f.do(method, target, "X-Test-Staff", f.staff, body)
}

func (f *fixture) memberDo(customerID, method, target string) response {
	f.t.Helper()
	return f.do(method, target, "X-Test-Member", customerID, nil)
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

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) member(name string) string {
	return f.scalar(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, $2) RETURNING id::text`, "+6297"+testutil.RandomHex(4), name)
}

func (f *fixture) days(n int) time.Time { return f.clock.AddDate(0, 0, n) }

// purchase is a gym package bought for total, paid at paidAt.
func (f *fixture) purchase(customerID string, total float64, paidAt time.Time, status string, refunded *float64) string {
	pkg := f.scalar(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days) VALUES ($1, 10, $2, 60) RETURNING id::text`,
		"Paket Uji "+testutil.RandomHex(3), total)
	return f.scalar(`INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, total_idr, channel, payment_method, status, paid_at, refunded_idr)
		VALUES ($1, $2, 10, $3, $3, 'front_desk', 'cash', $4, $5, $6) RETURNING id::text`, customerID, pkg, total, status, paidAt, refunded)
}

func (f *fixture) posOrder(customerID string, total float64, at time.Time, voided bool) {
	var voidedAt *time.Time
	if voided {
		voidedAt = &at
	}
	f.exec(`INSERT INTO pos.pos_orders (order_number, cashier_id, customer_id, status, payment_status, subtotal, total_amount, created_at, voided_at)
		VALUES ($1, $2, $3, 'completed', 'paid', $4, $4, $5, $6)`, "GL"+testutil.RandomHex(4), f.staff, customerID, total, at, voidedAt)
}

func (f *fixture) shopOrder(customerID string, total float64, paidAt time.Time) {
	storefront := f.scalar(`INSERT INTO shop.storefronts (slug, name) VALUES ($1, 'Go Apparel') RETURNING id::text`, "gl-"+testutil.RandomHex(4))
	f.exec(`INSERT INTO shop.orders (storefront_id, status, customer_name, customer_phone, shipping_address, subtotal, total, customer_id, paid_at)
		VALUES ($1, 'completed', 'Go', '0812', 'Jl. Dago 1', $2, $2, $3, $4)`, storefront, total, customerID, paidAt)
}

func (f *fixture) tier(name string, minSpend float64, extra map[string]any) string {
	f.t.Helper()
	body := map[string]any{"name": name, "min_spend_idr": minSpend}
	for k, v := range extra {
		body[k] = v
	}
	res := f.staffDo("POST", "/api/gym/loyalty/tiers", body)
	if res.Status != 201 {
		f.t.Fatalf("create tier %s: %d %s", name, res.Status, res.Raw)
	}
	return res.data()["id"].(string)
}

func (f *fixture) ladder() (bronze, silver, gold string) {
	bronze = f.tier("Bronze", 1_000_000, map[string]any{"discount_percent": 3, "color": "#B08D57"})
	silver = f.tier("Silver", 5_000_000, map[string]any{"discount_percent": 5, "early_booking_days": 1, "waitlist_priority": true,
		"perks": []string{" Guest pass  bulanan ", "guest pass bulanan", "Handuk gratis"}})
	gold = f.tier("Gold", 10_000_000, map[string]any{"discount_percent": 10, "early_booking_days": 2, "cancel_window_hours": 2, "waitlist_priority": true})
	return bronze, silver, gold
}

func num(v any) float64 { n, _ := v.(float64); return n }

func tierName(view map[string]any) string {
	t, _ := view["tier"].(map[string]any)
	if t == nil {
		return "-"
	}
	return t["name"].(string)
}

func TestTierEditorValidation(t *testing.T) {
	f := newFixture(t)
	if res := f.do("GET", "/api/gym/loyalty/tiers", "", "", nil); res.Status != 401 {
		t.Fatalf("unauthenticated: %d", res.Status)
	}
	for body, msg := range map[string]string{
		`{"name":"  ","min_spend_idr":1}`:                         "Nama tier wajib diisi, maksimal 40 karakter",
		`{"name":"A","min_spend_idr":-1}`:                         "Ambang belanja tidak valid",
		`{"name":"A","min_spend_idr":1,"color":"lime"}`:           "Warna harus berformat #RRGGBB",
		`{"name":"A","min_spend_idr":1,"discount_percent":101}`:   "Diskon harus 0 sampai 100 persen",
		`{"name":"A","min_spend_idr":1,"early_booking_days":15}`:  "Booking lebih awal 0 sampai 14 hari",
		`{"name":"A","min_spend_idr":1,"cancel_window_hours":73}`: "Batas batal 0 sampai 72 jam",
		`{oops`: "Payload tidak valid",
	} {
		req := httptest.NewRequest("POST", "/api/gym/loyalty/tiers", strings.NewReader(body))
		req.Header.Set("X-Test-Staff", f.staff)
		rec := httptest.NewRecorder()
		f.mux.ServeHTTP(rec, req)
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), msg) {
			t.Errorf("%s: %d %s", body, rec.Code, rec.Body.String())
		}
	}
	_, silver, _ := f.ladder()
	if res := f.staffDo("POST", "/api/gym/loyalty/tiers", map[string]any{"name": "silver", "min_spend_idr": 7}); res.Status != 409 {
		t.Fatalf("duplicate name: %d %s", res.Status, res.Raw)
	}
	if res := f.staffDo("POST", "/api/gym/loyalty/tiers", map[string]any{"name": "Platinum", "min_spend_idr": 5_000_000}); res.Status != 409 {
		t.Fatalf("duplicate threshold: %d %s", res.Status, res.Raw)
	}
	res := f.staffDo("GET", "/api/gym/loyalty/tiers", nil)
	tiers := res.data()["tiers"].([]any)
	if len(tiers) != 3 {
		t.Fatalf("tiers: %s", res.Raw)
	}
	s := tiers[1].(map[string]any)
	if s["name"] != "Silver" || num(s["rank"]) != 2 || len(s["perks"].([]any)) != 2 || s["cancel_window_hours"] != nil {
		t.Fatalf("silver row: %v", s)
	}
	if res := f.staffDo("PATCH", "/api/gym/loyalty/tiers/"+silver, map[string]any{"name": "Silver Plus", "min_spend_idr": 6_000_000}); res.Status != 200 ||
		res.data()["name"] != "Silver Plus" {
		t.Fatalf("patch: %s", res.Raw)
	}
	if res := f.staffDo("PATCH", "/api/gym/loyalty/tiers/0b9e4a52-3f7d-4d8e-8f61-5c2a9d1e7b30", map[string]any{"name": "X"}); res.Status != 404 {
		t.Fatalf("patch unknown: %s", res.Raw)
	}
	if res := f.staffDo("DELETE", "/api/gym/loyalty/tiers/"+silver, nil); res.Status != 200 {
		t.Fatalf("delete: %s", res.Raw)
	}
	if got := f.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE entity = 'gym_membership_tier' AND entity_id = $1`, silver); got != "3" {
		t.Fatalf("audit rows for the tier = %s", got)
	}

	org := testutil.CreateOrg(t, f.tx)
	bad := f.staffDo("PUT", "/api/gym/loyalty/settings", map[string]any{"tier_hold_months": 40, "weekly_streak_min_sessions": 3, "purchase_step_idr": 10000})
	if bad.Status != 400 || bad.Body["error"] != "Masa tahan tier 0 sampai 36 bulan" {
		t.Fatalf("bad settings: %s", bad.Raw)
	}
	res = f.staffDo("PUT", "/api/gym/loyalty/settings", map[string]any{
		"tier_hold_months": 6, "xp_class_attended": 40, "weekly_streak_min_sessions": 2, "purchase_step_idr": 20000,
		"offpeak": []any{map[string]any{"branch_id": org.BranchID, "offpeak": map[string]any{"starts_min": 600, "ends_min": 960}}},
	})
	if res.Status != 200 || num(res.data()["settings"].(map[string]any)["tier_hold_months"]) != 6 {
		t.Fatalf("save settings: %s", res.Raw)
	}
	if got := f.scalar(`SELECT starts_min || '-' || ends_min FROM gym.loyalty_offpeak_hours WHERE branch_id = $1`, org.BranchID); got != "600-960" {
		t.Fatalf("off-peak = %s", got)
	}
}

func TestSpendWindowTierHoldAndCard(t *testing.T) {
	f := newFixture(t)
	f.ladder()
	m := f.member("Maya Kartika")
	f.purchase(m, 4_000_000, f.days(-10), "paid", nil)
	refunded := 1_500_000.0
	f.purchase(m, 2_000_000, f.days(-2), "refunded", &refunded) // nets 500.000
	f.purchase(m, 3_000_000, f.days(-400), "paid", nil)         // outside the window
	f.purchase(m, 9_000_000, f.days(-1), "pending", nil)        // never paid
	f.posOrder(m, 1_500_000, f.days(-5), false)
	f.posOrder(m, 9_000_000, f.days(-3), true) // voided
	f.posOrder(m, 1_200_000, f.days(300), false)
	f.shopOrder(m, 1_100_000, f.days(-1))

	card := f.memberDo(m, "GET", "/api/member-portal/app/membership")
	view := card.data()
	spend := view["spend"].(map[string]any)
	next := view["next"].(map[string]any)
	if card.Status != 200 || tierName(view) != "Silver" || num(spend["total_idr"]) != 7_100_000 || num(spend["gym_idr"]) != 4_500_000 ||
		num(spend["pos_idr"]) != 1_500_000 || num(spend["shop_idr"]) != 1_100_000 || spend["from"] != "2030-03-21" ||
		next["tier"].(map[string]any)["name"] != "Gold" || num(next["spend_needed_idr"]) != 2_900_000 || view["valid_until"] != "2032-03-20" {
		t.Fatalf("card: %s", card.Raw)
	}
	perks := view["perks"].(map[string]any)
	if num(perks["discount_percent"]) != 5 || num(perks["early_booking_days"]) != 1 || num(perks["waitlist_rank"]) != 2 {
		t.Fatalf("perks: %v", perks)
	}
	if hist := view["history"].([]any); len(hist) != 1 || hist[0].(map[string]any)["direction"] != "up" {
		t.Fatalf("history: %v", view["history"])
	}
	if got := f.scalar(`SELECT title FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_membership_tier_up'`, m); got != "Selamat, kamu naik ke Silver" {
		t.Fatalf("notification = %q", got)
	}

	// 357 days on the 4M purchase left the window: spending earns Bronze,
	// but Silver holds until 20 March 2032.
	f.clock = f.days(357)
	view = f.memberDo(m, "GET", "/api/member-portal/app/membership").data()
	keep := view["keep"].(map[string]any)
	if tierName(view) != "Silver" || num(view["spend"].(map[string]any)["total_idr"]) != 4_300_000 || num(keep["spend_needed_idr"]) != 700_000 ||
		keep["by"] != "2032-03-20" {
		t.Fatalf("inside the hold: %v", view)
	}

	// Past the hold only the later POS order counts: down to Bronze.
	f.clock = f.days(10)
	view = f.memberDo(m, "GET", "/api/member-portal/app/membership").data()
	if tierName(view) != "Bronze" || view["valid_until"] != "2033-03-21" {
		t.Fatalf("after the hold: %v", view)
	}
	if got := f.scalar(`SELECT direction || ':' || from_tier_name || ':' || to_tier_name FROM gym.membership_tier_changes
		WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, m); got != "down:Silver:Bronze" {
		t.Fatalf("last change = %s", got)
	}

	// Staff see the same card on the member 360; unknown members are 404.
	res := f.staffDo("GET", "/api/gym/members/"+m+"/loyalty", nil)
	if res.Status != 200 || tierName(res.data()["membership"].(map[string]any)) != "Bronze" || res.data()["standing"].(map[string]any)["status"] != "active" {
		t.Fatalf("360: %s", res.Raw)
	}
	if res := f.staffDo("GET", "/api/gym/members/0b9e4a52-3f7d-4d8e-8f61-5c2a9d1e7b30/loyalty", nil); res.Status != 404 {
		t.Fatalf("unknown member: %s", res.Raw)
	}
}

func TestPerksAndDiscounts(t *testing.T) {
	f := newFixture(t)
	f.ladder()
	gold, plain := f.member("Gilang Gold"), f.member("Polos")
	f.purchase(gold, 10_000_000, f.days(-1), "paid", nil)
	if _, err := f.svc.Recompute(f.ctx, f.tx, gold); err != nil {
		t.Fatal(err)
	}
	p, err := f.svc.Perks(f.ctx, f.tx, gold)
	if err != nil || p.Frozen || p.Perks.EarlyBookingDays != 2 || *p.Perks.CancelWindowHours != 2 || p.Perks.WaitlistRank != 3 || p.Perks.DiscountPercent != 10 {
		t.Fatalf("gold perks: %+v %v", p, err)
	}
	if p, _ := f.svc.Perks(f.ctx, f.tx, plain); p.Perks.WaitlistRank != 0 || p.Banned {
		t.Fatalf("plain perks: %+v", p)
	}
	d, err := Discounts(f.ctx, f.tx, []string{gold, plain}, f.clock)
	if err != nil || d[gold].Percent != 10 || d[gold].Frozen {
		t.Fatalf("discounts: %+v %v", d, err)
	}
	if _, listed := d[plain]; listed {
		t.Fatal("a member without tier or status is left out")
	}
}

func TestMemberStatusEffects(t *testing.T) {
	f := newFixture(t)
	f.ladder()
	m := f.member("Rizal Status")
	f.purchase(m, 10_000_000, f.days(-1), "paid", nil)
	if _, err := f.svc.Recompute(f.ctx, f.tx, m); err != nil {
		t.Fatal(err)
	}
	target := "/api/gym/members/" + m + "/status"
	if res := f.staffDo("PUT", target, map[string]any{"status": "banned", "reason": " "}); res.Status != 400 || res.Body["error"] != "Alasan wajib diisi" {
		t.Fatalf("ban without reason: %s", res.Raw)
	}
	if res := f.staffDo("PUT", target, map[string]any{"status": "suspended", "reason": "Tunggakan"}); res.Status != 400 {
		t.Fatalf("suspend without date: %s", res.Raw)
	}
	if res := f.staffDo("PUT", "/api/gym/members/0b9e4a52-3f7d-4d8e-8f61-5c2a9d1e7b30/status", map[string]any{"status": "active"}); res.Status != 404 {
		t.Fatalf("unknown member: %s", res.Raw)
	}

	until := f.days(2)
	res := f.staffDo("PUT", target, map[string]any{"status": "suspended", "reason": "Tunggakan", "suspended_until": until})
	if res.Status != 200 || res.data()["status"] != "suspended" {
		t.Fatalf("suspend: %s", res.Raw)
	}
	p, _ := f.svc.Perks(f.ctx, f.tx, m)
	if !p.Frozen || p.Banned || p.Perks.EarlyBookingDays != 0 {
		t.Fatalf("suspended perks: %+v", p)
	}
	if d, _ := Discounts(f.ctx, f.tx, []string{m}, f.clock); !d[m].Frozen || d[m].Percent != 0 {
		t.Fatalf("suspended discount: %+v", d)
	}
	list := f.staffDo("GET", "/api/gym/loyalty/members", nil)
	found := false
	for _, r := range list.Body["data"].([]any) {
		if row := r.(map[string]any); row["customer_id"] == m {
			found = row["status"] == "suspended" && row["tier_name"] == "Gold"
		}
	}
	if !found {
		t.Fatalf("status list: %s", list.Raw)
	}

	// The suspension ends on its date.
	f.clock = f.days(3)
	if p, _ := f.svc.Perks(f.ctx, f.tx, m); p.Frozen {
		t.Fatalf("after the suspension: %+v", p)
	}

	if res := f.staffDo("PUT", target, map[string]any{"status": "banned", "reason": "Merusak alat"}); res.Status != 200 {
		t.Fatalf("ban: %s", res.Raw)
	}
	if p, _ := f.svc.Perks(f.ctx, f.tx, m); !p.Banned || !p.Frozen {
		t.Fatalf("banned perks: %+v", p)
	}
	res = f.staffDo("GET", "/api/gym/members/"+m+"/loyalty", nil)
	hist := res.data()["status_history"].([]any)
	if len(hist) != 2 || hist[0].(map[string]any)["to_status"] != "banned" || hist[0].(map[string]any)["from_status"] != "active" ||
		hist[1].(map[string]any)["from_status"] != "active" {
		t.Fatalf("history: %s", res.Raw)
	}
	if got := f.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE entity = 'gym_member_status' AND entity_id = $1`, m); got != "2" {
		t.Fatalf("audit rows = %s", got)
	}
	if got := f.scalar(`SELECT string_agg(title, ',' ORDER BY title) FROM crm.member_notifications WHERE customer_id = $1 AND type = 'gym_member_status'`, m); got != "Akun diblokir,Akun ditangguhkan" {
		t.Fatalf("notifications = %q", got)
	}
}

// attendFixture is a branch with off-peak hours, a class type and a PT type.
type attendFixture struct {
	*fixture
	branch, classType, ptType, coach string
}

func newAttendFixture(t *testing.T) attendFixture {
	f := newFixture(t)
	org := testutil.CreateOrg(t, f.tx)
	a := attendFixture{fixture: f, branch: org.BranchID}
	f.exec(`INSERT INTO gym.loyalty_offpeak_hours (branch_id, starts_min, ends_min) VALUES ($1, 600, 960)`, a.branch)
	a.classType = f.scalar(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ($1, 60, 1, 10) RETURNING id::text`, "Kelas XP "+testutil.RandomHex(3))
	a.ptType = f.scalar(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity, is_personal)
		VALUES ($1, 60, 1, 1, true) RETURNING id::text`, "PT XP "+testutil.RandomHex(3))
	a.coach = f.scalar(`INSERT INTO gym.coaches (name) VALUES ($1) RETURNING id::text`, "Coach XP "+testutil.RandomHex(3))
	return a
}

// attend checks the member in to a class at the branch starting at.
func (a attendFixture) attend(customerID string, at time.Time) string {
	session := a.scalar(`INSERT INTO gym.class_sessions (class_type_id, branch_id, starts_at, ends_at, capacity, credit_cost, booking_opens_at, booking_closes_at, status)
		VALUES ($1, $2, $3, $4, 10, 1, $3, $3, 'completed') RETURNING id::text`, a.classType, a.branch, at, at.Add(time.Hour))
	return a.scalar(`INSERT INTO gym.bookings (session_id, customer_id, status, checked_in_at) VALUES ($1, $2, 'completed', $3) RETURNING id::text`,
		session, customerID, at)
}

func (a attendFixture) attendPT(customerID string, at time.Time) string {
	appt := a.scalar(`INSERT INTO gym.pt_appointments (coach_id, class_type_id, branch_id, starts_at, ends_at, capacity, credit_cost, status)
		VALUES ($1, $2, $3, $4, $5, 1, 1, 'completed') RETURNING id::text`, a.coach, a.ptType, a.branch, at, at.Add(time.Hour))
	return a.scalar(`INSERT INTO gym.pt_participants (appointment_id, customer_id, status, checked_in_at) VALUES ($1, $2, 'completed', $3) RETURNING id::text`,
		appt, customerID, at)
}

func wib(day, hour int) time.Time { return time.Date(2031, 3, day, hour, 0, 0, 0, localtime.Jakarta) }

func TestAttendanceXPAndStreaks(t *testing.T) {
	a := newAttendFixture(t)
	m, frozen := a.member("Sari Rajin"), a.member("Beku")
	// This ISO week (from Monday 17 March): an off-peak class, a morning
	// class and a PT session. The three weeks before have three sessions each.
	offpeak := a.attend(m, wib(18, 11))
	morning := a.attend(m, wib(19, 7))
	pt := a.attendPT(m, wib(20, 7))
	for _, day := range []int{10, 11, 12, 3, 4, 5} {
		a.attend(m, wib(day, 7))
	}
	for _, at := range []time.Time{time.Date(2031, 2, 24, 7, 0, 0, 0, localtime.Jakarta), time.Date(2031, 2, 25, 7, 0, 0, 0, localtime.Jakarta),
		time.Date(2031, 2, 26, 7, 0, 0, 0, localtime.Jakarta)} {
		a.attend(m, at)
	}
	a.attend(frozen, wib(19, 11))
	a.exec(`INSERT INTO gym.member_status (customer_id, status, reason, suspended_until) VALUES ($1, 'suspended', 'Uji', $2)`, frozen, a.days(5))

	for range 2 {
		if err := a.svc.SweepAttendance(a.ctx, a.clock); err != nil {
			t.Fatal(err)
		}
	}
	want := map[string]int{
		"gym:attend:" + offpeak: 50, "gym:offpeak:" + offpeak: 20, "gym:attend:" + morning: 50, "gym:attend-pt:" + pt: 80,
		"gym:streak:" + m + ":2031-03-17": 100, "gym:streak4:" + m + ":2031-03-17": 300,
	}
	for key, xp := range want {
		if got := a.xp.awards[key]; got.XP != xp || got.CustomerID != m {
			t.Errorf("%s: %+v, want %d XP", key, got, xp)
		}
	}
	if a.xp.total(m) != 600 {
		t.Errorf("total XP %d, want 600 (older weeks are outside the lookback)", a.xp.total(m))
	}
	if a.xp.total(frozen) != 0 {
		t.Errorf("a suspended member earned %d XP", a.xp.total(frozen))
	}
	if d := a.xp.awards["gym:offpeak:"+offpeak].Description; !strings.HasPrefix(d, "Bonus jam sepi · Kelas XP") {
		t.Errorf("off-peak description %q", d)
	}

	view, err := a.svc.Progress(a.ctx, m)
	if err != nil || view.StreakWeeks != 4 || view.WeekSessions != 3 || view.MonthSessions != 9 || view.XP.LifetimeXP != 600 {
		t.Fatalf("progress: %+v %v", view, err)
	}
}

func TestPurchaseXPAndEarlyRenewal(t *testing.T) {
	f := newFixture(t)
	withPass, withCredits, fresh := f.member("Pass Aktif"), f.member("Kredit Sisa"), f.member("Baru")
	pkg := f.scalar(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days) VALUES ('Pass Uji', 10, 1, 30) RETURNING id::text`)
	f.exec(`INSERT INTO gym.member_passes (customer_id, package_id, starts_at, ends_at, status) VALUES ($1, $2, $3, $4, 'active')`,
		withPass, pkg, f.days(-20), f.days(10))
	old := f.purchase(withCredits, 500_000, f.days(-30), "paid", nil)
	lot := f.scalar(`INSERT INTO gym.credit_lots (customer_id, package_id, purchase_id, credits, expires_at) VALUES ($1, $2, $3, 5, $4) RETURNING id::text`,
		withCredits, pkg, old, f.days(30))
	f.exec(`INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id, source_type) VALUES ($1, 'top_up', 5, $2, 'purchase')`, withCredits, lot)

	for _, c := range []struct {
		member string
		early  bool
	}{{withPass, true}, {withCredits, true}, {fresh, false}} {
		id := f.purchase(c.member, 1_250_000, f.clock, "paid", nil)
		for range 2 {
			if err := f.svc.AwardPurchase(f.ctx, f.tx, id); err != nil {
				t.Fatal(err)
			}
		}
		if got := f.xp.awards["gym:purchase:"+id]; got.XP != 125 || got.SourceType != "package_purchase" {
			t.Errorf("purchase XP: %+v", got)
		}
		if _, got := f.xp.awards["gym:early-renewal:"+id]; got != c.early {
			t.Errorf("member %s early renewal = %v, want %v", c.member, got, c.early)
		}
	}
	if f.xp.total(fresh) != 125 || f.xp.total(withPass) != 275 {
		t.Fatalf("totals: fresh %d, pass %d", f.xp.total(fresh), f.xp.total(withPass))
	}
	// A pending purchase earns nothing.
	pending := f.purchase(fresh, 1_000_000, f.clock, "pending", nil)
	if err := f.svc.AwardPurchase(f.ctx, f.tx, pending); err != nil || f.xp.total(fresh) != 125 {
		t.Fatalf("pending: %v %d", err, f.xp.total(fresh))
	}
}

func TestLeaderboardOptInAndPrivacy(t *testing.T) {
	a := newAttendFixture(t)
	maya, hidden, budi, banned := a.member("Maya Kartika Sari"), a.member("Hana Tersembunyi"), a.member("Budi"), a.member("Dilarang Masuk")
	for _, day := range []int{3, 5, 7} {
		a.attend(maya, wib(day, 7))
	}
	a.attend(hidden, wib(4, 7))
	a.attendPT(hidden, wib(6, 7))
	a.attend(budi, wib(8, 7))
	a.attend(budi, wib(9, 7))
	for _, day := range []int{1, 2, 3, 4, 5} {
		a.attend(banned, wib(day, 18))
	}
	a.attend(maya, time.Date(2031, 2, 27, 7, 0, 0, 0, localtime.Jakarta)) // last month
	a.exec(`INSERT INTO gym.athlete_settings (customer_id, show_on_leaderboard) VALUES ($1, false)`, hidden)
	a.exec(`INSERT INTO gym.member_status (customer_id, status, reason) VALUES ($1, 'banned', 'Uji')`, banned)

	res := a.memberDo(hidden, "GET", "/api/member-portal/app/leaderboard?branch_id="+a.branch)
	view := res.data()
	entries := view["entries"].([]any)
	if res.Status != 200 || view["month"] != "2031-03" || len(entries) != 2 {
		t.Fatalf("board: %s", res.Raw)
	}
	first, second := entries[0].(map[string]any), entries[1].(map[string]any)
	if first["alias"] != "Maya K." || num(first["sessions"]) != 3 || num(first["rank"]) != 1 ||
		second["alias"] != "Budi" || num(second["sessions"]) != 2 || num(second["rank"]) != 2 {
		t.Fatalf("entries: %v", entries)
	}
	me := view["me"].(map[string]any)
	if me["visible"] != false || me["show_on_leaderboard"] != false || num(me["sessions"]) != 2 || num(me["rank"]) != 2 {
		t.Fatalf("me: %v", me)
	}

	// Without a branch the member's most attended branch this month is used.
	res = a.memberDo(maya, "GET", "/api/member-portal/app/leaderboard")
	if b, _ := res.data()["branch"].(map[string]any); b == nil || b["id"] != a.branch || res.data()["me"].(map[string]any)["visible"] != true {
		t.Fatalf("default branch: %s", res.Raw)
	}
	if res := a.memberDo(maya, "GET", "/api/member-portal/app/leaderboard?branch_id="+a.branch+"&month=2031-02"); num(res.data()["entries"].([]any)[0].(map[string]any)["sessions"]) != 1 {
		t.Fatalf("last month: %s", res.Raw)
	}
	if res := a.memberDo(maya, "GET", "/api/member-portal/app/leaderboard?branch_id="+a.branch+"&month=maret"); res.Status != 400 {
		t.Fatalf("bad month: %s", res.Raw)
	}
	if res := a.staffDo("GET", "/api/gym/loyalty/leaderboard?branch_id="+a.branch, nil); res.Status != 200 || res.data()["me"] != nil {
		t.Fatalf("staff board: %s", res.Raw)
	}
}
