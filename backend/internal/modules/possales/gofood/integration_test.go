package gofood

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

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/gofood/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Every write runs in one rolled-back transaction; GoBiz is an httptest
// server. TestAuthWiring covers the real guard and settings adapter.

type headerGuard struct{}

func (headerGuard) RequireMenuPrefix(r *http.Request, _ ...string) (*auth.User, error) {
	if r.Header.Get("X-Test-Staff") == "" {
		return nil, httpx.Unauthorized("")
	}
	return &auth.User{ID: "kasir-1"}, nil
}

type staticConfig struct{ cfg *domain.Config }

func (s staticConfig) LoadConfig(context.Context, database.Querier) (domain.Config, error) {
	return *s.cfg, nil
}

type routes []module.Route

func (r routes) Name() string           { return "gofood-test" }
func (r routes) Routes() []module.Route { return r }

type fixture struct {
	t       *testing.T
	ctx     context.Context
	tx      pgx.Tx
	gobiz   *fakeGobiz
	cfg     *domain.Config
	h       *Handler
	mux     *http.ServeMux
	sku     string
	product string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	gobiz := newFakeGobiz(t)
	cfg := gobiz.config()
	f := &fixture{t: t, ctx: context.Background(), tx: tx, gobiz: gobiz, cfg: &cfg}
	f.h = NewHandler(tx, headerGuard{}, Ports{Config: staticConfig{f.cfg}, Venues: CrmVenueSQL{}}, NewClient(nil, nil), nil,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	f.mux = testutil.Mux(routes(f.h.Routes()))
	f.sku = "GF-" + testutil.RandomHex(4)
	f.product = f.scalar(`INSERT INTO pos.pos_products (sku, name, base_price, station) VALUES ($1, 'Kopi GoFood', 20000, 'bar') RETURNING id::text`, f.sku)
	return f
}

type response struct {
	Status int
	Body   map[string]any
	Raw    string
}

func (r response) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }

func (f *fixture) do(method, target string, body any) response {
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
	req.Header.Set("X-Test-Staff", "1")
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
	return out
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

// order inserts a gofood_orders row with one mapped line (2 × 25000) and
// returns its id.
func (f *fixture) order(status string, total int, mapped bool) string {
	f.t.Helper()
	items := "[]"
	if mapped {
		items = `[{"product_id":"` + f.product + `","product_name":"Kopi GoFood","product_sku":"` + f.sku + `","quantity":2,"unit_price":25000,
			"variant_name":"Large","modifiers":[{"name":"Extra shot","group":"Add-on","price":5000}],"notes":"less ice","station":"bar"}]`
	}
	return f.scalar(`INSERT INTO pos.gofood_orders (gofood_order_id, gofood_order_type, status, order_total, customer_name, pin,
		cutlery_requested, items, unmapped_items) VALUES ($1, 'delivery', $2, $3, 'Budi', '1234', true, $4::jsonb,
		'[{"name":"Mystery","quantity":1,"price":1000,"reason":"no_external_id"}]'::jsonb) RETURNING id::text`,
		"F-"+testutil.RandomHex(4), status, total, items)
}

func expectError(t *testing.T, res response, status int, msg string) {
	t.Helper()
	if res.Status != status || res.Body["success"] != false || res.Body["error"] != msg {
		t.Fatalf("want %d %q, got %d %s", status, msg, res.Status, res.Raw)
	}
}

func TestListOrders(t *testing.T) {
	f := newFixture(t)
	active := f.order("awaiting_acceptance", 55000, true)
	done := f.order("completed", 10000, false)

	res := f.do("GET", "/api/pos/gofood/orders", nil)
	if res.Status != 200 {
		t.Fatalf("list: %s", res.Raw)
	}
	var ids []string
	var row map[string]any
	for _, r := range res.Body["data"].([]any) {
		m := r.(map[string]any)
		ids = append(ids, m["id"].(string))
		if m["id"] == active {
			row = m
		}
	}
	if row == nil || strings.Contains(strings.Join(ids, ","), done) {
		t.Fatalf("active filter: %v", ids)
	}
	if row["order_total"] != float64(55000) || row["takeaway_charges"] != float64(0) || row["pos_order_number"] != nil ||
		row["pos_status"] != nil || row["cutlery_requested"] != true || !jsDate.MatchString(row["created_at"].(string)) {
		t.Fatalf("row shape: %v", row)
	}
	if !strings.HasPrefix(res.Raw, `{"success":true,"data":[{"id":`) || !strings.Contains(res.Raw, `"order_total":55000,"currency":"IDR"`) {
		t.Fatalf("column order follows g.*: %s", res.Raw)
	}
	meta := res.Body["meta"].(map[string]any)
	if meta["configured"] != true || meta["enabled"] != true || meta["auto_accept"] != false || meta["environment"] != "sandbox" {
		t.Fatalf("meta: %v", meta)
	}

	res = f.do("GET", "/api/pos/gofood/orders?status=completed&limit=1", nil)
	if list := res.Body["data"].([]any); len(list) != 1 || list[0].(map[string]any)["status"] != "completed" {
		t.Fatalf("status filter: %s", res.Raw)
	}
	expectError(t, f.do("GET", "/api/pos/gofood/orders?limit=abc", nil), 500, `invalid input syntax for type bigint: "NaN"`)
}

func TestActionValidation(t *testing.T) {
	f := newFixture(t)
	id := f.order("awaiting_acceptance", 0, true)
	for _, body := range []any{"{oops", map[string]any{}, map[string]any{"action": "explode"}, []any{"accept"},
		map[string]any{"action": "reject", "reason_code": "OTHERS", "reason_description": "  ab  "},
		map[string]any{"action": "reject", "reason_code": "BORED", "reason_description": "Toko tutup"}} {
		expectError(t, f.do("POST", "/api/pos/gofood/orders/"+id, body), 400, "Aksi tidak valid")
	}
	f.cfg.OutletID = ""
	expectError(t, f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "accept"}), 400, ErrNotConfigured.Error())
	f.cfg.OutletID = "G123"
	expectError(t, f.do("POST", "/api/pos/gofood/orders/00000000-0000-0000-0000-00000000dead", map[string]any{"action": "ready"}), 400,
		"Order GoFood tidak ditemukan")
	expectError(t, f.do("POST", "/api/pos/gofood/orders/not-a-uuid", map[string]any{"action": "accept"}), 400,
		`invalid input syntax for type uuid: "not-a-uuid"`)
}

