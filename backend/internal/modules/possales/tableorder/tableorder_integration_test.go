package tableorder

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/modules/possales/tableorder/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Port of app/api/table-order/{orders,products,session}/route.test.ts
// against TEST_DATABASE_URL. Every write runs in one transaction that is
// rolled back; the member fixture comes from testutil. Cross-context ports
// with side effects outside the DB (XP, alerts) are fakes; Xendit is an
// httptest server.

type fakeLoyalty struct {
	ports.Loyalty
	arkDisabled bool
	awards      []ports.OrderXP
}

func (f *fakeLoyalty) AwardOrderXP(_ context.Context, _ database.Querier, in ports.OrderXP) (ports.XPAward, error) {
	f.awards = append(f.awards, in)
	return ports.XPAward{Status: "awarded", XPAwarded: 10}, nil
}

func (f *fakeLoyalty) ArkCoinEnabled(context.Context, database.Querier) bool { return !f.arkDisabled }

func (f *fakeLoyalty) CheckProductPrivileges(context.Context, database.Querier, []string, string) (bool, string, error) {
	return true, "", nil
}

type fakeCRM struct{ discount float64 }

func (f fakeCRM) MemberDiscountPercent(context.Context, database.Querier, string) float64 {
	return f.discount
}
func (fakeCRM) XPEnabled(context.Context, database.Querier) bool { return false }

type fakeAlerts struct {
	mu   sync.Mutex
	sent []domain.OrderAlert
}

func (f *fakeAlerts) OrderAlert(in domain.OrderAlert) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, in)
}

// fakeXendit serves the QR code API: created QRs are ACTIVE until paid.
type fakeXendit struct {
	mu      sync.Mutex
	fail    string // POST /qr_codes answers 500 with this message
	paid    bool
	created int
}

func (x *fakeXendit) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	x.mu.Lock()
	defer x.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/qr_codes":
		if x.fail != "" {
			w.WriteHeader(500)
			_ = json.NewEncoder(w).Encode(map[string]any{"message": x.fail})
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		x.created++
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "qr-1", "reference_id": body["reference_id"], "qr_string": "000201QRIS", "status": "ACTIVE",
			"amount": body["amount"], "expires_at": "2026-10-05T00:00:00Z",
		})
	case strings.HasSuffix(r.URL.Path, "/payments"):
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{}})
	case strings.HasPrefix(r.URL.Path, "/qr_codes/"):
		status := "ACTIVE"
		if x.paid {
			status = "SUCCEEDED"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "qr-1", "qr_string": "000201QRIS", "status": status, "amount": 33000})
	default:
		w.WriteHeader(404)
	}
}

type env struct {
	t       *testing.T
	ctx     context.Context
	tx      pgx.Tx
	mux     http.Handler
	loyalty *fakeLoyalty
	crm     *fakeCRM
	alerts  *fakeAlerts
	xendit  *fakeXendit
	member  testutil.Member
	replica func() http.Handler // a second API process on the same database

	latte, off, shot, double, oat string
}

type mod struct{ routes []module.Route }

func (mod) Name() string             { return "test" }
func (m mod) Routes() []module.Route { return m.routes }

