package ticketing

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	contract "nuhabit/backend/internal/contracts/ticketing"
	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run every write in one rolled-back transaction on a
// fresh test branch; handlers get a header-driven guard and fixed venue.
// TestAuthWiring covers the real platform/auth guard, and the concurrency
// tests commit (and then delete) their own venue to prove the locks.

type headerGuard struct{}

func (headerGuard) RequireMenuPrefix(r *http.Request, _ ...string) (*auth.User, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, httpx.Unauthorized("")
	}
	return &auth.User{ID: id}, nil
}

type fixedVenue struct{ company, branch string }

func (f fixedVenue) Resolve(context.Context, string) (string, string, error) {
	return f.company, f.branch, nil
}

// sqlEmployees mirrors internal/app's adapter (the module test cannot
// import internal/app).
type sqlEmployees struct{}

func (sqlEmployees) Find(ctx context.Context, q database.Querier, ids []string, pattern string) ([]Employee, error) {
	rows, err := q.Query(ctx, `SELECT id::text, full_name, nip, is_active,
		  $2 <> '' AND (full_name ILIKE $2 OR COALESCE(nip ILIKE $2, false))
		FROM hris.employees WHERE id = ANY($1::uuid[]) ORDER BY full_name`, ids, pattern)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Employee
	for rows.Next() {
		var e Employee
		if err := rows.Scan(&e.ID, &e.FullName, &e.NIP, &e.IsActive, &e.Matched); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

type fakeMessenger struct {
	err  error
	sent []string
}

func (m *fakeMessenger) SendText(_ context.Context, target, message string) error {
	m.sent = append(m.sent, target+"|"+message)
	return m.err
}

type fixture struct {
	t      *testing.T
	ctx    context.Context
	tx     pgx.Tx
	mux    *http.ServeMux
	staff  string
	venue  Venue
	wa     *fakeMessenger
	walkIn string
	web    string
}

var discard = slog.New(slog.NewTextHandler(io.Discard, nil))

func newVenue(t *testing.T, ctx context.Context, q database.Querier) (company, branch string) {
	t.Helper()
	if err := q.QueryRow(ctx, `SELECT id::text FROM configuration.companies ORDER BY created_at LIMIT 1`).Scan(&company); err != nil {
		t.Skipf("no company to host a test venue: %v", err)
	}
	if err := q.QueryRow(ctx, `INSERT INTO configuration.branches (company_id, name, code)
		VALUES ($1, 'Go Test Venue', $2) RETURNING id::text`, company, "GT-"+testutil.RandomHex(4)).Scan(&branch); err != nil {
		t.Fatal(err)
	}
	return company, branch
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pool := testutil.DB(t)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	company, branch := newVenue(t, ctx, tx)
	f := &fixture{t: t, ctx: ctx, tx: tx, staff: staff.UserID, wa: &fakeMessenger{},
		venue: Venue{UserID: staff.UserID, CompanyID: company, BranchID: branch}}
	venues := fixedVenue{company, branch}
	svc := NewService(tx, Ports{Venues: venues, Employees: sqlEmployees{}, Messenger: f.wa, AppOrigin: "https://tiket.example"}, nil, discard)
	h := &handler{svc: svc, guard: headerGuard{}, venues: venues, limiter: domain.NewRateLimiter(), now: time.Now}
	f.mux = testutil.Mux(mod{h: h})

	// Bootstrap settings and the default channels, as opening the page does.
	f.ok(f.call("GET", "/api/ticketing/settings", nil))
	f.walkIn = f.scalar(`SELECT id::text FROM ticketing.ticket_channels WHERE branch_id = $1 AND code = 'walk-in'`, branch)
	f.web = f.scalar(`SELECT id::text FROM ticketing.ticket_channels WHERE branch_id = $1 AND code = 'website'`, branch)
	return f
}

type response struct {
	Status int
	Body   map[string]any
	Raw    string
}

func (r response) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }
func (r response) list() []any          { l, _ := r.Body["data"].([]any); return l }

func (f *fixture) call(method, target string, body any) response {
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
	req.Header.Set("X-Test-Staff", f.staff)
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
	return out
}

func (f *fixture) ok(r response) response {
	f.t.Helper()
	if r.Status != 200 && r.Status != 201 {
		f.t.Fatalf("status %d: %s", r.Status, r.Raw)
	}
	return r
}

func (f *fixture) fail(r response, status int, msg string) {
	f.t.Helper()
	if r.Status != status || r.Body["error"] != msg {
		f.t.Fatalf("want %d %q, got %d %s", status, msg, r.Status, r.Raw)
	}
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var s *string
	if err := f.tx.QueryRow(f.ctx, sql, args...).Scan(&s); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return deref(s)
}

func eq(t *testing.T, got, want any) {
	t.Helper()
	g, _ := json.Marshal(got)
	w, _ := json.Marshal(want)
	if string(g) != string(w) {
		t.Fatalf("got %s, want %s", g, w)
	}
}

// ticket creates an Active "umum" ticket priced regular/high and returns
// its product and variant ids (walk-in distribution is on by default).
func (f *fixture) ticket(name string, regular, high float64) (string, string) {
	f.t.Helper()
	created := f.ok(f.call("POST", "/api/ticketing/products", map[string]any{"name": name, "variant_preset": "umum", "status": "active"}))
	id := created.data()["id"].(string)
	variant := f.scalar(`SELECT id::text FROM ticketing.ticket_product_variants WHERE ticket_product_id = $1`, id)
	f.ok(f.call("PATCH", "/api/ticketing/products/"+id, map[string]any{
		"variants": []any{map[string]any{"id": variant, "price_regular": regular, "price_high": high}},
	}))
	return id, variant
}

func (f *fixture) band(uid, label string) {
	f.t.Helper()
	r := f.call("POST", "/api/ticketing/bands", map[string]any{"nfc_uid": uid, "label": label})
	if r.Status != 201 || r.Body["message"] != "Gelang terdaftar" {
		f.t.Fatalf("band: %d %s", r.Status, r.Raw)
	}
}

func (f *fixture) visit(body map[string]any) string {
	f.t.Helper()
	r := f.ok(f.call("POST", "/api/ticketing/visits", body))
	eq(f.t, r.Body["message"], "Kunjungan terdaftar")
	return r.data()["id"].(string)
}

func (f *fixture) tap(uid string) response {
	f.t.Helper()
	return f.ok(f.call("POST", "/api/ticketing/gate/tap", map[string]any{"nfc_uid": uid}))
}

func TestSettingsProductsAndDistribution(t *testing.T) {
	f := newFixture(t)
	settings := f.ok(f.call("GET", "/api/ticketing/settings", nil))
	if !strings.Contains(settings.Raw, `"re_entry_policy":"sekali-masuk","default_credit_limit":"500000.00","default_payment_mode":"postpaid","booking_slug":null`) {
		t.Fatal(settings.Raw)
	}
	f.fail(f.call("PUT", "/api/ticketing/settings", map[string]any{"booking_slug": "status"}), 400, "Validation failed")
	put := f.ok(f.call("PUT", "/api/ticketing/settings", map[string]any{"slot_grace_minutes": 15, "booking_forfeit_days": nil}))
	eq(t, []any{put.data()["slot_grace_minutes"], put.data()["booking_forfeit_days"], put.Body["message"]}, []any{15, nil, "Pengaturan tersimpan"})

	channels := f.ok(f.call("GET", "/api/ticketing/channels", nil)).list()
	eq(t, len(channels), 2)
	eq(t, channels[0].(map[string]any)["code"], "walk-in")

	created := f.ok(f.call("POST", "/api/ticketing/products", map[string]any{"name": "Kolam", "category_name": "Wahana"}))
	eq(t, created.Body["message"], "Ticket TKT-0001 dibuat")
	id := created.data()["id"].(string)
	detail := f.ok(f.call("GET", "/api/ticketing/products/"+id, nil)).data()
	product := detail["product"].(map[string]any)
	eq(t, []any{product["code"], product["category_name"], product["base_price"], product["status"]}, []any{"TKT-0001", "Wahana", 0, "draft"})
	variants := detail["variants"].([]any)
	eq(t, len(variants), 2) // Adult + Child
	adult := variants[0].(map[string]any)
	eq(t, []any{adult["name"], adult["price_regular"]}, []any{"Adult", nil})

	// Distribution guard: Draft first, then missing prices.
	f.fail(f.call("PATCH", "/api/ticketing/products/"+id+"/channels", map[string]any{"channel_id": f.web, "is_distributed": true}),
		400, "Ticket masih Draft — aktifkan dulu sebelum didistribusi")
	f.ok(f.call("PATCH", "/api/ticketing/products/"+id, map[string]any{"status": "active"}))
	f.fail(f.call("PATCH", "/api/ticketing/products/"+id+"/channels", map[string]any{"channel_id": f.web, "is_distributed": true}),
		400, `Harga varian "Adult" belum lengkap (Regular & High Season) untuk kanal ini`)
	child := variants[1].(map[string]any)["id"].(string)
	f.ok(f.call("PATCH", "/api/ticketing/products/"+id, map[string]any{"variants": []any{
		map[string]any{"id": adult["id"], "price_regular": 50000, "price_high": 60000},
		map[string]any{"id": child, "price_regular": 30000},
	}}))
	// The website override covers the child's missing high price.
	f.ok(f.call("PUT", "/api/ticketing/products/"+id+"/channel-prices", map[string]any{"channel_id": f.web, "prices": []any{
		map[string]any{"variant_id": child, "price_regular": nil, "price_high": 35000},
	}}))
	on := f.ok(f.call("PATCH", "/api/ticketing/products/"+id+"/channels", map[string]any{"channel_id": f.web, "is_distributed": true}))
	if on.Raw != `{"success":true,"data":{"id":"`+id+`","channel_id":"`+f.web+`","is_distributed":true},"message":"Ticket didistribusikan"}` {
		t.Fatal(on.Raw)
	}

	board := f.ok(f.call("GET", "/api/ticketing/channel-manager", nil)).list()
	cells := board[0].(map[string]any)["channels"].([]any)
	eq(t, []any{cells[0].(map[string]any)["is_distributed"], cells[1].(map[string]any)["price_complete"]}, []any{true, true})

	list := f.ok(f.call("GET", "/api/ticketing/products?q=kol", nil)).list()
	eq(t, list[0].(map[string]any)["distributed_channels"], []string{"walk-in", "website"})
	loket := f.ok(f.call("GET", "/api/ticketing/products/loket-options", nil)).list()
	eq(t, len(loket), 2)
	eq(t, loket[0].(map[string]any)["members_per_unit"], 0)

	cats := f.ok(f.call("POST", "/api/ticketing/categories", map[string]any{"name": "wahana"}))
	if _, has := cats.Body["message"]; has {
		t.Fatalf("existing category must not report creation: %s", cats.Raw)
	}
	f.fail(f.call("POST", "/api/ticketing/categories", map[string]any{"name": " "}), 400, "Nama kategori wajib diisi")

	// Back to Draft switches every distribution off.
	f.ok(f.call("PATCH", "/api/ticketing/products/"+id, map[string]any{"status": "draft"}))
	eq(t, f.scalar(`SELECT count(*)::text FROM ticketing.ticket_product_channels WHERE ticket_product_id = $1 AND is_distributed`, id), "0")
}

func TestWalkInVisitGateAndSettlement(t *testing.T) {
	f := newFixture(t)
	_, variant := f.ticket("Kolam", 50000, 75000)
	f.band("04:a1:b2:c3", "G1")
	f.band("04A1B2C4", "G2")
	r := f.call("POST", "/api/ticketing/bands", map[string]any{"nfc_uid": "04a1b2c3"})
	f.fail(r, 409, "Gelang sudah terdaftar (status: tersedia)")
	bands := f.ok(f.call("GET", "/api/ticketing/bands?limit=1", nil))
	eq(t, bands.Body["pagination"], map[string]any{"page": 1, "limit": 1, "total": 2, "totalPages": 2})

	visitID := f.visit(map[string]any{"contact_name": "Budi", "payment_mode": "postpaid", "bands": []any{
		map[string]any{"nfc_uid": "04A1B2C3", "variant_id": variant},
		map[string]any{"nfc_uid": "04A1B2C4", "variant_id": variant},
	}})
	f.fail(f.call("POST", "/api/ticketing/visits", map[string]any{"contact_name": "Ani", "payment_mode": "postpaid",
		"bands": []any{map[string]any{"nfc_uid": "04A1B2C3", "variant_id": variant}}}),
		409, `Gelang 04A1B2C3 berstatus "dipakai" — tidak bisa dipakai`)

	first := f.tap("04a1b2c3")
	if first.Raw != `{"success":true,"data":{"result":"masuk","ok":true,"contact_name":"Budi","ticket_type_name":"Kolam — Umum","guest_name":null,"band_label":"G1","charged_amount":50000}}` {
		t.Fatal(first.Raw)
	}
	again := f.tap("04A1B2C3")
	eq(t, []any{again.data()["result"], again.data()["reason"]}, []any{"ditolak-sudah-masuk", "Tiket sudah dipakai masuk (kebijakan sekali masuk)"})
	unknown := f.tap("DEADBEEF")
	if unknown.Raw != `{"success":true,"data":{"result":"ditolak-gelang-tak-dikenal","ok":false,"reason":"Gelang tidak terdaftar di registry venue"}}` {
		t.Fatal(unknown.Raw)
	}
	eq(t, f.scalar(`SELECT count(*)::text FROM ticketing.ticket_gate_events WHERE branch_id = $1`, f.venue.BranchID), "3")

	detail := f.ok(f.call("GET", "/api/ticketing/visits/"+visitID, nil)).data()
	eq(t, detail["summary"], map[string]any{"debit": 50000, "kredit": 0, "outstanding": 50000, "saldo": -50000})
	eq(t, detail["plan"], map[string]any{"amountDue": 50000, "refundAmount": 0})
	eq(t, detail["visit"].(map[string]any)["credit_limit"], 500000)
	// Both visit bands share one created_at, so pick them by UID.
	vb1 := f.scalar(`SELECT vb.id::text FROM ticketing.ticket_visit_bands vb JOIN ticketing.ticket_bands b ON b.id = vb.band_id
		WHERE vb.visit_id = $1 AND b.nfc_uid = '04A1B2C3'`, visitID)
	band2 := f.scalar(`SELECT id::text FROM ticketing.ticket_bands WHERE nfc_uid = '04A1B2C4' AND branch_id = $1`, f.venue.BranchID)

	open := f.ok(f.call("GET", "/api/ticketing/visits?q=budi", nil))
	item := open.list()[0].(map[string]any)
	eq(t, []any{item["credit_limit"], item["band_count"], item["debit"], item["outstanding"]}, []any{"500000.00", 2, 50000, 50000})
	stats := f.ok(f.call("GET", "/api/ticketing/tab/stats", nil))
	eq(t, stats.data(), map[string]any{"open_visits": 1, "open_bands": 2, "outstanding_total": 50000, "saldo_total": 0})
	check := f.ok(f.call("POST", "/api/ticketing/tab/check", map[string]any{"nfc_uid": "04A1B2C4", "amount": 20000}))
	eq(t, check.data(), map[string]any{"ok": true, "visitId": visitID, "bandId": band2,
		"contactName": "Budi", "paymentMode": "postpaid", "available": 450000})

	f.fail(f.call("POST", "/api/ticketing/visits/"+visitID+"/settle", map[string]any{"visit_band_id": vb1,
		"payments": []any{map[string]any{"method": "cash", "amount": 10000}}}), 400, "Nominal pembayaran (Rp10.000) harus pas Rp50.000")
	one := f.ok(f.call("POST", "/api/ticketing/visits/"+visitID+"/settle", map[string]any{"visit_band_id": vb1,
		"payments": []any{map[string]any{"method": "qris", "amount": 50000}}}))
	if one.Raw != `{"success":true,"data":{"mode":"per-gelang","paid":50000,"closed":false},"message":"Settlement berhasil"}` {
		t.Fatal(one.Raw)
	}
	all := f.ok(f.call("POST", "/api/ticketing/visits/"+visitID+"/settle", map[string]any{}))
	eq(t, all.data(), map[string]any{"mode": "rombongan", "paid": 0, "refunded": 0, "closed": true})
	eq(t, f.scalar(`SELECT string_agg(status, ',' ORDER BY nfc_uid) FROM ticketing.ticket_bands WHERE branch_id = $1`, f.venue.BranchID), "tersedia,tersedia")
	f.fail(f.call("POST", "/api/ticketing/visits/"+visitID+"/settle", map[string]any{}), 409, "Kunjungan sudah ditutup")
}

func TestPrepaidTopUpVoidAndLostBand(t *testing.T) {
	f := newFixture(t)
	_, variant := f.ticket("Kolam", 50000, 50000)
	f.band("0A0B0C0D", "")
	body := map[string]any{"contact_name": "Sari", "payment_mode": "prepaid",
		"bands": []any{map[string]any{"nfc_uid": "0A0B0C0D", "variant_id": variant}}}
	f.fail(f.call("POST", "/api/ticketing/visits", body), 400, "Mode prepaid wajib top-up deposit awal")
	body["deposit"] = map[string]any{"amount": 30000, "method": "cash"}
	visitID := f.visit(body)

	low := f.tap("0A0B0C0D").data()
	eq(t, []any{low["result"], low["reason"]}, []any{"ditolak-saldo-kurang", "Saldo tidak cukup (saldo Rp30.000) — silakan top-up dulu"})
	topup := f.ok(f.call("POST", "/api/ticketing/visits/"+visitID+"/deposit", map[string]any{"amount": 30000, "method": "qris"}))
	eq(t, topup.Body["message"], "Top-up tersimpan")
	eq(t, f.tap("0A0B0C0D").data()["charged_amount"], 50000)

	charge := f.scalar(`SELECT id::text FROM ticketing.ticket_visit_charges WHERE visit_id = $1 AND charge_type = 'tiket'`, visitID)
	f.fail(f.call("POST", "/api/ticketing/visits/"+visitID+"/charges/"+charge+"/void", map[string]any{"reason": "x"}), 400, "Alasan void wajib diisi (min 3 karakter)")
	f.ok(f.call("POST", "/api/ticketing/visits/"+visitID+"/charges/"+charge+"/void", map[string]any{"reason": "salah tap"}))
	f.fail(f.call("POST", "/api/ticketing/visits/"+visitID+"/charges/"+charge+"/void", map[string]any{"reason": "salah tap"}), 409, "Baris ini sudah pernah di-void")
	eq(t, f.scalar(`SELECT description FROM ticketing.ticket_visit_charges WHERE voided_by_charge_id = $1`, charge), "Void: Tiket Kolam — Umum (regular, "+domain.TodayJakarta(time.Now())+") — salah tap")

	vb := f.scalar(`SELECT id::text FROM ticketing.ticket_visit_bands WHERE visit_id = $1`, visitID)
	lost := f.ok(f.call("POST", "/api/ticketing/visits/"+visitID+"/bands/"+vb+"/lost", nil))
	eq(t, lost.data(), map[string]any{"visit_band_id": vb, "nfc_uid": "0A0B0C0D"})
	eq(t, f.scalar(`SELECT status FROM ticketing.ticket_bands WHERE nfc_uid = '0A0B0C0D' AND branch_id = $1`, f.venue.BranchID), "hilang")
	eq(t, f.tap("0A0B0C0D").data()["result"], "ditolak-tanpa-kunjungan")

	// Deposits 60000 against a voided ticket: the whole balance goes back.
	settled := f.ok(f.call("POST", "/api/ticketing/visits/"+visitID+"/settle", map[string]any{"refund_method": "qris"}))
	eq(t, settled.data(), map[string]any{"mode": "rombongan", "paid": 0, "refunded": 60000, "closed": true})
	eq(t, f.scalar(`SELECT description FROM ticketing.ticket_visit_charges WHERE visit_id = $1 AND charge_type = 'refund-deposit'`, visitID), "Refund sisa deposit (qris)")
	eq(t, f.scalar(`SELECT status FROM ticketing.ticket_bands WHERE nfc_uid = '0A0B0C0D' AND branch_id = $1`, f.venue.BranchID), "hilang")
}

func TestDailyCapacityAndOccupancy(t *testing.T) {
	f := newFixture(t)
	_, variant := f.ticket("Kolam", 10000, 10000)
	f.band("11111111", "")
	f.band("22222222", "")
	f.ok(f.call("PUT", "/api/ticketing/settings", map[string]any{"daily_capacity": 1}))
	two := map[string]any{"contact_name": "Rombongan", "payment_mode": "postpaid", "bands": []any{
		map[string]any{"nfc_uid": "11111111", "variant_id": variant}, map[string]any{"nfc_uid": "22222222", "variant_id": variant}}}
	f.fail(f.call("POST", "/api/ticketing/visits", two), 409, "Kuota tanggal ini sudah penuh — pilih tanggal lain")

	today := domain.TodayJakarta(time.Now())
	created := f.ok(f.call("POST", "/api/ticketing/capacity-dates", map[string]any{"label": "Tutup", "start_date": today, "end_date": today, "capacity": 0}))
	f.fail(f.call("POST", "/api/ticketing/visits", two), 409, "Tanggal ini ditutup untuk kunjungan — pilih tanggal lain")
	f.fail(f.call("POST", "/api/ticketing/capacity-dates", map[string]any{"label": "x", "start_date": today, "end_date": "2000-01-01", "capacity": 1}),
		400, "Validation failed")

	id := created.data()["id"].(string)
	f.ok(f.call("PATCH", "/api/ticketing/capacity-dates/"+id, map[string]any{"capacity": 5}))
	f.visit(two)
	occ := f.ok(f.call("GET", "/api/ticketing/occupancy?from="+today+"&to="+today, nil))
	if occ.Raw != `{"success":true,"data":{"days":[{"date":"`+today+`","online":0,"walk_in":2,"capacity":5}]}}` {
		t.Fatal(occ.Raw)
	}
	f.fail(f.call("GET", "/api/ticketing/occupancy?from=2026-01-01&to=2026-06-01", nil), 400, "Rentang maksimum 92 hari")
	f.ok(f.call("DELETE", "/api/ticketing/capacity-dates/"+id, nil))
	f.fail(f.call("DELETE", "/api/ticketing/capacity-dates/"+id, nil), 404, "Override kapasitas tidak ditemukan")

	slot := f.ok(f.call("POST", "/api/ticketing/time-slots", map[string]any{"label": "Pagi", "start_time": "08:00", "end_time": "10:00"}))
	eq(t, []any{slot.data()["start_time"], slot.data()["capacity"], slot.data()["sort_order"]}, []any{"08:00:00", nil, 0})
	f.fail(f.call("PATCH", "/api/ticketing/time-slots/"+slot.data()["id"].(string), map[string]any{"end_time": "07:00"}), 400, "Jam selesai harus setelah jam mulai")
	f.fail(f.call("POST", "/api/ticketing/time-slots", map[string]any{"label": "Pagi", "start_time": "11:00", "end_time": "12:00"}),
		409, "Label slot sudah dipakai — pilih label lain")
}

// booking inserts a website booking of two guests at 50000 each.
func (f *fixture) booking(code, status string, productID, variantID string) string {
	f.t.Helper()
	id := f.scalar(`INSERT INTO ticketing.ticket_bookings
		(company_id, branch_id, booking_code, access_token, visit_date, customer_name, customer_phone, status, total, expires_at)
		VALUES ($1, $2, $3, $4, $5, 'Dewi', '628123', $6, 100000, now() - interval '1 minute') RETURNING id::text`,
		f.venue.CompanyID, f.venue.BranchID, code, testutil.RandomHex(32), domain.TodayJakarta(time.Now()), status)
	item := f.scalar(`INSERT INTO ticketing.ticket_booking_items
		(company_id, branch_id, booking_id, ticket_product_id, variant_id, product_name, variant_name, qty, unit_price, season_kind, subtotal)
		VALUES ($1, $2, $3, $4, $5, 'Kolam', 'Umum', 2, 50000, 'regular', 100000) RETURNING id::text`,
		f.venue.CompanyID, f.venue.BranchID, id, productID, variantID)
	for pos, name := range []string{"Dewi", "Group Dewi - 2"} {
		f.exec(`INSERT INTO ticketing.ticket_booking_guests (company_id, branch_id, booking_id, booking_item_id, variant_id, guest_name, position)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`, f.venue.CompanyID, f.venue.BranchID, id, item, variantID, name, pos+1)
	}
	return id
}

func TestBookingLookupRedeemAndGate(t *testing.T) {
	f := newFixture(t)
	product, variant := f.ticket("Kolam", 50000, 50000)
	id := f.booking("BK-ABCDEF", "terbayar", product, variant)

	f.fail(f.call("GET", "/api/ticketing/bookings/lookup?code=xx", nil), 400, "Kode booking tidak valid (format BK-XXXXXX)")
	f.fail(f.call("GET", "/api/ticketing/bookings/not-a-uuid", nil), 404, "Booking tidak dikenal")
	look := f.ok(f.call("GET", "/api/ticketing/bookings/lookup?code=bk%20abcdef", nil)).data()
	eq(t, []any{look["status"], look["total"], look["redeemable"], look["gift_recipient_name"]}, []any{"terbayar", 100000, true, nil})
	eq(t, look["items"], []any{map[string]any{"variant_id": variant, "ticket_product_id": product, "product_name": "Kolam",
		"variant_name": "Umum", "qty": 2, "unit_price": 50000, "season_kind": "regular", "subtotal": 100000}})
	guests := look["guests"].([]any)
	g1, g2 := guests[0].(map[string]any)["id"].(string), guests[1].(map[string]any)["id"].(string)

	list := f.ok(f.call("GET", "/api/ticketing/bookings?status=terbayar&q=dewi", nil))
	eq(t, list.list()[0].(map[string]any)["total"], 100000)
	detail := f.ok(f.call("GET", "/api/ticketing/bookings/"+id, nil)).data()
	eq(t, detail["guests"], []any{map[string]any{"guest_name": "Dewi", "position": 1, "variant_name": "Umum"},
		map[string]any{"guest_name": "Group Dewi - 2", "position": 2, "variant_name": "Umum"}})

	f.band("AAAA0001", "")
	f.band("AAAA0002", "")
	f.fail(f.call("POST", "/api/ticketing/bookings/"+id+"/redeem", map[string]any{"bands": []any{
		map[string]any{"nfc_uid": "AAAA0001", "guest_id": g1}}}), 400, `Anggota "Group Dewi - 2" belum dapat gelang`)
	f.fail(f.call("POST", "/api/ticketing/bookings/"+id+"/redeem", map[string]any{"bands": []any{}}), 400, "Validation failed")
	redeemed := f.ok(f.call("POST", "/api/ticketing/bookings/"+id+"/redeem", map[string]any{"bands": []any{
		map[string]any{"nfc_uid": "AAAA0001", "guest_id": g1}, map[string]any{"nfc_uid": "aaaa0002", "guest_id": g2}}}))
	eq(t, redeemed.Body["message"], "Booking BK-ABCDEF di-redeem — gelang siap dipakai")
	visitID := redeemed.data()["visit_id"].(string)
	visit := f.ok(f.call("GET", "/api/ticketing/visits/"+visitID, nil)).data()
	eq(t, visit["summary"], map[string]any{"debit": 100000, "kredit": 100000, "outstanding": 0, "saldo": 0})
	eq(t, f.scalar(`SELECT vb.guest_name FROM ticketing.ticket_visit_bands vb JOIN ticketing.ticket_bands b ON b.id = vb.band_id
		WHERE vb.visit_id = $1 AND b.nfc_uid = 'AAAA0002'`, visitID), "Group Dewi - 2")

	f.fail(f.call("POST", "/api/ticketing/bookings/"+id+"/redeem", map[string]any{"bands": []any{
		map[string]any{"nfc_uid": "AAAA0001", "guest_id": g1}}}), 409, "Booking BK-ABCDEF SUDAH dipakai — tidak bisa dua kali")

	entered := f.tap("AAAA0002")
	if entered.Raw != `{"success":true,"data":{"result":"masuk","ok":true,"contact_name":"Dewi","ticket_type_name":"Kolam — Umum","guest_name":"Group Dewi - 2","band_label":null,"charged_amount":0}}` {
		t.Fatal(entered.Raw)
	}
	eq(t, f.scalar(`SELECT count(*)::text FROM ticketing.ticket_visit_charges WHERE visit_id = $1`, visitID), "3")
}

func TestBookingCancelExpiryAndResend(t *testing.T) {
	f := newFixture(t)
	product, variant := f.ticket("Kolam", 50000, 50000)
	bus := outbox.NewBus(nil, discard)
	var released []contract.BookingReleased
	capture := func(_ context.Context, _ pgx.Tx, e outbox.Event) error {
		var p contract.BookingReleased
		if err := e.Decode(&p); err != nil {
			return err
		}
		released = append(released, p)
		return nil
	}
	bus.Subscribe(contract.TopicBookingCancelled, "ticketing.test-cancelled", capture)
	bus.Subscribe(contract.TopicBookingExpired, "ticketing.test-expired", capture)
	if err := bus.Register(f.ctx, f.tx); err != nil {
		t.Fatal(err)
	}

	paid := f.booking("BK-PQRSTU", "terbayar", product, variant)
	f.fail(f.call("POST", "/api/ticketing/bookings/"+paid+"/cancel", map[string]any{"refund_note": "  "}),
		400, "Booking sudah terbayar — wajib isi catatan refund (uang dikembalikan di luar sistem)")
	f.wa.err = ErrMessengerNotConfigured
	f.fail(f.call("POST", "/api/ticketing/bookings/"+paid+"/resend-wa", nil), 502, "WA gateway belum dikonfigurasi — cek Settings → WhatsApp Gateway")
	f.wa.err = errors.New("timeout")
	f.fail(f.call("POST", "/api/ticketing/bookings/"+paid+"/resend-wa", nil), 502, "Gagal mengirim WA — cek koneksi gateway")
	f.wa.err = nil
	resent := f.ok(f.call("POST", "/api/ticketing/bookings/"+paid+"/resend-wa", nil))
	if resent.Raw != `{"success":true,"data":{"booking_code":"BK-PQRSTU"},"message":"WA terkirim ulang ke 628123"}` {
		t.Fatal(resent.Raw)
	}
	last := f.wa.sent[len(f.wa.sent)-1]
	if !strings.HasPrefix(last, "628123|*Pembayaran diterima*") || !strings.Contains(last, "https://tiket.example/booking/status/") {
		t.Fatal(last)
	}

	cancelled := f.ok(f.call("POST", "/api/ticketing/bookings/"+paid+"/cancel", map[string]any{"refund_note": " transfer BCA "}))
	if cancelled.Raw != `{"success":true,"data":{"id":"`+paid+`"},"message":"Booking BK-PQRSTU dibatalkan"}` {
		t.Fatal(cancelled.Raw)
	}
	eq(t, f.scalar(`SELECT status || '|' || refund_note FROM ticketing.ticket_bookings WHERE id = $1`, paid), "dibatalkan|transfer BCA")
	f.fail(f.call("POST", "/api/ticketing/bookings/"+paid+"/cancel", map[string]any{}), 409, "Booking BK-PQRSTU tidak bisa dibatalkan dari status sekarang")

	unpaid := f.booking("BK-WXYZ23", "menunggu-bayar", product, variant)
	look := f.ok(f.call("GET", "/api/ticketing/bookings/lookup?code=BK-WXYZ23", nil)).data()
	eq(t, []any{look["status"], look["redeemable"]}, []any{"kedaluwarsa", false})

	note := f.ok(f.call("PATCH", "/api/ticketing/bookings/"+unpaid, map[string]any{"clear_webhook_alert": true}))
	eq(t, note.Body["message"], "Alert ditandai selesai")
	f.fail(f.call("PATCH", "/api/ticketing/bookings/"+unpaid, map[string]any{}), 400, "Catatan refund wajib diisi (maks 500 karakter)")

	if _, err := bus.Dispatch(f.ctx, f.tx); err != nil {
		t.Fatal(err)
	}
	eq(t, released, []contract.BookingReleased{
		{BookingID: paid, BookingCode: "BK-PQRSTU", CompanyID: f.venue.CompanyID, BranchID: f.venue.BranchID, PromoContextType: "ticket_booking"},
		{BookingID: unpaid, BookingCode: "BK-WXYZ23", CompanyID: f.venue.CompanyID, BranchID: f.venue.BranchID, PromoContextType: "ticket_booking"},
	})
}

func TestSeasonPassIssueTapAndRenew(t *testing.T) {
	f := newFixture(t)
	created := f.ok(f.call("POST", "/api/ticketing/products", map[string]any{
		"name": "Pass Tahunan", "product_kind": "season_pass", "status": "active", "base_price": 250000, "validity_months": 6}))
	productID := created.data()["id"].(string)
	f.fail(f.call("POST", "/api/ticketing/products", map[string]any{"name": "Punch", "product_kind": "season_pass", "entry_policy": "limited_visits"}),
		400, "Kuota kunjungan wajib diisi untuk pass jenis punch-card (jatah kunjungan)")

	options := f.ok(f.call("GET", "/api/ticketing/season-passes/pass-options", nil)).list()
	eq(t, options, []any{map[string]any{"ticket_product_id": productID, "name": "Pass Tahunan", "validity_months": 6,
		"entry_policy": "once_per_day", "visit_quota": nil, "unit_price": 250000}})

	today := domain.TodayJakarta(time.Now())
	issued := f.ok(f.call("POST", "/api/ticketing/season-passes", map[string]any{"ticket_product_id": productID, "holder_name": " Budi "}))
	pass := issued.data()
	code := domain.PassCodePrefix(today) + "-0001"
	eq(t, []any{pass["pass_code"], pass["holder_name"], pass["valid_from"], pass["valid_until"], pass["unit_price"], issued.Body["message"]},
		[]any{code, "Budi", today, domain.AddMonthsISO(today, 6), 250000, "Pass " + code + " diterbitkan"})

	granted := f.ok(f.call("POST", "/api/ticketing/gate/pass-tap", map[string]any{"code": strings.ToLower(code)}))
	if granted.Raw != `{"success":true,"data":{"ok":true,"result":"granted","holder_name":"Budi","pass_code":"`+code+
		`","ticket_type_name":"Pass Tahunan","valid_until":"`+domain.AddMonthsISO(today, 6)+`","entry_policy":"once_per_day"}}` {
		t.Fatal(granted.Raw)
	}
	dup := f.ok(f.call("POST", "/api/ticketing/gate/pass-tap", map[string]any{"code": pass["access_token"]})).data()
	eq(t, []any{dup["result"], dup["reason"]}, []any{"denied_duplicate", "Pass sudah dipakai masuk hari ini"})
	eq(t, f.ok(f.call("POST", "/api/ticketing/gate/pass-tap", map[string]any{"code": "??"})).data(),
		map[string]any{"ok": false, "result": "bukan-pass", "reason": "Kode tidak dikenal sebagai Season Pass"})

	renewed := f.ok(f.call("POST", "/api/ticketing/season-passes/"+pass["id"].(string)+"/renew", nil))
	until := domain.AddMonthsISO(domain.AddMonthsISO(today, 6), 6)
	eq(t, renewed.data(), map[string]any{"id": pass["id"], "valid_until": until, "quota_reset": false})
	eq(t, renewed.Body["message"], "Pass diperpanjang s/d "+domain.FormatDate(until))
	listed := f.ok(f.call("GET", "/api/ticketing/season-passes?q=budi", nil)).list()[0].(map[string]any)
	eq(t, []any{listed["valid_until"], listed["unit_price"]}, []any{until + "T00:00:00.000Z", 250000})
}

func TestStaffPassPairingAndGate(t *testing.T) {
	f := newFixture(t)
	employee := f.scalar(`INSERT INTO hris.employees (full_name, nip, email, phone, join_date)
		VALUES ('Joko Satpam', $1, $2, '0811', current_date) RETURNING id::text`, "GT"+testutil.RandomHex(4), testutil.RandomHex(4)+"@test.local")
	f.band("CAFEBABE", "Satpam")
	paired := f.ok(f.call("POST", "/api/ticketing/staff-passes", map[string]any{"nfc_uid": "cafebabe", "employee_id": employee}))
	eq(t, paired.Body["message"], "Gelang dipasangkan ke Joko Satpam")
	f.fail(f.call("PATCH", "/api/ticketing/bands/"+f.scalar(`SELECT id::text FROM ticketing.ticket_bands WHERE nfc_uid = 'CAFEBABE' AND branch_id = $1`, f.venue.BranchID),
		map[string]any{"label": "x"}), 404, "Gelang tidak ditemukan, sedang dipakai kunjungan aktif, atau dipegang karyawan (cabut pairing dulu)")

	entered := f.tap("CAFEBABE")
	if entered.Raw != `{"success":true,"data":{"result":"masuk-karyawan","ok":true,"contact_name":"Joko Satpam","ticket_type_name":"Akses Karyawan","band_label":"Satpam","charged_amount":0}}` {
		t.Fatal(entered.Raw)
	}
	listed := f.ok(f.call("GET", "/api/ticketing/staff-passes?q=joko", nil)).list()
	eq(t, len(listed), 1)
	eq(t, len(f.ok(f.call("GET", "/api/ticketing/staff-passes?q=nobody", nil)).list()), 0)
	eq(t, len(f.ok(f.call("GET", "/api/ticketing/staff-passes?q=cafe", nil)).list()), 1)

	f.exec(`UPDATE hris.employees SET is_active = false WHERE id = $1`, employee)
	eq(t, f.tap("CAFEBABE").data()["result"], "ditolak-karyawan-nonaktif")

	passID := paired.data()["id"].(string)
	f.ok(f.call("DELETE", "/api/ticketing/staff-passes/"+passID, nil))
	f.fail(f.call("DELETE", "/api/ticketing/staff-passes/"+passID, nil), 404, "Pairing tidak ditemukan / sudah dicabut")
	eq(t, f.scalar(`SELECT status FROM ticketing.ticket_bands WHERE nfc_uid = 'CAFEBABE' AND branch_id = $1`, f.venue.BranchID), "tersedia")
}

func TestBundleRegistrationAllocatesPrices(t *testing.T) {
	f := newFixture(t)
	_, adult := f.ticket("Kolam", 60000, 60000)
	created := f.ok(f.call("POST", "/api/ticketing/products", map[string]any{"name": "Paket Keluarga", "product_kind": "bundle"}))
	bundle := created.data()["id"].(string)
	f.fail(f.call("PATCH", "/api/ticketing/products/"+bundle, map[string]any{"status": "active"}), 400, "Paket belum bisa diaktifkan: Komposisi paket masih kosong")
	f.ok(f.call("PUT", "/api/ticketing/products/"+bundle+"/bundle-items", map[string]any{"items": []any{map[string]any{"component_variant_id": adult, "qty": 2}}}))
	paket := f.scalar(`SELECT id::text FROM ticketing.ticket_product_variants WHERE ticket_product_id = $1`, bundle)
	f.ok(f.call("PATCH", "/api/ticketing/products/"+bundle, map[string]any{"status": "active",
		"variants": []any{map[string]any{"id": paket, "price_regular": 100000, "price_high": 100000}}}))
	f.ok(f.call("PATCH", "/api/ticketing/products/"+bundle+"/channels", map[string]any{"channel_id": f.walkIn, "is_distributed": true}))

	opts := f.ok(f.call("GET", "/api/ticketing/products/loket-options", nil)).list()
	var found map[string]any
	for _, o := range opts {
		if o.(map[string]any)["product_kind"] == "bundle" {
			found = o.(map[string]any)
		}
	}
	eq(t, []any{found["members_per_unit"], found["members"]}, []any{2, []any{map[string]any{"component_variant_id": adult, "qty": 2, "label": "Kolam — Umum"}}})

	f.band("B0000001", "")
	f.band("B0000002", "")
	f.fail(f.call("POST", "/api/ticketing/visits", map[string]any{"contact_name": "Keluarga", "payment_mode": "postpaid",
		"bundles": []any{map[string]any{"bundle_variant_id": paket, "band_uids": []any{"B0000001"}}}}),
		400, `Paket "Paket Keluarga" butuh 2 gelang per unit — di-tap 1`)
	visitID := f.visit(map[string]any{"contact_name": "Keluarga", "payment_mode": "postpaid",
		"bundles": []any{map[string]any{"bundle_variant_id": paket, "band_uids": []any{"B0000001", "B0000002"}}}})
	eq(t, f.scalar(`SELECT string_agg(allocated_price::text || ':' || member_label, ',' ORDER BY allocated_price)
		FROM ticketing.ticket_visit_bands WHERE visit_id = $1`, visitID), "50000.00:Paket Keluarga — Kolam — Umum,50000.00:Paket Keluarga — Kolam — Umum")
	tap := f.tap("B0000001").data()
	eq(t, []any{tap["result"], tap["charged_amount"]}, []any{"masuk", 50000})
	eq(t, f.scalar(`SELECT description FROM ticketing.ticket_visit_charges WHERE visit_id = $1`, visitID),
		"Tiket Paket Keluarga — Kolam — Umum (alokasi paket, "+domain.TodayJakarta(time.Now())+")")
}

func TestCalendarMarksAndReport(t *testing.T) {
	f := newFixture(t)
	product, variant := f.ticket("Kolam", 10000, 20000)
	bulk := f.ok(f.call("POST", "/api/ticketing/products/"+product+"/dates/bulk", map[string]any{
		"date_kind": "high-season", "add": []any{"2030-01-01", "2030-01-02", "2030-01-03"}}))
	if bulk.Raw != `{"success":true,"data":{"added":3,"removed":0},"message":"Kalender tersimpan"}` {
		t.Fatal(bulk.Raw)
	}
	f.ok(f.call("POST", "/api/ticketing/products/"+product+"/dates", map[string]any{"date_kind": "high-season", "label": "Libur", "start_date": "2030-02-01", "end_date": "2030-02-05"}))
	f.ok(f.call("POST", "/api/ticketing/products/"+product+"/dates/bulk", map[string]any{"date_kind": "high-season", "remove": []any{"2030-02-03", "2030-01-02"}}))
	eq(t, f.scalar(`SELECT string_agg(start_date::text || '..' || end_date::text, ',' ORDER BY start_date) FROM ticketing.ticket_product_dates WHERE ticket_product_id = $1`, product),
		"2030-01-01..2030-01-01,2030-01-03..2030-01-03,2030-02-01..2030-02-02,2030-02-04..2030-02-05")
	f.fail(f.call("POST", "/api/ticketing/products/"+product+"/dates/bulk", map[string]any{"date_kind": "high-season", "add": []any{"2030-02-30"}}), 400, "Ada tanggal yang tidak valid")
	empty := f.ok(f.call("POST", "/api/ticketing/products/"+product+"/dates/bulk", map[string]any{"date_kind": "blok-online"}))
	if empty.Raw != `{"success":true,"data":{"added":0,"removed":0}}` {
		t.Fatal(empty.Raw)
	}

	f.band("CCCC0001", "")
	f.visit(map[string]any{"contact_name": "Lapor", "payment_mode": "postpaid", "bands": []any{map[string]any{"nfc_uid": "CCCC0001", "variant_id": variant}}})
	f.tap("CCCC0001")
	report := f.ok(f.call("GET", "/api/ticketing/reports", nil)).data()
	summary := report["summary"].(map[string]any)
	eq(t, []any{summary["visits_opened"], summary["orang_masuk"], summary["tiket_net"]}, []any{1, 1, 10000})
	eq(t, len(report["daily"].([]any)), 7)
	eq(t, report["tickets"].(map[string]any)["products"], []any{map[string]any{"label": "Kolam — Umum", "qty": 1, "net": 10000}})
	hanging := report["hanging"].(map[string]any)
	eq(t, []any{hanging["count"], hanging["total"]}, []any{1, 10000})
	f.fail(f.call("GET", "/api/ticketing/reports?from=2026-10-05&to=2026-10-01", nil), 400, "Rentang tanggal tidak valid")
}

func TestValidationAndErrors(t *testing.T) {
	f := newFixture(t)
	missing := f.call("POST", "/api/ticketing/gate/tap", map[string]any{})
	if missing.Raw != `{"success":false,"error":"Validation failed","details":[{"code":"invalid_type","path":["nfc_uid"],"message":"Invalid input: expected string, received undefined"}]}` {
		t.Fatal(missing.Raw)
	}
	f.fail(f.call("POST", "/api/ticketing/gate/tap", "{"), 500, "Terjadi kesalahan server")
	f.fail(f.call("POST", "/api/ticketing/gate/tap", map[string]any{"nfc_uid": "zz"}), 400, "UID gelang tidak valid")
	f.fail(f.call("GET", "/api/ticketing/visits/"+f.venue.BranchID, nil), 404, "Kunjungan tidak ditemukan")
	f.fail(f.call("POST", "/api/ticketing/visits", map[string]any{"contact_name": "X", "payment_mode": "postpaid"}), 400, "Minimal satu gelang harus di-tap")
	f.fail(f.call("PATCH", "/api/ticketing/channels/"+f.venue.BranchID, map[string]any{"name": "X"}), 404, "Kanal tidak ditemukan")
	f.fail(f.call("PATCH", "/api/ticketing/bands/"+f.venue.BranchID, map[string]any{"status": "dipakai"}), 400, "Status 'dipakai' diatur otomatis oleh registrasi kunjungan")

	req := httptest.NewRequest("GET", "/api/ticketing/settings", nil)
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("anonymous: %d %s", rec.Code, rec.Body.String())
	}
	for i := 0; i < 60; i++ {
		f.call("GET", "/api/ticketing/bookings/lookup?code=BK-AAAAAA", nil)
	}
	f.fail(f.call("GET", "/api/ticketing/bookings/lookup?code=BK-AAAAAA", nil), 429, "Terlalu banyak pencarian — tunggu sebentar")
	// Last: a PostgreSQL error aborts the shared test transaction.
	f.fail(f.call("GET", "/api/ticketing/visits/not-a-uuid", nil), 400, "Format data tidak valid")
}