func TestAcceptReadyReject(t *testing.T) {
	f := newFixture(t)
	id := f.order("awaiting_acceptance", 55000, true)
	gofoodID := f.scalar(`SELECT gofood_order_id FROM pos.gofood_orders WHERE id = $1`, id)

	res := f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "accept"})
	data := res.data()
	if res.Status != 200 || data["status"] != "accepted" || data["accepted_at"] == nil || data["pos_order_number"] != nil {
		t.Fatalf("accept: %s", res.Raw)
	}
	posOrderID, _ := data["pos_order_id"].(string)
	if posOrderID == "" || f.gobiz.last().Path != "/integrations/gofood/outlets/G123/v1/orders/delivery/"+gofoodID+"/accepted" {
		t.Fatalf("accept should call GoBiz and link a POS order: %s", res.Raw)
	}
	got := f.scalar(`SELECT concat_ws('|', order_type, status, payment_status, subtotal, other_charges_amount, total_amount, amount_paid,
		payment_method_code, payment_method_name, cashier_id, charges_breakdown->0->>'amount', special_requests, notes)
		FROM pos.pos_orders WHERE id = $1`, posOrderID)
	want := "delivery|confirmed|paid|50000.00|5000.00|55000.00|55000.00|gofood|GoFood|" + fallbackCashierID + "|5000|GoFood " + gofoodID +
		"; type=delivery|GoFood " + gofoodID + " · Delivery · PIN 1234 · Pelanggan: Budi · Minta alat makan · 1 item TIDAK terpetakan — cek halaman GoFood"
	if got != want {
		t.Fatalf("pos order:\n got %s\nwant %s", got, want)
	}
	items := f.scalar(`SELECT concat_ws('|', product_id, quantity, unit_price, total_amount, variants, modifiers->0->>'name', kitchen_notes, station, kitchen_status)
		FROM pos.pos_order_items WHERE order_id = $1`, posOrderID)
	if items != f.product+`|2.00|25000.00|50000.00|[{"name": "Large"}]|Extra shot|GoFood `+gofoodID+` · less ice|bar|pending` {
		t.Fatalf("items: %s", items)
	}
	if h := f.scalar(`SELECT concat_ws('|', to_status, notes) FROM pos.pos_order_status_history WHERE order_id = $1`, posOrderID); h != "confirmed|Created from GoFood "+gofoodID {
		t.Fatalf("history: %s", h)
	}

	expectError(t, f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "accept"}), 400, "Order sudah berstatus accepted")

	// create_pos_order is idempotent and returns the joined POS fields.
	res = f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "create_pos_order"})
	if res.data()["pos_order_id"] != posOrderID || res.data()["pos_status"] != "confirmed" || res.data()["pos_order_number"] == nil {
		t.Fatalf("create_pos_order: %s", res.Raw)
	}

	calls := len(f.gobiz.requests)
	res = f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "ready"})
	if res.Status != 200 || res.data()["food_ready_at"] == nil || !strings.HasSuffix(f.gobiz.last().Path, "/food-prepared") {
		t.Fatalf("ready: %s", res.Raw)
	}
	if res = f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "ready"}); res.Status != 200 || len(f.gobiz.requests) != calls+1 {
		t.Fatalf("second ready must not call GoBiz: %s", res.Raw)
	}

	res = f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "reject", "reason_code": "ITEMS_OUT_OF_STOCK", "reason_description": "  Stok habis "})
	if res.Status != 200 || res.data()["status"] != "rejected" || res.data()["cancel_reason"] != "ITEMS_OUT_OF_STOCK: Stok habis" ||
		res.data()["pos_status"] != "cancelled" {
		t.Fatalf("reject: %s", res.Raw)
	}
	if f.gobiz.last().Body != `{"cancel_reason_code":"ITEMS_OUT_OF_STOCK","cancel_reason_description":"Stok habis"}` {
		t.Fatalf("reject body: %s", f.gobiz.last().Body)
	}
	if got := f.scalar(`SELECT concat_ws('|', o.cancelled_at IS NOT NULL, i.kitchen_status, h.from_status, h.notes)
		FROM pos.pos_orders o JOIN pos.pos_order_items i ON i.order_id = o.id
		JOIN pos.pos_order_status_history h ON h.order_id = o.id AND h.to_status = 'cancelled' WHERE o.id = $1`, posOrderID); got != "t|cancelled|confirmed|GoFood "+gofoodID+" ditolak: Stok habis" {
		t.Fatalf("pos order cancel: %s", got)
	}
	expectError(t, f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "reject", "reason_code": "OTHERS", "reason_description": "lagi"}), 400,
		"Order sudah berstatus rejected")
}