func setup(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, nil)
	member := testutil.CreateMember(t)
	ctx := context.Background()
	tx, err := deps.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	e := &env{t: t, ctx: ctx, tx: tx, loyalty: &fakeLoyalty{}, crm: &fakeCRM{}, alerts: &fakeAlerts{}, xendit: &fakeXendit{}, member: member}
	srv := httptest.NewServer(e.xendit)
	t.Cleanup(srv.Close)
	ports := Ports{Loyalty: e.loyalty, CRM: e.crm, Alerts: e.alerts, Xendit: &Xendit{BaseURL: srv.URL, Client: srv.Client()}}
	e.mux = testutil.Mux(mod{newHandler(deps, ports, tx).Routes()})
	replicaDeps := deps
	replicaDeps.Events = nil // the outbox subscriptions are registered once
	e.replica = func() http.Handler { return testutil.Mux(mod{newHandler(replicaDeps, ports, tx).Routes()}) }

	// Venue billing: the system profile with PB1 10% always on.
	e.exec(`UPDATE pos.pos_billing_profiles SET is_active = false WHERE id <> 'b0000000-0000-4000-8000-000000000001'`)
	e.exec(`UPDATE pos.pos_billing_charges SET is_optional = false, is_enabled = true, rate = 10, name = 'PB1'
	  WHERE profile_id = 'b0000000-0000-4000-8000-000000000001' AND code = 'TAX'`)
	e.exec(`UPDATE pos.pos_billing_charges SET is_enabled = false
	  WHERE profile_id = 'b0000000-0000-4000-8000-000000000001' AND code <> 'TAX'`)
	e.exec(`UPDATE configuration.payment_gateways SET is_active = false WHERE provider = 'xendit'`)
	e.exec(`DELETE FROM configuration.app_settings WHERE key LIKE 'static_qris%'`)
	e.exec(`INSERT INTO pos.pos_tables (table_number, capacity, qr_code, name, area) VALUES ('T-01', 4, 'WIT-OFFICE-BDG', 'WIT. Office Bandung', 'Indoor')`)

	sku := "GOTEST-" + testutil.RandomHex(4)
	e.scalar(&e.latte, `INSERT INTO pos.pos_products (sku, name, base_price, xp_points, station) VALUES ($1, 'Iced Latte', 30000, 30, 'bar') RETURNING id::text`, sku)
	e.scalar(&e.off, `INSERT INTO pos.pos_products (sku, name, base_price, is_available) VALUES ($1, 'Habis', 5000, false) RETURNING id::text`, sku+"-off")
	e.exec(`INSERT INTO pos.pos_product_variants (product_id, name, group_name, price_adjustment, display_order) VALUES ($1, 'Regular', 'Size', 0, 1), ($1, 'Oat', 'Size', 10000, 2)`, e.latte)
	var shotGroup, milkGroup string
	e.scalar(&shotGroup, `INSERT INTO pos.pos_modifier_groups (name, min_selection, max_selection, display_order) VALUES ('Tambahan Espresso', 0, 1, 1) RETURNING id::text`)
	e.scalar(&milkGroup, `INSERT INTO pos.pos_modifier_groups (name, min_selection, max_selection, display_order) VALUES ('Pilihan Susu', 0, 1, 2) RETURNING id::text`)
	e.scalar(&e.shot, `INSERT INTO pos.pos_modifiers (group_id, name, price_adjustment, display_order) VALUES ($1, 'Extra Shot Espresso', 10000, 1) RETURNING id::text`, shotGroup)
	e.scalar(&e.double, `INSERT INTO pos.pos_modifiers (group_id, name, price_adjustment, display_order) VALUES ($1, 'Double Shot', 18000, 2) RETURNING id::text`, shotGroup)
	e.scalar(&e.oat, `INSERT INTO pos.pos_modifiers (group_id, name, price_adjustment) VALUES ($1, 'Oat Milk', 5000) RETURNING id::text`, milkGroup)
	e.exec(`INSERT INTO pos.pos_product_modifiers (product_id, modifier_group_id) VALUES ($1, $2), ($1, $3)`, e.latte, shotGroup, milkGroup)
	return e
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.tx.Exec(e.ctx, sql, args...); err != nil {
		e.t.Fatalf("exec %q: %v", sql, err)
	}
}

func (e *env) scalar(dst any, sql string, args ...any) {
	e.t.Helper()
	if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(dst); err != nil {
		e.t.Fatalf("query %q: %v", sql, err)
	}
}

func (e *env) enableXendit() {
	e.exec(`UPDATE configuration.payment_gateways SET is_active = true, secret_key = 'sk' WHERE provider = 'xendit'`)
}

// call serves a request (member true = with the portal session) and checks
// the status.
func (e *env) call(method, path string, body any, member bool, status int) map[string]any {
	e.t.Helper()
	r := testutil.Request(method, path, body)
	if member {
		r = testutil.AsMember(r, e.member)
	}
	rec, out := testutil.Do(e.t, e.mux, r)
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
	}
	return out
}

