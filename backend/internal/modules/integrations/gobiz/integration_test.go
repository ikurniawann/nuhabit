package gobiz

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

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/integrations/gobiz/domain"
	"nuhabit/backend/internal/modules/integrations/internal/appsettings"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	gobizapi "nuhabit/backend/internal/platform/gobiz"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Settings, gofood_events and gofood_catalog_syncs live in one rolled-back
// transaction; GoBiz is an httptest server and the pos-sales/pos-ops ports
// are in-memory fakes. internal/app tests the real adapters.

type headerGuard struct{}

func (headerGuard) RequireMenuPrefix(r *http.Request, _ ...string) (*auth.User, error) {
	if r.Header.Get("X-Test-Staff") == "" {
		return nil, httpx.Unauthorized("")
	}
	return &auth.User{ID: "staff-1"}, nil
}

type fakeCatalog struct {
	products  []domain.CatalogProduct
	rule      *domain.ChannelRule
	overrides map[string]float64
}

func (c *fakeCatalog) GofoodProducts(context.Context, database.Querier) ([]domain.CatalogProduct, error) {
	return c.products, nil
}
func (c *fakeCatalog) ProductRefs(context.Context, database.Querier, []string) (map[string]domain.ProductRef, error) {
	return map[string]domain.ProductRef{}, nil
}
func (c *fakeCatalog) ChannelRule(context.Context, database.Querier, string) (*domain.ChannelRule, error) {
	return c.rule, nil
}
func (c *fakeCatalog) ChannelOverrides(context.Context, database.Querier, string) (map[string]float64, error) {
	return c.overrides, nil
}

// fakeOrders keeps gofood_orders rows in memory.
type fakeOrders struct {
	rows      map[string]*OrderRow
	ensured   []string
	released  []string
	statuses  []string
	failWrite error
}

func (o *fakeOrders) ByGofoodID(_ context.Context, _ database.Querier, gofoodID string) (*ExistingOrder, error) {
	if r := o.rows[gofoodID]; r != nil {
		return &ExistingOrder{ID: r.ID, Status: r.Status}, nil
	}
	return nil, nil
}
func (o *fakeOrders) Insert(_ context.Context, _ database.Querier, w OrderWrite) (*OrderRow, error) {
	if o.failWrite != nil {
		return nil, o.failWrite
	}
	r := &OrderRow{ID: "row-" + w.Summary.GofoodOrderID, GofoodOrderID: w.Summary.GofoodOrderID, GofoodOrderType: w.Summary.GofoodOrderType, Status: w.Status}
	o.rows[r.GofoodOrderID] = r
	return r, nil
}
func (o *fakeOrders) Update(_ context.Context, _ database.Querier, id string, w OrderWrite) (*OrderRow, error) {
	r := o.rows[w.Summary.GofoodOrderID]
	r.Status = w.Status
	r.CancelReason = w.Summary.CancelReason
	return r, nil
}
func (o *fakeOrders) ClaimAutoAccept(_ context.Context, _ database.Querier, id string) (bool, error) {
	for _, r := range o.rows {
		if r.ID == id && r.Status == "awaiting_acceptance" {
			r.Status = "accepted"
			return true, nil
		}
	}
	return false, nil
}
func (o *fakeOrders) ReleaseAutoAccept(_ context.Context, _ database.Querier, id, message string) error {
	o.released = append(o.released, id+":"+message)
	return nil
}
func (o *fakeOrders) EnsurePosOrder(_ context.Context, _ database.DB, id string) error {
	o.ensured = append(o.ensured, id)
	return nil
}
func (o *fakeOrders) SetPosOrderStatus(_ context.Context, _ database.DB, posOrderID, status, note string) error {
	o.statuses = append(o.statuses, posOrderID+" "+status+" "+note)
	return nil
}

type fakeVenues struct{}

func (fakeVenues) DefaultVenue(context.Context, database.Querier) Venue { return Venue{} }

type routes []module.Route

