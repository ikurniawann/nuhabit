package shop

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	possales "nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/ratelimit"
	"nuhabit/backend/internal/platform/testutil"
)

// Every test runs in one rolled-back transaction. The guard reads the
// caller from headers; the catalog, stock and payment ports are in-memory
// fakes (internal/app's SQL adapters have their own tests), and the courier
// API is an httptest server.

type headerGuard struct{}

func (headerGuard) RequireMenuPrefix(r *http.Request, _ ...string) (*auth.User, error) {
	switch {
	case r.Header.Get("X-Test-Forbid") != "":
		return nil, httpx.Forbidden("")
	case r.Header.Get("X-Test-Staff") == "":
		return nil, httpx.Unauthorized("")
	}
	return &auth.User{ID: r.Header.Get("X-Test-Staff")}, nil
}

type fakeMessenger struct{ sent []string }

func (m *fakeMessenger) SendText(_ context.Context, target, message string) error {
	m.sent = append(m.sent, target+"|"+message)
	return nil
}

type fakeStock struct {
	calls []string
	fail  map[string]bool // product id -> claim refused
}

func (s *fakeStock) Sell(_ context.Context, _ database.Querier, productID string, skuID *string, qty float64) (*bool, string, error) {
	id := productID
	if skuID != nil {
		id = *skuID
	}
	s.calls = append(s.calls, id+":"+domain.JSString(qty))
	ok := !s.fail[id]
	return &ok, "", nil
}

type fakeCatalog struct {
	products map[string]WebProduct
	skus     []CatalogSKU
}

func (c fakeCatalog) WebProducts(context.Context, database.Querier) ([]WebProduct, error) {
	var out []WebProduct
	for _, p := range c.products {
		out = append(out, p)
	}
	return out, nil
}

func (c fakeCatalog) WebProduct(_ context.Context, _ database.Querier, id string) (*WebProduct, error) {
	if p, ok := c.products[id]; ok {
		return &p, nil
	}
	return nil, nil
}

func (c fakeCatalog) ActiveSKUs(_ context.Context, _ database.Querier, ids []string) ([]CatalogSKU, error) {
	return c.skus, nil
}

func (c fakeCatalog) ActiveSKU(_ context.Context, _ database.Querier, skuID, productID string) (*CatalogSKU, error) {
	for _, s := range c.skus {
		if s.ID == skuID && s.ProductID == productID {
			return &s, nil
		}
	}
	return nil, nil
}

func (fakeCatalog) Images(context.Context, database.Querier, []string) ([]ProductImage, error) {
	return nil, nil
}

func (c fakeCatalog) Cargo(_ context.Context, _ database.Querier, id string) (*string, string, bool, error) {
	p, ok := c.products[id]
	return p.WeightGram, p.BasePrice, ok, nil
}

func (c fakeCatalog) ProductKind(_ context.Context, _ database.Querier, id string) (string, bool, error) {
	if _, ok := c.products[id]; ok {
		return "merchandise", true, nil
	}
	return "", false, nil
}

func (c fakeCatalog) Labels(context.Context, database.Querier, []string, []string) (map[string]string, map[string]SKULabel, error) {
	names := map[string]string{}
	for id, p := range c.products {
		names[id] = p.Name
	}
	return names, map[string]SKULabel{}, nil
}

func (fakeCatalog) LocalStock(context.Context, database.Querier, string, *string) (*string, error) {
	return nil, nil
}

type fakeMembers struct{ id string }

func (m fakeMembers) ByPhoneSuffix(context.Context, database.Querier, string) (string, error) {
	return m.id, nil
}

type fakePayments struct {
	fail     bool
	invoices []InvoiceRequest
}

func (*fakePayments) Configured() bool { return true }

func (p *fakePayments) CreateInvoice(_ context.Context, in InvoiceRequest) (Invoice, error) {
	p.invoices = append(p.invoices, in)
	if p.fail {
		return Invoice{}, io.ErrUnexpectedEOF
	}
	return Invoice{ID: "inv-1", URL: "https://pay.example/inv-1", ExpiresAt: time.Now()}, nil
}

func (*fakePayments) ValidWebhookToken(token string) bool {
	return domain.SafeEqual(token, "xnd-secret")
}