func (e *env) post(body map[string]any, member bool, status int) map[string]any {
	e.t.Helper()
	if !member {
		if _, ok := body["guest_phone"]; !ok {
			body["guest_phone"] = "081234567890"
		}
		if _, ok := body["guest_name"]; !ok {
			body["guest_name"] = "Budi"
		}
	}
	return e.call(http.MethodPost, "/api/table-order/orders", body, member, status)
}

func (e *env) orderCount() int {
	var n int
	e.scalar(&n, `SELECT count(*) FROM pos.pos_orders WHERE special_requests LIKE 'Self-service table order %' AND created_at = now()`)
	return n
}

func item(product string, kv ...any) map[string]any {
	m := map[string]any{"product_id": product, "quantity": 1}
	for i := 0; i < len(kv); i += 2 {
		m[kv[i].(string)] = kv[i+1]
	}
	return m
}

func data(out map[string]any) map[string]any { d, _ := out["data"].(map[string]any); return d }

func TestCreateOrderPricesFromServer(t *testing.T) {
	e := setup(t)
	variants := map[string]string{}
	rows, _ := e.tx.Query(e.ctx, `SELECT name, id::text FROM pos.pos_product_variants WHERE product_id = $1`, e.latte)
	for rows.Next() {
		var name, id string
		_ = rows.Scan(&name, &id)
		variants[name] = id
	}
	rows.Close()

	out := e.post(map[string]any{"table_code": "wit-office-bdg", "payment_method": "cashier", "items": []any{
		item(e.latte, "variant_id", variants["Oat"], "quantity", 2, "unit_price", 1),
		item(e.latte, "variant_id", variants["Regular"]),
	}}, false, 201)
	d := data(out)
	// (30.000+10.000)×2 + 30.000 = 110.000 ; PB1 10% = 11.000
	if d["subtotal"] != 110000.0 || d["tax_amount"] != 11000.0 || d["total_amount"] != 121000.0 || d["status"] != "pending" ||
		d["payment_status"] != "unpaid" || d["order_type"] != "dine_in" || d["table_code"] != "WIT-OFFICE-BDG" ||
		d["table_resolved"] != true || d["qris"] != nil || d["qris_error"] != nil || d["total_xp"] != 90.0 {
		t.Fatalf("data: %v", d)
	}
	if xp := d["crm_xp"].(map[string]any); xp["status"] != "skipped" || xp["reason"] != "payment_unpaid" {
		t.Fatalf("crm_xp: %v", xp)
	}
	items := d["items"].([]any)
	// variant_name repeats the first line of the product, as the TS find does.
	if first, second := items[0].(map[string]any), items[1].(map[string]any); first["variant_name"] != "Oat" || second["variant_name"] != "Oat" ||
		first["unit_price"] != 40000.0 || second["unit_price"] != 30000.0 || first["station"] != "bar" {
		t.Fatalf("items: %v", items)
	}
	breakdown, _ := json.Marshal(d["breakdown"])
	if string(breakdown) != `[{"amount":11000,"calc_method":"percent","code":"TAX","kind":"tax","name":"PB1","rate":10}]` {
		t.Fatalf("breakdown: %s", breakdown)
	}

	var customer, tableID, contact, notes, special *string
	var total float64
	e.scalar(&total, `SELECT total_amount::float8 FROM pos.pos_orders WHERE id = $1`, d["id"])
	if err := e.tx.QueryRow(e.ctx, `SELECT customer_id::text, table_id, contact_phone, notes, special_requests FROM pos.pos_orders WHERE id = $1`, d["id"]).
		Scan(&customer, &tableID, &contact, &notes, &special); err != nil {
		t.Fatal(err)
	}
	if total != 121000 || customer != nil || tableID == nil || *contact != "6281234567890" ||
		*notes != "Self-service table order WIT-OFFICE-BDG · Atas nama: Budi · WA 6281234567890" ||
		*special != "Self-service table order WIT-OFFICE-BDG; payment=cashier" {
		t.Fatalf("order row: %v %v %v %v %v", total, customer, tableID, deref(notes), deref(special))
	}
	var lines string
	e.scalar(&lines, `SELECT json_agg(json_build_object('u', unit_price::float8, 'q', quantity::float8, 's', station, 'xp', xp_earned, 'v', variants) ORDER BY unit_price DESC)::text
	  FROM pos.pos_order_items WHERE order_id = $1`, d["id"])
	if lines != `[{"u" : 40000, "q" : 2, "s" : "bar", "xp" : 60, "v" : [{"name": "Oat"}]}, {"u" : 30000, "q" : 1, "s" : "bar", "xp" : 30, "v" : [{"name": "Regular"}]}]` {
		t.Fatalf("items rows: %s", lines)
	}
	var history int
	e.scalar(&history, `SELECT count(*) FROM pos.pos_order_status_history WHERE order_id = $1 AND to_status = 'pending'`, d["id"])
	if history != 1 {
		t.Fatal("history row")
	}
}