func (r routes) Name() string           { return "gobiz-test" }
func (r routes) Routes() []module.Route { return r }

type fixture struct {
	t       *testing.T
	ctx     context.Context
	tx      pgx.Tx
	gobiz   *fakeGobiz
	catalog *fakeCatalog
	orders  *fakeOrders
	mux     *http.ServeMux
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	f := &fixture{t: t, ctx: context.Background(), tx: tx, gobiz: newFakeGobiz(t),
		catalog: &fakeCatalog{}, orders: &fakeOrders{rows: map[string]*OrderRow{}}}
	f.exec(`DELETE FROM configuration.app_settings WHERE key LIKE 'gobiz\_%'`)
	f.exec(`DELETE FROM pos.gofood_catalog_syncs`)
	h := NewHandler(tx, headerGuard{}, Ports{Catalog: f.catalog, Orders: f.orders, Venues: fakeVenues{}}, gobizapi.NewClient(nil, nil), nil,
		slog.New(slog.NewTextHandler(io.Discard, nil)), "https://pos.test/")
	f.mux = testutil.Mux(routes(h.Routes()))
	return f
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) set(key, value string) {
	f.t.Helper()
	if err := appsettings.Set(f.ctx, f.tx, key, &value); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) setting(key string) string {
	f.t.Helper()
	v, err := appsettings.Get(f.ctx, f.tx, key)
	if err != nil {
		f.t.Fatal(err)
	}
	if v == nil {
		return "<nil>"
	}
	return *v
}

// configure stores working credentials aimed at the fake GoBiz.
func (f *fixture) configure() {
	f.set(gobizapi.KeyClientID, "cid")
	f.set(gobizapi.KeyClientSecret, "client-secret-123")
	f.set(gobizapi.KeyOutletID, "G123")
	f.set(gobizapi.KeyAPIBaseURL, f.gobiz.URL)
	f.set(gobizapi.KeyOAuthURL, f.gobiz.URL+"/oauth2/token")
}

type response struct {
	Status int
	Body   map[string]any
	Raw    string
}

func (r response) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }

func (f *fixture) do(method, target string, body any, headers ...string) response {
	f.t.Helper()
	req := testutil.Request(method, target, body)
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec, decoded := testutil.Do(f.t, f.mux, req)
	return response{rec.Code, decoded, rec.Body.String()}
}

func (f *fixture) staff(method, target string, body any) response {
	return f.do(method, target, body, "X-Test-Staff", "1")
}

func expect(t *testing.T, r response, status int, raw string) {
	t.Helper()
	if r.Status != status || r.Raw != raw {
		t.Fatalf("got %d %s\nwant %d %s", r.Status, r.Raw, status, raw)
	}
}

/* ── GET/PUT /api/settings/gobiz ──────────────────────────────────────── */