// TestAuthWiring runs the real guard: no session is 401, a session without
// a ticketing menu is 403, a granted menu reaches the venue resolution.
func TestAuthWiring(t *testing.T) {
	deps := testutil.Deps(t, nil)
	m := New(deps, Ports{Venues: fixedVenue{}, Employees: sqlEmployees{}, Messenger: &fakeMessenger{}})
	mux := testutil.Mux(m)
	_, body := testutil.Do(t, mux, testutil.Request("GET", "/api/ticketing/settings", nil))
	eq(t, body, map[string]any{"success": false, "error": "Authentication required"})
	stranger := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos.kasir": nil}})
	rec, body := testutil.Do(t, mux, testutil.AsStaff(testutil.Request("GET", "/api/ticketing/settings", nil), stranger))
	eq(t, []any{rec.Code, body["error"]}, []any{403, "Insufficient permissions"})
	loket := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"ticketing.loket": nil}})
	rec, body = testutil.Do(t, mux, testutil.AsStaff(testutil.Request("GET", "/api/ticketing/settings", nil), loket))
	eq(t, []any{rec.Code, body["error"]}, []any{403, "Insufficient permissions"})
	rec, body = testutil.Do(t, mux, testutil.AsStaff(testutil.Request("GET", "/api/ticketing/tab/stats", nil), loket))
	eq(t, []any{rec.Code, body["error"]}, []any{400, venueNotConfigured})
}