func TestGobizErrorAndUnmappedOrder(t *testing.T) {
	f := newFixture(t)
	id := f.order("created", 0, false)
	f.gobiz.api = func(*http.Request, string) (int, string) { return 409, `{"message":"Order expired","code":"E1"}` }
	res := f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "accept"})
	if res.Status != 502 || res.Raw != `{"success":false,"error":"GoBiz: Order expired","detail":{"message":"Order expired","code":"E1"}}` {
		t.Fatalf("GoBiz error: %d %s", res.Status, res.Raw)
	}
	if f.scalar(`SELECT status FROM pos.gofood_orders WHERE id = $1`, id) != "created" {
		t.Fatal("a failed accept must not change the order")
	}

	f.gobiz.api = func(*http.Request, string) (int, string) { return 200, `{"success":true}` }
	res = f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "accept"})
	if res.Status != 200 || res.data()["status"] != "accepted" || res.data()["pos_order_id"] != nil {
		t.Fatalf("no mapped items → no POS order: %s", res.Raw)
	}
	expectError(t, f.do("POST", "/api/pos/gofood/orders/00000000-0000-0000-0000-00000000dead", map[string]any{"action": "create_pos_order"}), 404,
		"Order tidak ditemukan")
}

func TestNotifyFoodReadyForPosOrder(t *testing.T) {
	f := newFixture(t)
	id := f.order("awaiting_acceptance", 0, true)
	posOrderID := f.do("POST", "/api/pos/gofood/orders/"+id, map[string]any{"action": "accept"}).data()["pos_order_id"].(string)

	f.gobiz.api = func(*http.Request, string) (int, string) { return 500, `{"message":"down"}` }
	f.h.NotifyFoodReadyForPosOrder(f.ctx, posOrderID)
	if got := f.scalar(`SELECT concat_ws('|', last_error, food_ready_at IS NULL) FROM pos.gofood_orders WHERE id = $1`, id); got != "500 down|t" {
		t.Fatalf("failure goes to last_error: %s", got)
	}

	f.gobiz.api = func(*http.Request, string) (int, string) { return 200, `{"success":true}` }
	f.h.NotifyFoodReadyForPosOrder(f.ctx, posOrderID)
	if got := f.scalar(`SELECT concat_ws('|', coalesce(last_error, '-'), food_ready_at IS NULL) FROM pos.gofood_orders WHERE id = $1`, id); got != "-|f" {
		t.Fatalf("food ready: %s", got)
	}
	calls := len(f.gobiz.requests)
	f.h.NotifyFoodReadyForPosOrder(f.ctx, posOrderID)
	f.h.NotifyFoodReadyForPosOrder(f.ctx, "00000000-0000-0000-0000-00000000dead")
	if len(f.gobiz.requests) != calls {
		t.Fatal("already ready or unknown orders must not call GoBiz")
	}
}

func TestAuthWiring(t *testing.T) {
	deps := testutil.Deps(t, nil)
	mux := testutil.Mux(routes(New(deps).Routes()))
	if rec, _ := testutil.Do(t, mux, testutil.Request("GET", "/api/pos/gofood/orders", nil)); rec.Code != 401 {
		t.Fatalf("no session: %d", rec.Code)
	}
	plain := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm.members": nil}})
	if rec, body := testutil.Do(t, mux, testutil.AsStaff(testutil.Request("GET", "/api/pos/gofood/orders", nil), plain)); rec.Code != 403 || body["error"] != "Insufficient permissions" {
		t.Fatalf("no POS grant: %d %v", rec.Code, body)
	}
	kasir := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos.operations": nil}})
	rec, body := testutil.Do(t, mux, testutil.AsStaff(testutil.Request("GET", "/api/pos/gofood/orders", nil), kasir))
	if rec.Code != 200 || body["meta"] == nil {
		t.Fatalf("with grant: %d %s", rec.Code, rec.Body.String())
	}
}

var jsDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`)