func TestSettingsGetPut(t *testing.T) {
	f := newFixture(t)
	if r := f.do("GET", "/api/settings/gobiz", nil); r.Status != 401 {
		t.Fatalf("no session: %d", r.Status)
	}

	r := f.staff("GET", "/api/settings/gobiz", nil)
	token := f.setting(gobizapi.KeyWebhookToken)
	if len(token) != 48 {
		t.Fatalf("webhook token not created: %q", token)
	}
	expect(t, r, 200, `{"data":{"enabled":false,"environment":"sandbox","client_id":"","client_secret_masked":null,"has_client_secret":false,`+
		`"outlet_id":"","partner_id":"","relay_secret_masked":null,"has_relay_secret":false,"enforce_signature":false,"auto_accept":false,`+
		`"oauth_url":"","api_base_url":"","effective_urls":{"apiBase":"https://api.partner-sandbox.gobiz.co.id","oauthUrl":"https://integration-goauth.gojekapi.com/oauth2/token"},`+
		`"webhook_url":"https://pos.test/api/integrations/gobiz/webhook/`+token+`","configured":false,"last_catalog_sync":null}}`)

	for _, bad := range []any{nil, "nope", map[string]any{"client_id": 5}, map[string]any{"environment": "staging"},
		map[string]any{"enabled": nil}, map[string]any{"client_id": strings.Repeat("x", 201)}} {
		expect(t, f.staff("PUT", "/api/settings/gobiz", bad), 400, `{"success":false,"error":"Data tidak valid"}`)
	}
	expect(t, f.staff("PUT", "/api/settings/gobiz", map[string]any{"client_id": "kept?", "oauth_url": "http://x"}), 400,
		`{"success":false,"error":"OAuth URL harus https"}`)
	expect(t, f.staff("PUT", "/api/settings/gobiz", map[string]any{"api_base_url": " ftp://x "}), 400,
		`{"success":false,"error":"API base URL harus https"}`)
	if got := f.setting(gobizapi.KeyClientID); got != "<nil>" {
		t.Fatalf("rejected PUT wrote client_id %q", got)
	}

	r = f.staff("PUT", "/api/settings/gobiz", map[string]any{
		"enabled": true, "environment": "production", "client_id": " cid ", "client_secret": "client-secret-123",
		"outlet_id": "G1", "relay_secret": "short", "enforce_signature": true, "auto_accept": true,
		"oauth_url": "https://auth.test/token", "api_base_url": "https://api.test/", "unknown": 1,
	})
	d := r.data()
	if r.Status != 200 || d["client_secret_masked"] != "clie••••••••-123" || d["relay_secret_masked"] != "••••" ||
		d["client_id"] != "cid" || d["environment"] != "production" || d["configured"] != true || d["auto_accept"] != true {
		t.Fatalf("PUT: %d %s", r.Status, r.Raw)
	}
	if urls := d["effective_urls"].(map[string]any); urls["apiBase"] != "https://api.test" || urls["oauthUrl"] != "https://auth.test/token" {
		t.Fatalf("effective urls %v", urls)
	}

	// Blank clears; an omitted key stays.
	f.staff("PUT", "/api/settings/gobiz", map[string]any{"client_secret": "  ", "oauth_url": ""})
	if f.setting(gobizapi.KeyClientSecret) != "<nil>" || f.setting(gobizapi.KeyOAuthURL) != "<nil>" || f.setting(gobizapi.KeyClientID) != "cid" {
		t.Fatal("blank did not clear")
	}

	f.exec(`INSERT INTO pos.gofood_catalog_syncs (request_id, item_count, status, error, created_at) VALUES ('r-1', 3, 'failed', 'boom', '2026-10-04T01:02:03.456Z')`)
	if last := f.staff("GET", "/api/settings/gobiz", nil).data()["last_catalog_sync"]; !jsonIs(last, `{"created_at":"2026-10-04T01:02:03.456Z","status":"failed","item_count":3,"error":"boom"}`) {
		t.Fatalf("last sync %v", last)
	}
}

// jsonIs compares v with want after normalizing both through JSON.
func jsonIs(v any, want string) bool {
	var w any
	_ = json.Unmarshal([]byte(want), &w)
	a, _ := json.Marshal(v)
	b, _ := json.Marshal(w)
	return string(a) == string(b)
}

/* ── POST /api/settings/gobiz/actions ─────────────────────────────────── */