type fixture struct {
	t       *testing.T
	ctx     context.Context
	tx      pgx.Tx
	svc     *Service
	mux     *http.ServeMux
	wa      *fakeMessenger
	stock   *fakeStock
	pay     *fakePayments
	env     map[string]string
	catalog fakeCatalog
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	f := &fixture{t: t, ctx: context.Background(), tx: tx, wa: &fakeMessenger{}, stock: &fakeStock{fail: map[string]bool{}},
		pay: &fakePayments{}, env: map[string]string{}, catalog: fakeCatalog{products: map[string]WebProduct{}}}
	// Fresh settings and storefront state inside the transaction.
	f.exec(`DELETE FROM shop.shipping_settings`)
	f.svc = NewService(tx, Ports{
		Catalog: f.catalog, Stock: f.stock, Members: fakeMembers{}, Payments: f.pay, Messenger: f.wa,
		AppOrigin: "https://app.example", Getenv: func(k string) string { return f.env[k] },
	}, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	f.svc.async = func(fn func()) { fn() }
	f.mux = testutil.Mux(mod{h: &handler{svc: f.svc, guard: headerGuard{}, limiter: ratelimit.New(tx)}})
	return f
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
		return "<nil>"
	}
	return *v
}

// order inserts a shop order and returns its id.
func (f *fixture) order(status string, extra ...string) string {
	f.t.Helper()
	cols := "status, customer_name, customer_phone, shipping_address, subtotal, shipping_cost, total, courier_code, courier_service, shipping_area_id"
	vals := "$1, 'Budi', '0812-3456-7890', 'Jl. Dago 1', 100000, 12000, 112000, 'jne', 'reg', 'area-1'"
	if len(extra) > 0 {
		cols += ", " + extra[0]
		vals += ", " + extra[1]
	}
	return f.scalar(`INSERT INTO shop.orders (`+cols+`) VALUES (`+vals+`) RETURNING id::text`, status)
}

func (f *fixture) do(method, target string, body any, headers ...string) (*httptest.ResponseRecorder, map[string]any) {
	f.t.Helper()
	r := testutil.Request(method, target, body)
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	return testutil.Do(f.t, f.mux, r)
}

func (f *fixture) staff(method, target string, body any) (*httptest.ResponseRecorder, map[string]any) {
	return f.do(method, target, body, "X-Test-Staff", "00000000-0000-4000-8000-000000000001")
}

func expectStatus(t *testing.T, res *httptest.ResponseRecorder, want int) {
	t.Helper()
	if res.Code != want {
		t.Fatalf("status = %d, want %d: %s", res.Code, want, res.Body.String())
	}
}

func expectJSON(t *testing.T, res *httptest.ResponseRecorder, want string) {
	t.Helper()
	if got := strings.TrimSpace(res.Body.String()); got != want {
		t.Fatalf("body = %s\nwant   %s", got, want)
	}
}

// Ported from app/api/shop/orders/[id]/route.test.ts.
func TestOrderTransitionRoute(t *testing.T) {
	f := newFixture(t)
	id := f.order("paid")
	f.exec(`INSERT INTO shop.stock_reservations (order_id, product_id, qty, status, expires_at)
		VALUES ($1, gen_random_uuid(), 2, 'committed', now() + interval '1 hour')`, id)
	f.exec(`INSERT INTO shop.shipments (order_id, provider, status) VALUES ($1, 'manual', 'pickup')`, id)

	res, body := f.do("PATCH", "/api/shop/orders/"+id, map[string]string{"status": "packing"}, "X-Test-Forbid", "1")
	expectStatus(t, res, 403)
	expectJSON(t, res, `{"success":false,"error":"Insufficient permissions"}`)

	res, body = f.staff("PATCH", "/api/shop/orders/bukan-uuid", map[string]string{"status": "packing"})
	expectStatus(t, res, 404)
	if body["error"] != "Order tidak ditemukan" {
		t.Fatalf("error = %v", body["error"])
	}

	res, body = f.staff("PATCH", "/api/shop/orders/"+id, map[string]string{"status": "shipped"})
	expectStatus(t, res, 400)
	if body["error"] != "Transisi status tidak dikenal" {
		t.Fatalf("error = %v", body["error"])
	}

	res, _ = f.staff("PATCH", "/api/shop/orders/"+id, map[string]string{"status": "completed"})
	expectStatus(t, res, 409)

	res, _ = f.staff("PATCH", "/api/shop/orders/"+id, map[string]string{"status": "cancelled", "note": "  refund manual "})
	expectStatus(t, res, 200)
	expectJSON(t, res, `{"success":true,"data":{"id":"`+id+`","status":"cancelled","prev_status":"paid"}}`)
	if got := f.scalar(`SELECT notes FROM shop.orders WHERE id = $1`, id); got != "refund manual" {
		t.Errorf("notes = %q", got)
	}
	if got := f.scalar(`SELECT status FROM shop.stock_reservations WHERE order_id = $1`, id); got != "released" {
		t.Errorf("committed reservation = %s", got)
	}
	if len(f.stock.calls) != 1 || !strings.HasSuffix(f.stock.calls[0], ":-2") {
		t.Errorf("stock restore = %v", f.stock.calls)
	}
	if got := f.scalar(`SELECT status FROM shop.shipments WHERE order_id = $1`, id); got != "cancelled" {
		t.Errorf("shipment = %s", got)
	}

	res, _ = f.staff("PATCH", "/api/shop/orders/"+id, "bukan-json")
	expectStatus(t, res, 500)
	expectJSON(t, res, `{"success":false,"error":"Terjadi kesalahan server"}`)
}