// TestRedeemPromoBookingWritesDiscountLine proves the delta
// 20261004224000_ticketing_charge_type_diskon: the promo migration widened
// chk_charge_direction for 'diskon' but not the column CHECK on
// charge_type, so redeeming any promo booking failed (TS too) with 400
// "Data tidak memenuhi ketentuan".
func TestRedeemPromoBookingWritesDiscountLine(t *testing.T) {
	f := newFixture(t)
	product, variant := f.ticket("Kolam", 50000, 50000)
	id := f.booking("BK-HJKMNP", "terbayar", product, variant)
	f.exec(`UPDATE ticketing.ticket_bookings SET discount_amount = 20000, promo_code = 'HEMAT' WHERE id = $1`, id)
	guests := f.ok(f.call("GET", "/api/ticketing/bookings/lookup?code=BK-HJKMNP", nil)).data()["guests"].([]any)
	f.band("EEEE0001", "")
	f.band("EEEE0002", "")
	redeemed := f.ok(f.call("POST", "/api/ticketing/bookings/"+id+"/redeem", map[string]any{"bands": []any{
		map[string]any{"nfc_uid": "EEEE0001", "guest_id": guests[0].(map[string]any)["id"]},
		map[string]any{"nfc_uid": "EEEE0002", "guest_id": guests[1].(map[string]any)["id"]}}}))
	visitID := redeemed.data()["visit_id"].(string)
	eq(t, f.scalar(`SELECT string_agg(charge_type || ':' || amount::text, ',' ORDER BY charge_type) FROM ticketing.ticket_visit_charges
		WHERE visit_id = $1 AND direction = 'kredit'`, visitID), "diskon:20000.00,pembayaran:80000.00")
	eq(t, f.ok(f.call("GET", "/api/ticketing/visits/"+visitID, nil)).data()["summary"],
		map[string]any{"debit": 100000, "kredit": 100000, "outstanding": 0, "saldo": 0})
}