func TestActions(t *testing.T) {
	f := newFixture(t)
	const path = "/api/settings/gobiz/actions"
	for _, bad := range []any{nil, map[string]any{}, map[string]any{"action": "drop"}} {
		expect(t, f.staff("POST", path, bad), 400, `{"success":false,"error":"Aksi tidak valid"}`)
	}
	expect(t, f.staff("POST", path, map[string]any{"action": "test"}), 400,
		`{"success":false,"error":"`+ErrNotConfigured.Error()+`"}`)

	f.configure()
	expect(t, f.staff("POST", path, map[string]any{"action": "test"}), 200,
		`{"success":true,"data":{"ok":true,"environment":"sandbox","token_preview":"T1…"}}`)

	// A failing subscription is reported per event, not as an error.
	f.gobiz.reply = func(p string) (int, string) {
		if strings.Contains(p, "notification") {
			return 409, `{"message":"already subscribed"}`
		}
		return 200, `{"success":true}`
	}
	r := f.staff("POST", path, map[string]any{"action": "register_webhooks"})
	token := f.setting(gobizapi.KeyWebhookToken)
	results := r.data()["results"].([]any)
	if r.Status != 200 || r.data()["url"] != "https://pos.test/api/integrations/gobiz/webhook/"+token || len(results) != 10 ||
		!jsonIs(results[0], `{"event":"gofood.order.created","ok":false,"error":"already subscribed"}`) {
		t.Fatalf("register: %s", r.Raw)
	}
	f.gobiz.reply = nil
	r = f.staff("POST", path, map[string]any{"action": "register_webhooks"})
	if !jsonIs(r.data()["results"].([]any)[9], `{"event":"gofood.catalog.menu_mapping_updated","ok":true}`) {
		t.Fatalf("register ok: %s", r.Raw)
	}

	r = f.staff("POST", path, map[string]any{"action": "regenerate_token"})
	fresh := f.setting(gobizapi.KeyWebhookToken)
	expect(t, r, 200, `{"success":true,"data":{"webhook_url":"https://pos.test/api/integrations/gobiz/webhook/`+fresh+`"}}`)
	if fresh == token {
		t.Fatal("token not regenerated")
	}
}

func TestSyncCatalog(t *testing.T) {
	f := newFixture(t)
	f.configure()
	f.catalog.products = []domain.CatalogProduct{
		{ID: "p-latte", Name: "Iced Latte", Price: 28000, InStock: true, Image: ptr("/products/latte.webp")},
		{ID: "p-free", Name: "Air", Price: 0, InStock: true},
	}
	f.catalog.rule = &domain.ChannelRule{Code: "gofood", MarkupPercent: 20, RoundingStep: 1000, RoundingMode: "up", IsActive: true}
	f.gobiz.reply = func(string) (int, string) { return 200, `{"success":true,"data":{"request_id":"gb-1"}}` }

	r := f.staff("POST", "/api/settings/gobiz/actions", map[string]any{"action": "sync_catalog"})
	d := r.data()
	requestID, _ := d["request_id"].(string)
	if r.Status != 200 || !domainUUID(requestID) ||
		!jsonIs(d["stats"], `{"menus":1,"items":1,"variantCategories":0,"skipped":[{"id":"p-free","name":"Air","reason":"harga 0"}]}`) ||
		!jsonIs(d["response"], `{"success":true,"data":{"request_id":"gb-1"}}`) {
		t.Fatalf("sync: %s", r.Raw)
	}
	pushed := f.gobiz.apiCalls()[0]
	var payload domain.CatalogPayload
	_ = json.Unmarshal([]byte(pushed.Body), &payload)
	item := payload.Menus[0].MenuItems[0]
	if payload.RequestID != requestID || item.Price != 34000 || !strings.HasPrefix(item.Image, "https://pos.test/api/public/gofood-image/") {
		t.Fatalf("payload %s", pushed.Body)
	}
	var status, response string
	var count int
	if err := f.tx.QueryRow(f.ctx, `SELECT status, item_count, response::text FROM pos.gofood_catalog_syncs WHERE request_id = $1`, requestID).
		Scan(&status, &count, &response); err != nil || status != "success" || count != 1 || !strings.Contains(response, "gb-1") {
		t.Fatalf("sync row %s %d %s %v", status, count, response, err)
	}

	f.gobiz.reply = func(string) (int, string) {
		return 400, `{"success":false,"errors":[{"message":"invalid image type"}]}`
	}
	r = f.staff("POST", "/api/settings/gobiz/actions", map[string]any{"action": "sync_catalog"})
	expect(t, r, 502, `{"success":false,"error":"GoBiz: invalid image type","status":400,"detail":{"success":false,"errors":[{"message":"invalid image type"}]}}`)
	var errText string
	if err := f.tx.QueryRow(f.ctx, `SELECT status, error FROM pos.gofood_catalog_syncs ORDER BY created_at DESC, status LIMIT 1`).Scan(&status, &errText); err != nil ||
		status != "failed" || errText != "invalid image type" {
		t.Fatalf("failed row %s %s %v", status, errText, err)
	}
}