func TestOrderListAndDetail(t *testing.T) {
	f := newFixture(t)
	id := f.order("pending", "order_number", "'SHOP-GO-"+testutil.RandomHex(3)+"'")
	f.exec(`INSERT INTO shop.order_items (order_id, product_name, sku_name, quantity, unit_price, total)
		VALUES ($1, 'Kaos', 'L', 2, 50000, 100000)`, id)
	number := f.scalar(`SELECT order_number FROM shop.orders WHERE id = $1`, id)

	res, body := f.staff("GET", "/api/shop/orders?search="+number+"&limit=999", nil)
	expectStatus(t, res, 200)
	rows := body["data"].([]any)
	if len(rows) != 1 {
		t.Fatalf("rows = %v", rows)
	}
	row := rows[0].(map[string]any)
	if row["item_count"] != "1" || row["total"] != "112000.00" || row["shipment_status"] != nil {
		t.Errorf("row = %v", row)
	}

	res, body = f.staff("GET", "/api/shop/orders/"+id, nil)
	expectStatus(t, res, 200)
	detail := body["data"].(map[string]any)
	items := detail["items"].([]any)
	if detail["access_token"] == nil || len(items) != 1 || items[0].(map[string]any)["quantity"] != "2.00" {
		t.Errorf("detail = %v", detail)
	}
	res, _ = f.staff("GET", "/api/shop/orders/7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f", nil)
	expectStatus(t, res, 404)
}

func TestPublicOrderStatus(t *testing.T) {
	f := newFixture(t)
	id := f.order("pending", "xendit_invoice_url", "'https://invoice.example/abc'")
	f.exec(`INSERT INTO shop.order_items (order_id, product_name, sku_name, quantity, unit_price, total)
		VALUES ($1, 'Kaos', 'L', 2, 50000, 100000)`, id)
	token := f.scalar(`SELECT access_token::text FROM shop.orders WHERE id = $1`, id)

	res, body := f.do("GET", "/api/public/shop/order/"+token, nil)
	expectStatus(t, res, 200)
	view := body["data"].(map[string]any)
	if view["courier"] != "jne — reg" || view["total"] != 112000.0 || view["invoice_url"] != "https://invoice.example/abc" || view["paid_at"] != nil {
		t.Errorf("view = %v", view)
	}
	if _, leaked := view["id"]; leaked {
		t.Error("id must not leak")
	}
	item := view["items"].([]any)[0].(map[string]any)
	if item["name"] != "Kaos — L" || item["quantity"] != 2.0 || item["unit_price"] != 50000.0 {
		t.Errorf("item = %v", item)
	}

	res, _ = f.do("GET", "/api/public/shop/order/bukan-token", nil)
	expectStatus(t, res, 404)
	expectJSON(t, res, `{"success":false,"error":"Order tidak ditemukan"}`)
}

// Ported from app/api/public/shop/webhook/biteship/route.test.ts.
func TestBiteshipWebhookToken(t *testing.T) {
	f := newFixture(t)
	f.env["BITESHIP_WEBHOOK_TOKEN"] = "bs-secret"
	const url = "/api/public/shop/webhook/biteship"
	payload := map[string]string{"order_id": "bs-unknown-" + testutil.RandomHex(3), "status": "picked"}
	code := func(target string, headers ...string) int {
		res, _ := f.do("POST", target, payload, headers...)
		return res.Code
	}
	if code(url, "x-webhook-token", "bs-secret") != 200 || code(url, "authorization", "Bearer bs-secret") != 200 {
		t.Error("header and Bearer tokens are accepted")
	}
	if code(url+"?token=bs-secret") != 200 {
		t.Error("query token still accepted")
	}
	if code(url+"?token=bs-secre") != 401 || code(url, "x-webhook-token", "salah") != 401 || code(url) != 401 {
		t.Error("wrong or missing token is 401")
	}
	f.env["BITESHIP_WEBHOOK_TOKEN"] = ""
	if code(url, "x-webhook-token", "") != 503 {
		t.Error("no env token is 503")
	}
}