func TestCreateOrderMemberDiscountAndAddOns(t *testing.T) {
	e := setup(t)
	e.crm.discount = 10
	d := data(e.post(map[string]any{"table_code": "T-01", "payment_method": "cashier", "items": []any{item(e.latte, "quantity", 2)}}, true, 201))
	// 60.000 − 10% (6.000) = 54.000 ; PB1 10% = 5.400
	if d["subtotal"] != 60000.0 || d["discount_amount"] != 6000.0 || d["tax_amount"] != 5400.0 || d["total_amount"] != 59400.0 {
		t.Fatalf("member: %v", d)
	}
	var customer string
	e.scalar(&customer, `SELECT customer_id::text FROM pos.pos_orders WHERE id = $1`, d["id"])
	if customer != e.member.CustomerID {
		t.Fatal("customer from session")
	}

	// Guests get no tier discount; add-on prices come from the catalog.
	d = data(e.post(map[string]any{"table_code": "T-01", "payment_method": "cashier", "items": []any{
		item(e.latte, "modifier_ids", []any{e.shot, e.oat}, "quantity", 2, "unit_price", 1),
	}}, false, 201))
	// (30.000 + 10.000 + 5.000) × 2 = 90.000 ; PB1 10% = 9.000
	if d["subtotal"] != 90000.0 || d["discount_amount"] != 0.0 || d["total_amount"] != 99000.0 {
		t.Fatalf("add-ons: %v", d)
	}
	var mods string
	e.scalar(&mods, `SELECT modifiers::text FROM pos.pos_order_items WHERE order_id = $1`, d["id"])
	if mods != `[{"name": "Extra Shot Espresso", "group": "Tambahan Espresso", "price": 10000}, {"name": "Oat Milk", "group": "Pilihan Susu", "price": 5000}]` {
		t.Fatalf("modifiers: %s", mods)
	}
	if len(e.alerts.sent) != 2 || e.alerts.sent[0].GuestName != "Go Test Member" || !e.alerts.sent[0].IsMember || e.alerts.sent[0].GuestPhone != e.member.Phone {
		t.Fatalf("member alert: %+v", e.alerts.sent)
	}
}