func domainUUID(s string) bool { return len(s) == 36 && s[14] == '4' }

func ptr[T any](v T) *T { return &v }

/* ── POST /api/integrations/gobiz/webhook/{token} ─────────────────────── */

const sampleEvent = `{"header":{"event_name":"gofood.order.awaiting_merchant_acceptance","event_id":"evt-1"},` +
	`"body":{"service_type":"gofood","order":{"order_number":"F-1","order_total":10000,"order_items":[]}}}`

func (f *fixture) webhook(token, body string, headers ...string) response {
	f.t.Helper()
	return f.do("POST", "/api/integrations/gobiz/webhook/"+token, body, headers...)
}

func (f *fixture) eventRow(eventID string) (result, idem string) {
	f.t.Helper()
	var r, i, e *string
	if err := f.tx.QueryRow(f.ctx, `SELECT result, idempotency_key, error FROM pos.gofood_events WHERE event_id = $1`, eventID).Scan(&r, &i, &e); err != nil {
		f.t.Fatalf("event %s: %v", eventID, err)
	}
	return deref(r) + deref(e), deref(i)
}

func TestWebhook(t *testing.T) {
	f := newFixture(t)
	f.exec(`DELETE FROM pos.gofood_events WHERE event_id LIKE 'evt-%'`)
	const unauthorized = `{"success":false,"error":"Unauthorized"}`

	// No token configured yet: even an empty match is refused.
	expect(t, f.webhook("secret-token", sampleEvent), 401, unauthorized)
	f.set(gobizapi.KeyWebhookToken, "secret-token")
	expect(t, f.webhook("wrong", sampleEvent), 401, unauthorized)

	expect(t, f.webhook("secret-token", `{"hello":"world"}`), 200,
		`{"success":true,"data":{},"ignored":true,"reason":"unrecognized_payload"}`)
	expect(t, f.webhook("secret-token", `not json`), 200,
		`{"success":true,"data":{},"ignored":true,"reason":"unrecognized_payload"}`)

	expect(t, f.webhook("secret-token", sampleEvent, "X-Go-Idempotency-Key", "idem-9"), 200,
		`{"success":true,"data":{"result":"status:awaiting_acceptance"}}`)
	if result, idem := f.eventRow("evt-1"); result != "status:awaiting_acceptance" || idem != "idem-9" {
		t.Fatalf("event row %q %q", result, idem)
	}
	expect(t, f.webhook("secret-token", sampleEvent), 200, `{"success":true,"data":{},"ignored":true,"reason":"duplicate_event"}`)

	// Non-order events are stored and ignored.
	expect(t, f.webhook("secret-token", `{"header":{"event_name":"gofood.catalog.menu_mapping_updated","event_id":"evt-cat"}}`), 200,
		`{"success":true,"data":{"result":"ignored_non_order"}}`)

	// A processing failure keeps the event (result=error) and still answers 200.
	f.orders.failWrite = errors.New("db down")
	expect(t, f.webhook("secret-token", strings.Replace(strings.Replace(sampleEvent, "evt-1", "evt-2", 1), "F-1", "F-2", 1)), 200,
		`{"success":true,"data":{},"processed":false}`)
	if result, _ := f.eventRow("evt-2"); result != "errordb down" {
		t.Fatalf("failed event row %q", result)
	}
}