func TestBiteshipWebhookShipsAndCompletes(t *testing.T) {
	f := newFixture(t)
	f.env["BITESHIP_WEBHOOK_TOKEN"] = "bs-secret"
	id := f.order("packing")
	provider := "bs-" + testutil.RandomHex(4)
	f.exec(`INSERT INTO shop.shipments (order_id, provider, provider_order_id, status) VALUES ($1, 'biteship', $2, 'pickup')`, id, provider)

	res, _ := f.do("POST", "/api/public/shop/webhook/biteship", map[string]any{
		"order_id": provider, "status": "picked", "courier_waybill_id": "WB123456", "event": "order.status",
	}, "x-webhook-token", "bs-secret")
	expectStatus(t, res, 200)
	expectJSON(t, res, `{"success":true}`)
	if got := f.scalar(`SELECT status || '|' || waybill FROM shop.orders WHERE id = $1`, id); got != "shipped|WB123456" {
		t.Errorf("order = %s", got)
	}
	if got := f.scalar(`SELECT status || '|' || jsonb_array_length(tracking_history) FROM shop.shipments WHERE order_id = $1`, id); got != "in_transit|1" {
		t.Errorf("shipment = %s", got)
	}
	if len(f.wa.sent) != 1 || !strings.Contains(f.wa.sent[0], "Resi: *WB123456*") || !strings.Contains(f.wa.sent[0], "Kurir: jne reg") {
		t.Errorf("wa = %v", f.wa.sent)
	}

	res, _ = f.do("POST", "/api/public/shop/webhook/biteship", map[string]any{"order_id": provider, "status": "delivered"}, "x-webhook-token", "bs-secret")
	expectStatus(t, res, 200)
	if got := f.scalar(`SELECT status FROM shop.orders WHERE id = $1`, id); got != "completed" {
		t.Errorf("order = %s", got)
	}
	if len(f.wa.sent) != 1 {
		t.Error("the waybill message goes once")
	}
	res, _ = f.do("POST", "/api/public/shop/webhook/biteship", map[string]any{"status": "picked"}, "x-webhook-token", "bs-secret")
	expectJSON(t, res, `{"success":true,"ignored":true}`)
}