func TestCreateOrderRejections(t *testing.T) {
	e := setup(t)
	base := func(items ...any) map[string]any {
		return map[string]any{"table_code": "T-01", "payment_method": "cashier", "items": items}
	}
	foreign := "66666666-6666-4666-8666-666666666666"
	for name, c := range map[string]struct {
		body   map[string]any
		status int
		msg    string
	}{
		"foreign add-on":  {base(item(e.latte, "modifier_ids", []any{foreign})), 409, "Tambahan Iced Latte tidak dikenal — pilih ulang"},
		"group max":       {base(item(e.latte, "modifier_ids", []any{e.shot, e.double})), 409, "Tambahan Espresso: maksimal 1 pilihan"},
		"add-on not uuid": {base(item(e.latte, "modifier_ids", []any{"bukan-uuid"})), 400, "Data pesanan tidak valid"},
		"not sellable":    {base(item(e.off)), 409, "Ada menu yang sudah tidak tersedia — muat ulang daftar menu"},
		"unknown variant": {base(item(e.latte, "variant_id", "palsu")), 409, "Varian Iced Latte tidak dikenal — pilih ulang"},
		"VA method":       {map[string]any{"table_code": "T-01", "payment_method": "va", "items": []any{item(e.latte)}}, 400, "Data pesanan tidak valid"},
		"no items":        {base(), 400, "Data pesanan tidak valid"},
		"guest no phone":  {map[string]any{"table_code": "T-01", "payment_method": "cashier", "items": []any{item(e.latte)}, "guest_name": "Budi", "guest_phone": ""}, 400, "Masukkan nomor WhatsApp yang valid (contoh 0812xxxxxxx)"},
		"guest bad phone": {map[string]any{"table_code": "T-01", "payment_method": "cashier", "items": []any{item(e.latte)}, "guest_name": "Budi", "guest_phone": "12345"}, 400, "Masukkan nomor WhatsApp yang valid (contoh 0812xxxxxxx)"},
		"guest no name":   {map[string]any{"table_code": "T-01", "payment_method": "cashier", "items": []any{item(e.latte)}, "guest_name": "", "guest_phone": "081234567890"}, 400, "Masukkan nama pemesan (minimal 2 huruf)"},
		"ark no member":   {map[string]any{"table_code": "T-01", "payment_method": "ark_coin", "customer_id": e.member.CustomerID, "items": []any{item(e.latte)}}, 401, "Masuk sebagai member dulu untuk membayar dengan ARK Coin"},
		"qris no gateway": {map[string]any{"table_code": "T-01", "payment_method": "qris", "items": []any{item(e.latte)}}, 503, "QRIS belum tersedia di venue ini — pilih Bayar di Kasir"},
		"static off":      {map[string]any{"table_code": "T-01", "payment_method": "static_qris", "items": []any{item(e.latte)}}, 503, "Static QRIS belum tersedia di venue ini — pilih Bayar di Kasir"},
	} {
		if out := e.post(c.body, false, c.status); out["success"] != false || out["error"] != c.msg {
			t.Errorf("%s: %v", name, out)
		}
	}
	if n := e.orderCount(); n != 0 || len(e.alerts.sent) != 0 || e.xendit.created != 0 {
		t.Fatalf("rejected orders wrote %d orders, %d alerts", n, len(e.alerts.sent))
	}
	if out := e.call(http.MethodPost, "/api/table-order/orders", "{not json", false, 400); out["error"] != "Data pesanan tidak valid" {
		t.Fatal(out)
	}

	e.loyalty.arkDisabled = true
	out := e.post(map[string]any{"table_code": "T-01", "payment_method": "ark_coin", "items": []any{item(e.latte)}}, true, 409)
	if raw, _ := json.Marshal(out); string(raw) != `{"code":"ARK_COIN_DISABLED","error":"Fitur ARK Coin sedang dinonaktifkan di pengaturan CRM","success":false}` {
		t.Fatalf("ark disabled: %s", raw)
	}
}

func TestCreateOrderArkCoin(t *testing.T) {
	e := setup(t)
	e.exec(`UPDATE pos.pos_customers SET ark_coin_balance = 10000 WHERE id = $1`, e.member.CustomerID)
	out := e.post(map[string]any{"table_code": "T-01", "payment_method": "ark_coin", "items": []any{item(e.latte)}}, true, 400)
	if out["error"] != "Saldo ARK Coin tidak cukup" || e.orderCount() != 0 {
		t.Fatalf("insufficient: %v", out)
	}

	e.exec(`UPDATE pos.pos_customers SET ark_coin_balance = 100000 WHERE id = $1`, e.member.CustomerID)
	d := data(e.post(map[string]any{"table_code": "T-01", "payment_method": "ark_coin", "items": []any{item(e.latte)}}, true, 201))
	if d["payment_status"] != "paid" || d["status"] != "confirmed" || d["total_amount"] != 33000.0 {
		t.Fatalf("paid: %v", d)
	}
	if xp := d["crm_xp"].(map[string]any); xp["status"] != "awarded" || xp["xpAwarded"] != 10.0 {
		t.Fatalf("crm_xp: %v", xp)
	}
	if a := e.loyalty.awards; len(a) != 1 || a[0].PaymentMethod != "ark_coin" || a[0].TotalAmount != 33000 {
		t.Fatalf("xp award: %+v", a)
	}
	var balance, used float64
	var method string
	e.scalar(&balance, `SELECT ark_coin_balance::float8 FROM pos.pos_customers WHERE id = $1`, e.member.CustomerID)
	e.scalar(&used, `SELECT ark_coins_used::float8 FROM pos.pos_orders WHERE id = $1`, d["id"])
	e.scalar(&method, `SELECT payment_method FROM pos.pos_orders WHERE id = $1`, d["id"])
	if balance != 67000 || used != 33000 || method != "ark_coin" {
		t.Fatalf("debit: balance %v used %v method %s", balance, used, method)
	}
	var sale, journal string
	e.scalar(&sale, `SELECT payload->>'payment_method' || ':' || (payload->>'total_amount') || ':' || (payload->'items'->0->>'total_amount') FROM platform.outbox_events WHERE topic = 'pos.sale.completed' AND key = $1`, d["id"])
	e.scalar(&journal, `SELECT payload->>'user_id' FROM platform.outbox_events WHERE topic = 'pos.sale.settled' AND key = $1`, d["id"])
	if sale != "ark_coin:33000:30000" || journal != fallbackCashierID {
		t.Fatalf("events: sale %s journal %s", sale, journal)
	}
	var payload string
	e.scalar(&payload, `SELECT payload::text FROM platform.outbox_events WHERE topic = 'pos.customer_order.recorded' AND key = $1`, d["id"])
	if payload != `{"amount": 33000, "order_id": "`+d["id"].(string)+`", "customer_id": "`+e.member.CustomerID+`"}` {
		t.Fatalf("outbox: %s", payload)
	}
	if a := e.alerts.sent[0]; !a.Paid || a.PaymentLabel != "ARK Coin" {
		t.Fatalf("alert: %+v", a)
	}
}