func TestWebhookSignature(t *testing.T) {
	f := newFixture(t)
	f.exec(`DELETE FROM pos.gofood_events WHERE event_id LIKE 'evt-%'`)
	const secret = "relay-secret-test"
	const invalid = `{"success":false,"error":"Invalid signature"}`
	f.set(gobizapi.KeyWebhookToken, "secret-token")
	f.set(gobizapi.KeyRelaySecret, secret)

	// A configured secret is enforced whatever gobiz_signature_enforce says.
	for _, enforce := range []string{"true", "false"} {
		f.set(gobizapi.KeySignatureEnforce, enforce)
		expect(t, f.webhook("secret-token", sampleEvent, "X-Go-Signature", "deadbeef"), 401, invalid)
		expect(t, f.webhook("secret-token", sampleEvent), 401, invalid)
	}
	sig := domain.ComputeSignature(sampleEvent, secret)
	if r := f.webhook("secret-token", sampleEvent, "X-Go-Signature", strings.ToUpper(sig)); r.Status != 200 || r.data()["result"] == nil {
		t.Fatalf("signed: %d %s", r.Status, r.Raw)
	}

	// Without a secret only the path token guards.
	f.set(gobizapi.KeyRelaySecret, "")
	if r := f.webhook("secret-token", strings.Replace(sampleEvent, "evt-1", "evt-3", 1)); r.Status != 200 {
		t.Fatalf("unsigned: %d", r.Status)
	}
	expect(t, f.webhook("salah", sampleEvent, "X-Go-Signature", sig), 401, `{"success":false,"error":"Unauthorized"}`)
}

func TestWebhookAutoAccept(t *testing.T) {
	f := newFixture(t)
	f.exec(`DELETE FROM pos.gofood_events WHERE event_id LIKE 'evt-%'`)
	f.configure()
	f.set(gobizapi.KeyWebhookToken, "secret-token")
	f.set(gobizapi.KeyAutoAccept, "true")

	expect(t, f.webhook("secret-token", sampleEvent), 200, `{"success":true,"data":{"result":"auto_accepted"}}`)
	if calls := f.gobiz.apiCalls(); len(calls) != 1 || calls[0].Path != "/integrations/gofood/outlets/G123/v1/orders/delivery/F-1/accepted" {
		t.Fatalf("accept calls %+v", calls)
	}
	if len(f.orders.ensured) != 1 || f.orders.ensured[0] != "row-F-1" {
		t.Fatalf("pos order not ensured: %v", f.orders.ensured)
	}

	f.gobiz.reply = func(string) (int, string) { return 422, `{"message":"order expired"}` }
	pickup := strings.NewReplacer("evt-1", "evt-4", "F-1", "F-4", `"gofood"`, `"gofood_pickup"`).Replace(sampleEvent)
	expect(t, f.webhook("secret-token", pickup), 200, `{"success":true,"data":{"result":"auto_accept_failed:order expired"}}`)
	if len(f.orders.released) != 1 || f.orders.released[0] != "row-F-4:order expired" {
		t.Fatalf("claim not released: %v", f.orders.released)
	}

	// Cancellation of an order with a POS order cancels it there.
	f.orders.rows["F-1"].PosOrderID = ptr("pos-1")
	cancel := `{"header":{"event_name":"gofood.order.cancelled","event_id":"evt-5"},` +
		`"body":{"order":{"order_number":"F-1","cancellation_detail":{"reason":" Toko tutup "}}}}`
	expect(t, f.webhook("secret-token", cancel), 200, `{"success":true,"data":{"result":"cancelled"}}`)
	if len(f.orders.statuses) != 1 || f.orders.statuses[0] != "pos-1 cancelled GoFood F-1 dibatalkan: Toko tutup" {
		t.Fatalf("pos status %v", f.orders.statuses)
	}
}

// TestAuthWiring runs the real staff guard.
func TestAuthWiring(t *testing.T) {
	deps := testutil.Deps(t, nil)
	mux := testutil.Mux(routes(New(deps, Ports{}).Routes()))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, testutil.Request("GET", "/api/settings/gobiz", nil))
	if rec.Code != 401 {
		t.Fatalf("no session: %d %s", rec.Code, rec.Body)
	}
}