func TestXenditWebhookSettlesOrder(t *testing.T) {
	member := testutil.CreateMember(t) // before the transaction: its cleanup runs after the rollback
	f := newFixture(t)
	f.svc.ports.Members = fakeMembers{id: member.CustomerID}
	bus := outbox.NewBus(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	var recorded []possales.CustomerOrderRecorded
	bus.Subscribe(possales.TopicCustomerOrderRecorded, "shop.test-recorded", func(_ context.Context, _ pgx.Tx, e outbox.Event) error {
		var ev possales.CustomerOrderRecorded
		recorded = append(recorded, ev)
		return e.Decode(&recorded[len(recorded)-1])
	})
	if err := bus.Register(f.ctx, f.tx); err != nil {
		t.Fatal(err)
	}
	id := f.order("pending")
	f.exec(`INSERT INTO shop.stock_reservations (order_id, product_id, qty, expires_at)
		VALUES ($1, gen_random_uuid(), 1, now() + interval '1 hour')`, id)
	const url = "/api/public/shop/webhook/xendit"
	cb := func(status string, amount float64) map[string]any {
		return map[string]any{"id": "inv-1", "external_id": InvoicePrefix + id, "status": status, "amount": amount}
	}

	res, _ := f.do("POST", url, cb("PAID", 112000), "x-callback-token", "salah")
	expectStatus(t, res, 401)
	expectJSON(t, res, `{"success":false,"error":"Unauthorized"}`)

	res, _ = f.do("POST", url, map[string]any{"id": 1}, "x-callback-token", "xnd-secret")
	expectStatus(t, res, 400)
	expectJSON(t, res, `{"success":false,"error":"Payload tidak dikenal"}`)

	res, _ = f.do("POST", url, map[string]any{"id": "x", "external_id": "tkt-booking-1", "status": "PAID"}, "x-callback-token", "xnd-secret")
	expectJSON(t, res, `{"success":true,"ignored":true}`)

	res, _ = f.do("POST", url, cb("PAID", 1000), "x-callback-token", "xnd-secret")
	expectStatus(t, res, 400)
	expectJSON(t, res, `{"success":false,"error":"Amount mismatch"}`)

	res, _ = f.do("POST", url, cb("PAID", 112000), "x-callback-token", "xnd-secret")
	expectStatus(t, res, 200)
	expectJSON(t, res, `{"success":true}`)
	if got := f.scalar(`SELECT status || '|' || (paid_at IS NOT NULL) || '|' || customer_id FROM shop.orders WHERE id = $1`, id); got != "paid|true|"+member.CustomerID {
		t.Errorf("order = %s", got)
	}
	if got := f.scalar(`SELECT status FROM shop.stock_reservations WHERE order_id = $1`, id); got != "committed" {
		t.Errorf("reservation = %s", got)
	}
	if len(f.wa.sent) != 1 || !strings.Contains(f.wa.sent[0], "Total: Rp112.000") || !strings.Contains(f.wa.sent[0], "https://app.example/shop/order/") {
		t.Errorf("wa = %v", f.wa.sent)
	}
	if _, err := bus.Dispatch(f.ctx, f.tx); err != nil {
		t.Fatal(err)
	}
	if len(recorded) != 1 || recorded[0] != (possales.CustomerOrderRecorded{CustomerID: member.CustomerID, OrderID: id, Amount: 112000}) {
		t.Errorf("recorded = %+v", recorded)
	}

	res, _ = f.do("POST", url, cb("PAID", 112000), "x-callback-token", "xnd-secret")
	expectJSON(t, res, `{"success":true,"already_processed":true}`)

	other := f.order("pending")
	f.exec(`INSERT INTO shop.stock_reservations (order_id, product_id, qty, expires_at)
		VALUES ($1, gen_random_uuid(), 3, now() + interval '1 hour')`, other)
	res, _ = f.do("POST", url, map[string]any{"id": "inv-2", "external_id": InvoicePrefix + other, "status": "EXPIRED"}, "x-callback-token", "xnd-secret")
	expectJSON(t, res, `{"success":true}`)
	if got := f.scalar(`SELECT o.status || '|' || r.status FROM shop.orders o JOIN shop.stock_reservations r ON r.order_id = o.id WHERE o.id = $1`, other); got != "cancelled|released" {
		t.Errorf("expired = %s", got)
	}
}

// fakeBiteship serves the Biteship endpoints the storefront calls.
func fakeBiteship(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("authorization") != "bs-key" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"success":false,"error":"Invalid key"}`))
			return
		}
		switch {
		case r.URL.Path == "/v1/rates/couriers":
			_, _ = w.Write([]byte(`{"success":true,"pricing":[
				{"courier_code":"jne","courier_name":"JNE","courier_service_code":"reg","courier_service_name":"Reguler","price":10000,"duration":"1 - 2 days"},
				{"courier_code":"jnt","courier_service_code":"ez","price":0,"shipment_duration_range":"2 - 3","shipment_duration_unit":"days"}]}`))
		case r.URL.Path == "/v1/maps/areas":
			_, _ = w.Write([]byte(`{"success":true,"areas":[{"id":"IDNP6","name":"Coblong, Bandung","postal_code":40132},{"id":"","name":"x"}]}`))
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestCheckoutFlow(t *testing.T) {
	f := newFixture(t)
	f.svc.biteshipBase = fakeBiteship(t).URL
	f.env["BITESHIP_API_KEY"] = "bs-key"
	slug := "go-" + testutil.RandomHex(4)
	f.exec(`INSERT INTO shop.storefronts (slug, name) VALUES ($1, 'Toko Go')`, slug)
	f.exec(`UPDATE shop.shipping_settings SET is_active = false`)
	f.exec(`INSERT INTO shop.shipping_settings (provider, origin_area_id, couriers, markup_amount) VALUES ('biteship', 'ORIGIN', 'jne', 2500)`)
	product := f.scalar(`INSERT INTO pos.pos_products (sku, name, product_kind) VALUES ($1, 'Kaos', 'merchandise') RETURNING id::text`, "GO-"+testutil.RandomHex(4))
	weight := "500"
	f.catalog.products[product] = WebProduct{ID: product, Name: "Kaos", BasePrice: "50000", WeightGram: &weight}

	body := map[string]any{
		"items":       []map[string]any{{"product_id": product, "quantity": 2}},
		"customer":    map[string]any{"name": "Budi", "phone": "081234567890", "email": ""},
		"destination": map[string]any{"area_id": "IDNP6", "label": "Coblong, Bandung", "address": "Jl. Dago 1 no 10"},
		"courier":     map[string]any{"code": "JNE", "service_code": "REG"},
	}
	base := "/api/public/shop/" + slug

	res, rates := f.do("POST", base+"/shipping/rates", map[string]any{"destination_id": "IDNP6", "items": body["items"]})
	expectStatus(t, res, 200)
	data := rates["data"].([]any)
	if len(data) != 1 || data[0].(map[string]any)["total_price"] != 12500.0 || rates["meta"].(map[string]any)["weight_gram"] != 1000.0 {
		t.Errorf("rates = %v", rates)
	}

	res, _ = f.do("GET", base+"/shipping/areas?q=cob", nil)
	expectStatus(t, res, 200)
	expectJSON(t, res, `{"success":true,"data":[{"provider":"biteship","id":"IDNP6","label":"Coblong, Bandung","postalCode":"40132"}]}`)

	res, out := f.do("POST", base+"/checkout", body)
	expectStatus(t, res, 201)
	created := out["data"].(map[string]any)
	if created["invoice_url"] != "https://pay.example/inv-1" || !strings.HasPrefix(created["status_url"].(string), "https://app.example/shop/order/") {
		t.Errorf("created = %v", created)
	}
	number := created["order_number"].(string)
	got := f.scalar(`SELECT status || '|' || subtotal || '|' || shipping_cost || '|' || total || '|' || courier_code || '|' || courier_service || '|' || xendit_invoice_id || '|' || (customer_email IS NULL)
		FROM shop.orders WHERE order_number = $1`, number)
	if got != "pending|100000.00|12500.00|112500.00|jne|reg|inv-1|true" {
		t.Errorf("order = %s", got)
	}
	if got := f.scalar(`SELECT r.status || '|' || r.qty FROM shop.stock_reservations r JOIN shop.orders o ON o.id = r.order_id WHERE o.order_number = $1`, number); got != "held|2.00" {
		t.Errorf("reservation = %s", got)
	}
	inv := f.pay.invoices[0]
	if inv.Amount != 112500 || inv.Description != "Order "+number+" — Toko Go" {
		t.Errorf("invoice = %+v", inv)
	}

	// The client's courier must still be offered.
	body["courier"] = map[string]any{"code": "jnt", "service_code": "ez"}
	res, out = f.do("POST", base+"/checkout", body)
	expectStatus(t, res, 409)
	if out["error"] != "Layanan kurir tidak tersedia lagi — pilih ulang ongkir" {
		t.Errorf("error = %v", out["error"])
	}

	// Stock refused: no order, earlier claims returned.
	body["courier"] = map[string]any{"code": "jne", "service_code": "reg"}
	f.stock.fail[product] = true
	res, out = f.do("POST", base+"/checkout", body)
	expectStatus(t, res, 400)
	if out["error"] != "Stok Kaos tidak cukup" {
		t.Errorf("error = %v", out["error"])
	}
	delete(f.stock.fail, product)

	// Invoice failure cancels the order and releases the stock.
	f.pay.fail = true
	res, out = f.do("POST", base+"/checkout", body)
	expectStatus(t, res, 502)
	if out["error"] != "Gagal membuat invoice pembayaran — coba lagi" {
		t.Errorf("error = %v", out["error"])
	}

	res, _ = f.do("POST", base+"/checkout", map[string]any{"items": []any{}})
	expectStatus(t, res, 400)
	expectJSON(t, res, `{"success":false,"error":"Data checkout tidak lengkap/valid"}`)
	res, _ = f.do("POST", "/api/public/shop/tidak-ada/checkout", body)
	expectStatus(t, res, 404)
	expectJSON(t, res, `{"success":false,"error":"Toko tidak ditemukan"}`)

	// The checkout limit is 10 per minute per IP (6 used above).
	for i := 0; i < 4; i++ {
		f.do("POST", "/api/public/shop/tidak-ada/checkout", body)
	}
	res, _ = f.do("POST", base+"/checkout", body)
	expectStatus(t, res, 429)
	expectJSON(t, res, `{"success":false,"error":"Too many requests"}`)
}

func TestCatalogAndProviderErrors(t *testing.T) {
	f := newFixture(t)
	slug := "go-" + testutil.RandomHex(4)
	f.exec(`INSERT INTO shop.storefronts (slug, name, description) VALUES ($1, 'Toko Go', NULL)`, slug)
	p := "6a1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f"
	f.catalog.products[p] = WebProduct{ID: p, Name: "Kaos", BasePrice: "50000"}
	over := "65000"
	f.svc.ports.Catalog = fakeCatalog{products: f.catalog.products, skus: []CatalogSKU{
		{ID: "s1", ProductID: p, SKU: "K-L", Name: "L", StockQuantity: "3"},
		{ID: "s2", ProductID: p, SKU: "K-XL", Name: "XL", PriceOverride: &over, StockQuantity: "2"},
	}}
	res, _ := f.do("GET", "/api/public/shop/"+strings.ToUpper(slug)+"/catalog", nil)
	expectStatus(t, res, 200)
	expectJSON(t, res, `{"success":true,"data":{"storefront":{"slug":"`+slug+`","name":"Toko Go","description":null},"products":[`+
		`{"id":"`+p+`","name":"Kaos","description":null,"longDescription":null,"imageUrl":null,"images":[],"price":50000,"weightGram":null,"stock":5,`+
		`"skus":[{"id":"s1","sku":"K-L","name":"L","price":50000,"stock":3},{"id":"s2","sku":"K-XL","name":"XL","price":65000,"stock":2}]}]}}`)

	// No API key: the provider's 503 reaches the client.
	res, _ = f.do("GET", "/api/public/shop/"+slug+"/shipping/areas?q=coblong", nil)
	expectStatus(t, res, 503)
	expectJSON(t, res, `{"success":false,"error":"BITESHIP_API_KEY belum dikonfigurasi di environment server"}`)
	res, _ = f.do("GET", "/api/public/shop/"+slug+"/shipping/areas?q=co", nil)
	expectJSON(t, res, `{"success":true,"data":[]}`)
}

func TestShippingSettingsAndManualShipment(t *testing.T) {
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	f := newFixture(t)
	res, body := f.staff("GET", "/api/shop/shipping/settings", nil)
	expectStatus(t, res, 200)
	settings := body["data"].(map[string]any)
	if settings["provider"] != "biteship" || settings["couriers"] != "jne,jnt,sicepat" || settings["markup_amount"] != "0.00" {
		t.Errorf("settings = %v", settings)
	}
	res, body = f.staff("PATCH", "/api/shop/shipping/settings", map[string]any{"provider": "RajaOngkir", "origin_postal_code": 40115, "markup_amount": "2000"})
	expectStatus(t, res, 200)
	settings = body["data"].(map[string]any)
	if settings["provider"] != "rajaongkir" || settings["origin_postal_code"] != "40115" || settings["markup_amount"] != "2000.00" {
		t.Errorf("patched = %v", settings)
	}
	res, _ = f.staff("PATCH", "/api/shop/shipping/settings", map[string]any{})
	expectStatus(t, res, 400)
	expectJSON(t, res, `{"success":false,"error":"Tidak ada field yang diubah"}`)

	// RajaOngkir cannot create shipments: provider mode is refused.
	id := f.order("paid")
	res, _ = f.staff("POST", "/api/shop/orders/"+id+"/shipment", map[string]any{"mode": "provider"})
	expectStatus(t, res, 400)
	expectJSON(t, res, `{"success":false,"error":"Provider aktif tidak mendukung pembuatan pengiriman — buat di aplikasi kurir lalu input resi manual"}`)
	res, _ = f.staff("POST", "/api/shop/orders/"+id+"/shipment", map[string]any{"mode": "manual", "waybill": "123"})
	expectStatus(t, res, 400)
	expectJSON(t, res, `{"success":false,"error":"Payload tidak valid"}`)

	res, _ = f.do("POST", "/api/shop/orders/"+id+"/shipment", map[string]any{"mode": "manual", "waybill": " JNE123456 "}, "X-Test-Staff", staff.UserID)
	expectStatus(t, res, 201)
	expectJSON(t, res, `{"success":true,"data":{"waybill":"JNE123456"}}`)
	if got := f.scalar(`SELECT status || '|' || waybill FROM shop.orders WHERE id = $1`, id); got != "shipped|JNE123456" {
		t.Errorf("order = %s", got)
	}
	if got := f.scalar(`SELECT provider || '|' || status || '|' || courier_code FROM shop.shipments WHERE order_id = $1`, id); got != "manual|in_transit|jne" {
		t.Errorf("shipment = %s", got)
	}
	res, _ = f.do("POST", "/api/shop/orders/"+id+"/shipment", map[string]any{"mode": "manual", "waybill": "JNE999999"}, "X-Test-Staff", staff.UserID)
	expectStatus(t, res, 400)
	expectJSON(t, res, `{"success":false,"error":"Pengiriman hanya untuk order yang sudah dibayar"}`)

	// POS session routes answer 401 for a missing session or menu.
	res, _ = f.do("POST", "/api/shop/shipping/rates", map[string]any{}, "X-Test-Forbid", "1")
	expectStatus(t, res, 401)
	expectJSON(t, res, `{"success":false,"error":"Authentication required"}`)
	res, _ = f.staff("POST", "/api/shop/shipping/rates", map[string]any{"destination_id": "1", "weight_gram": 0})
	expectJSON(t, res, `{"success":false,"error":"Berat (gram) wajib angka > 0 — isi berat produk di master"}`)
	res, _ = f.staff("GET", "/api/shop/shipping/track?waybill=x", nil)
	expectJSON(t, res, `{"success":false,"error":"Parameter waybill dan courier wajib diisi"}`)
}

func TestMarketplaceRoutes(t *testing.T) {
	f := newFixture(t)
	shopID := "go" + testutil.RandomHex(4)
	account := f.scalar(`INSERT INTO shop.marketplace_accounts (shop_id, status) VALUES ($1, 'disconnected') RETURNING id::text`, shopID)
	product := f.scalar(`INSERT INTO pos.pos_products (sku, name, product_kind) VALUES ($1, 'Kaos Go', 'merchandise') RETURNING id::text`, "GO-"+testutil.RandomHex(4))
	f.catalog.products[product] = WebProduct{ID: product, Name: "Kaos Go"}

	res, body := f.staff("POST", "/api/shop/marketplace/links", map[string]any{"account_id": account, "product_id": product, "marketplace_item_id": "111"})
	expectStatus(t, res, 201)
	linkID := body["data"].(map[string]any)["id"].(string)
	res, _ = f.staff("POST", "/api/shop/marketplace/links", map[string]any{"account_id": account, "product_id": product, "marketplace_item_id": "222"})
	expectStatus(t, res, 409)
	expectJSON(t, res, `{"success":false,"error":"Listing/produk ini sudah dipetakan"}`)
	res, _ = f.staff("POST", "/api/shop/marketplace/links", map[string]any{"account_id": account})
	expectJSON(t, res, `{"success":false,"error":"Payload tidak valid"}`)

	res, body = f.staff("GET", "/api/shop/marketplace/links?account_id="+account, nil)
	expectStatus(t, res, 200)
	links := body["data"].([]any)
	if len(links) != 1 || links[0].(map[string]any)["product_name"] != "Kaos Go" || links[0].(map[string]any)["sku_code"] != nil {
		t.Errorf("links = %v", links)
	}
	res, _ = f.staff("GET", "/api/shop/marketplace/links", nil)
	expectJSON(t, res, `{"success":false,"error":"account_id tidak valid"}`)

	res, body = f.staff("GET", "/api/shop/marketplace/accounts", nil)
	expectStatus(t, res, 200)
	found := false
	for _, a := range body["data"].([]any) {
		if row := a.(map[string]any); row["id"] == account {
			found = row["link_count"] == "1" && row["stock_buffer"] == 0.0
		}
	}
	if !found {
		t.Errorf("accounts = %v", body["data"])
	}
	res, _ = f.staff("PATCH", "/api/shop/marketplace/accounts", map[string]any{"id": account, "stock_buffer": 3})
	expectJSON(t, res, `{"success":true,"data":{"id":"`+account+`","status":"disconnected","stock_buffer":3}}`)

	res, _ = f.staff("POST", "/api/shop/marketplace/sync", map[string]any{"account_id": account})
	expectStatus(t, res, 400)
	expectJSON(t, res, `{"success":false,"error":"Akun terputus — hubungkan ulang"}`)
	f.env["MARKETPLACE_SYNC_TOKEN"] = "sync-secret"
	res, _ = f.do("POST", "/api/shop/marketplace/sync", "bukan-json", "x-sync-token", "sync-secret")
	expectJSON(t, res, `{"success":false,"error":"account_id tidak valid"}`)
	res, _ = f.do("POST", "/api/shop/marketplace/sync", map[string]any{"account_id": account}, "x-sync-token", "salah")
	expectStatus(t, res, 401)

	// Without partner credentials the callback lands back on the dashboard.
	res, _ = f.staff("GET", "/api/shop/marketplace/callback?code=abc&shop_id=1", nil)
	expectStatus(t, res, 307)
	if loc := res.Header().Get("Location"); loc != "http://example.com/dashboard/shop/marketplace?error=SHOPEE_PARTNER_ID%20belum%20dikonfigurasi%20di%20environment%20server" {
		t.Errorf("location = %s", loc)
	}
	res, _ = f.staff("GET", "/api/shop/marketplace/callback", nil)
	if loc := res.Header().Get("Location"); !strings.HasSuffix(loc, "?error=callback-kosong") {
		t.Errorf("location = %s", loc)
	}

	res, _ = f.staff("DELETE", "/api/shop/marketplace/links?id="+linkID, nil)
	expectJSON(t, res, `{"success":true}`)
}

func TestShopeeSignature(t *testing.T) {
	f := newFixture(t)
	f.env["SHOPEE_PARTNER_ID"], f.env["SHOPEE_PARTNER_KEY"] = "1001", "key"
	f.svc.now = func() time.Time { return time.Unix(1700000000, 0) }
	got, err := f.svc.AuthURL("https://app.example")
	if err != nil {
		t.Fatal(err)
	}
	// HMAC-SHA256("key", "1001/api/v2/shop/auth_partner1700000000") from Node.
	want := "https://partner.shopeemobile.com/api/v2/shop/auth_partner?partner_id=1001&timestamp=1700000000" +
		"&sign=729c637c8407ce87207f1b384fca5be7a3e2918552bc4fbbe4be02c2510a13a7" +
		"&redirect=https%3A%2F%2Fapp.example%2Fapi%2Fshop%2Fmarketplace%2Fcallback"
	if got != want {
		t.Errorf("auth url = %s", got)
	}
}