func TestCreateOrderQrisAndStaticQris(t *testing.T) {
	e := setup(t)
	e.enableXendit()
	d := data(e.post(map[string]any{"table_code": "T-01", "order_type": "takeaway", "payment_method": "qris", "items": []any{item(e.latte)}}, false, 201))
	qr, _ := d["qris"].(map[string]any)
	if d["order_type"] != "takeaway" || d["payment_flow"] != "qris" || qr["qr_string"] != "000201QRIS" || qr["amount"] != 33000.0 ||
		qr["reference_id"] != "pos-ord-"+d["id"].(string) || qr["expires_at"] != "2026-10-05T00:00:00Z" {
		t.Fatalf("qris: %v", d)
	}
	var qrID, ext string
	e.scalar(&qrID, `SELECT xendit_qr_id FROM pos.pos_orders WHERE id = $1`, d["id"])
	e.scalar(&ext, `SELECT xendit_external_id FROM pos.pos_orders WHERE id = $1`, d["id"])
	if qrID != "qr-1" || ext != "pos-ord-"+d["id"].(string) {
		t.Fatalf("stored qr: %s %s", qrID, ext)
	}

	// The QR fails after the order exists: 201, paid at the cashier.
	e.xendit.fail = "Xendit timeout"
	d = data(e.post(map[string]any{"table_code": "T-01", "payment_method": "qris", "items": []any{item(e.latte)}}, false, 201))
	var special string
	e.scalar(&special, `SELECT special_requests FROM pos.pos_orders WHERE id = $1`, d["id"])
	if d["payment_flow"] != "cashier" || d["qris"] != nil || d["qris_error"] != "Xendit timeout" ||
		special != "Self-service table order T-01; payment=cashier (qris gagal)" || e.alerts.sent[1].PaymentLabel != "Bayar di kasir" {
		t.Fatalf("qris failure: %v %s", d, special)
	}

	e.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ('static_qris_enabled', 'true'), ('static_qris_image_url', '/api/files/payment-qris/q.png')`)
	d = data(e.post(map[string]any{"table_code": "WIT-OFFICE-BDG", "payment_method": "static_qris", "items": []any{item(e.latte)}}, false, 201))
	var method *string
	e.scalar(&special, `SELECT special_requests FROM pos.pos_orders WHERE id = $1`, d["id"])
	e.scalar(&method, `SELECT payment_method FROM pos.pos_orders WHERE id = $1`, d["id"])
	if d["payment_flow"] != "static_qris" || d["payment_status"] != "unpaid" || method != nil ||
		special != "Self-service table order WIT-OFFICE-BDG; payment=static_qris" {
		t.Fatalf("static qris: %v", d)
	}
}

func TestCreateOrderAlert(t *testing.T) {
	e := setup(t)
	d := data(e.post(map[string]any{"table_code": "WIT-OFFICE-BDG", "payment_method": "cashier", "customer_note": "less ice",
		"guest_name": " Budi ", "guest_phone": "0812-3456-7890",
		"items": []any{item(e.latte, "modifier_ids", []any{e.shot}, "quantity", 2)}}, false, 201))
	a := e.alerts.sent[0]
	if a.SourceLabel != "Self-order QR" || a.TableLabel != "WIT. Office Bandung" || a.PaymentLabel != "Bayar di kasir" || a.Paid ||
		a.GuestName != "Budi" || a.GuestPhone != "6281234567890" || a.CustomerNote != "less ice" || a.QueueNumber == "" ||
		a.ActionURL != "http://example.com/dashboard/pos/self-orders?order="+d["id"].(string) ||
		len(a.Items) != 1 || a.Items[0].Variant != "Regular" || a.Items[0].Quantity != 2 || a.Items[0].Modifiers[0] != "Extra Shot Espresso" {
		t.Fatalf("alert: %+v", a)
	}
}

func TestProductsAndSession(t *testing.T) {
	e := setup(t)
	out := e.call(http.MethodGet, "/api/table-order/products?search=iced", nil, false, 200)
	products := out["data"].([]any)
	if len(products) != 1 {
		t.Fatalf("search: %v", products)
	}
	p := products[0].(map[string]any)
	raw, _ := json.Marshal(p["variants"])
	if p["name"] != "Iced Latte" || p["price"] != 30000.0 || p["stationLabel"] != "Bar" || p["customizable"] != true ||
		p["categoryName"] != "Lainnya" || string(raw) != `[{"id":"`+p["variants"].([]any)[0].(map[string]any)["id"].(string)+`","name":"Regular","priceAdjustment":0},{"id":"`+p["variants"].([]any)[1].(map[string]any)["id"].(string)+`","name":"Oat","priceAdjustment":10000}]` ||
		len(p["modifierGroups"].([]any)) != 2 {
		t.Fatalf("product: %v", p)
	}
	if cats := out["categories"].([]any); len(cats) != 1 || cats[0].(map[string]any)["id"] != "__lainnya" {
		t.Fatalf("categories: %v", cats)
	}
	if meta := out["meta"].(map[string]any); meta["total_products"].(float64) < 2 || meta["hidden_unavailable"].(float64) < 1 {
		t.Fatalf("meta: %v", meta)
	}

	if out := e.call(http.MethodGet, "/api/table-order/session/%20", nil, false, 400); out["error"] != "Kode meja wajib diisi" {
		t.Fatal(out)
	}
	d := data(e.call(http.MethodGet, "/api/table-order/session/wit-office-bdg", nil, true, 200))
	if d["table_resolved"] != true || d["table_label"] != "WIT. Office Bandung" || d["table_area"] != "Indoor" || d["status"] != "available" ||
		d["member_logged_in"] != true || d["ark_enabled"] != true || d["xp_enabled"] != false || d["qris_available"] != false ||
		d["static_qris_image_url"] != nil || d["ark_rate"] != 1000.0 || d["billing"].(map[string]any)["profile"] != "System Default" {
		t.Fatalf("session: %v", d)
	}
	raw, _ = json.Marshal(d["billing"].(map[string]any)["charges"])
	if string(raw) != `[{"amount":0,"apply_order":200,"base":"subtotal_after_discount","calc_method":"percent","charge_kind":"tax","code":"TAX","id":"b0000000-0000-4000-8000-000000000011","is_enabled":true,"is_optional":false,"name":"PB1","rate":10}]` {
		t.Fatalf("charges: %s", raw)
	}
	d = data(e.call(http.MethodGet, "/api/table-order/session/z9", nil, false, 200))
	if d["table_id"] != nil || d["table_code"] != "Z9" || d["table_label"] != "Z9" || d["table_resolved"] != false || d["member_logged_in"] != false {
		t.Fatalf("unknown table: %v", d)
	}
}

func TestOrderStatus(t *testing.T) {
	e := setup(t)
	if out := e.call(http.MethodGet, "/api/table-order/orders/abc", nil, false, 400); out["error"] != "Order tidak valid" {
		t.Fatal(out)
	}
	if out := e.call(http.MethodGet, "/api/table-order/orders/11111111-1111-4111-8111-111111111111", nil, false, 404); out["error"] != "Order tidak ditemukan" {
		t.Fatal(out)
	}

	created := data(e.post(map[string]any{"table_code": "T-01", "payment_method": "cashier", "items": []any{item(e.latte, "modifier_ids", []any{e.shot})}}, false, 201))
	d := data(e.call(http.MethodGet, "/api/table-order/orders/"+created["id"].(string), nil, false, 200))
	it := d["items"].([]any)[0].(map[string]any)
	if d["payment_flow"] != "cashier" || d["payment_method"] != nil || d["total_amount"] != 44000.0 || d["total_xp"] != 30.0 ||
		d["qris"] != nil || d["qris_status"] != nil || it["variant_name"] != "Regular" || it["modifier_names"].([]any)[0] != "Extra Shot Espresso" ||
		it["quantity"] != 1.0 || it["kitchen_status"] != "pending" || !strings.HasSuffix(d["ordered_at"].(string), "Z") {
		t.Fatalf("status: %v", d)
	}
	if raw, _ := json.Marshal(d["breakdown"]); string(raw) != `[{"amount":4000,"calc_method":"percent","code":"TAX","kind":"tax","name":"PB1","rate":10}]` {
		t.Fatalf("breakdown: %s", raw)
	}

	// QRIS: unpaid → the QR comes back with qr=1; paid → settled by the poll.
	e.enableXendit()
	qrOrder := data(e.post(map[string]any{"table_code": "T-01", "payment_method": "qris", "items": []any{item(e.latte)}}, true, 201))
	path := "/api/table-order/orders/" + qrOrder["id"].(string)
	d = data(e.call(http.MethodGet, path+"?qr=1", nil, false, 200))
	if d["qris_status"] != "ACTIVE" || d["qris"].(map[string]any)["qr_string"] != "000201QRIS" || d["payment_status"] != "unpaid" || d["qris_check_error"] != nil {
		t.Fatalf("unpaid qris: %v", d)
	}
	e.xendit.paid = true
	d = data(e.call(http.MethodGet, path, nil, false, 200))
	if d["qris_status"] != "SUCCEEDED" || d["payment_status"] != "paid" || d["payment_method"] != "qris" || d["payment_flow"] != "qris" || d["qris"] != nil {
		t.Fatalf("settled: %v", d)
	}
	var sale string
	e.scalar(&sale, `SELECT payload->>'payment_method' FROM platform.outbox_events WHERE topic = 'pos.sale.completed' AND key = $1`, qrOrder["id"])
	if sale != "qris" {
		t.Fatalf("settle sale event: %q", sale)
	}
	var events int
	e.scalar(&events, `SELECT count(*) FROM platform.outbox_events WHERE topic = 'pos.customer_order.recorded' AND key = $1`, qrOrder["id"])
	if events != 1 {
		t.Fatal("settle stats event")
	}
	// Settled once: a second poll is a no-op.
	e.call(http.MethodGet, path, nil, false, 200)
	e.scalar(&events, `SELECT count(*) FROM platform.outbox_events WHERE topic = 'pos.sale.completed' AND key = $1`, qrOrder["id"])
	if events != 1 {
		t.Fatal("settled twice")
	}
}

func TestStatusRateLimit(t *testing.T) {
	e := setup(t)
	path := "/api/table-order/orders/11111111-1111-4111-8111-111111111111"
	for i := 0; i < 90; i++ {
		e.call(http.MethodGet, path, nil, false, 404)
	}
	if out := e.call(http.MethodGet, path, nil, false, 429); out["error"] != "Terlalu sering — tunggu sebentar" {
		t.Fatal(out)
	}
	e.mux = e.replica()
	if out := e.call(http.MethodGet, path, nil, false, 429); out["error"] != "Terlalu sering — tunggu sebentar" {
		t.Fatalf("the other replica: %v", out)
	}
}
