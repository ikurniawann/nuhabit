package settings_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/configuration/settings"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/whatsapp"
)

type mod []module.Route

func (m mod) Name() string           { return "configuration" }
func (m mod) Routes() []module.Route { return m }

var fixedNow = time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)

// env mounts the routes on a rolled-back transaction. Each request runs in
// a savepoint that is rolled back when it answers 4xx/5xx, so a statement
// the TS lets PostgreSQL reject does not abort the rest of the test.
// Create staff before newEnv: cleanups run in reverse, so the rollback
// releases the transaction's locks before the staff rows are deleted.
type env struct {
	t     *testing.T
	tx    pgx.Tx
	deps  module.Deps
	ports settings.Ports
}

func newEnv(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return fixedNow })
	tx := testutil.Tx(t)
	ports := app.ConfigurationPorts(deps).Settings
	wa := whatsapp.New(deps.Log)
	wa.Getenv = func(string) string { return "" }
	ports.WhatsApp = wa
	e := &env{t: t, tx: tx, deps: deps, ports: ports}
	e.exec(`DELETE FROM configuration.app_settings WHERE key LIKE ANY(ARRAY['company_%', 'sales_target_config',
		'static_qris_%', 'tts_%', 'openai_%', 'azure_speech_%', 'elevenlabs_api_key', 'telegram_%', 'wa_gateway_%',
		'order_alert_config'])`)
	return e
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.tx.Exec(context.Background(), sql, args...); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
}

func (e *env) text(sql string, args ...any) string {
	e.t.Helper()
	var s string
	if err := e.tx.QueryRow(context.Background(), sql, args...).Scan(&s); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
	return s
}

func (e *env) setting(key, value string) {
	e.t.Helper()
	e.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, key, value)
}

type resp struct {
	Status int
	Raw    string
}

func (r resp) json(t *testing.T) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(r.Raw), &m); err != nil {
		t.Fatalf("not JSON: %s", r.Raw)
	}
	return m
}

func (e *env) do(s *testutil.Staff, method, path string, body any) resp {
	e.t.Helper()
	ctx := context.Background()
	sp, err := e.tx.Begin(ctx)
	if err != nil {
		e.t.Fatal(err)
	}
	mux := testutil.Mux(mod(settings.Routes(e.deps, sp, e.ports)))
	r := testutil.Request(method, path, body)
	if s != nil {
		r = testutil.AsStaff(r, *s)
	}
	rec, _ := testutil.Do(e.t, mux, r)
	if rec.Code >= 400 {
		err = sp.Rollback(ctx)
	} else {
		err = sp.Commit(ctx)
	}
	if err != nil {
		e.t.Fatal(err)
	}
	return resp{rec.Code, rec.Body.String()}
}

func expect(t *testing.T, r resp, status int, raw string) {
	t.Helper()
	if r.Status != status || (raw != "" && r.Raw != raw) {
		t.Fatalf("got %d %s\nwant %d %s", r.Status, r.Raw, status, raw)
	}
}

func staff(t *testing.T, menus ...string) testutil.Staff {
	m := map[string][]string{}
	for _, code := range menus {
		m[code] = nil
	}
	return testutil.CreateStaff(t, testutil.StaffOptions{Menus: m})
}

const (
	unauthorized = `{"success":false,"error":"Authentication required"}`
	forbidden    = `{"success":false,"error":"Insufficient permissions"}`
	serverError  = `{"success":false,"error":"Terjadi kesalahan server"}`
)

func TestGuards(t *testing.T) {
	outsider := staff(t, "settings.roles")
	e := newEnv(t)
	for _, rt := range []struct{ method, path string }{
		{"GET", "/api/settings/company-profile"}, {"PUT", "/api/settings/company-profile"},
		{"GET", "/api/settings/sales-target"}, {"PUT", "/api/settings/sales-target"},
		{"GET", "/api/settings/static-qris"}, {"PUT", "/api/settings/static-qris"},
		{"GET", "/api/settings/tts"}, {"PUT", "/api/settings/tts"}, {"POST", "/api/settings/tts/preview"},
		{"PUT", "/api/settings/appearance"},
		{"GET", "/api/settings/business"}, {"POST", "/api/settings/business"},
		{"PATCH", "/api/settings/business/holding/x"}, {"DELETE", "/api/settings/business/holding/x"},
		{"GET", "/api/settings/receipt"}, {"PUT", "/api/settings/receipt"},
		{"GET", "/api/settings/order-alerts"}, {"PUT", "/api/settings/order-alerts"}, {"POST", "/api/settings/order-alerts"},
	} {
		expect(t, e.do(nil, rt.method, rt.path, map[string]any{}), 401, unauthorized)
		expect(t, e.do(&outsider, rt.method, rt.path, map[string]any{}), 403, forbidden)
	}
}

func TestCompanyProfileSalesTargetStaticQris(t *testing.T) {
	admin := staff(t, "settings.business", "settings.payment-gateways")
	e := newEnv(t)

	expect(t, e.do(&admin, "GET", "/api/settings/company-profile", nil), 200,
		`{"data":{"legal_name":null,"address":null,"city":null,"signer_name":null,"signer_title":null}}`)
	expect(t, e.do(&admin, "PUT", "/api/settings/company-profile", "{bad"), 500, serverError)
	expect(t, e.do(&admin, "PUT", "/api/settings/company-profile", map[string]any{"legal_name": 5, "city": strings.Repeat("x", 501)}), 400,
		`{"success":false,"error":"Validation failed","details":[{"code":"invalid_type","path":["legal_name"],"message":"Invalid input: expected string, received number"},{"code":"too_big","path":["city"],"message":"Too big: expected string to have <=500 characters"}]}`)
	e.setting("company_city", "Bandung")
	expect(t, e.do(&admin, "PUT", "/api/settings/company-profile",
		map[string]any{"legal_name": "  PT Sulu  ", "address": "", "signer_name": "   ", "signer_title": nil}), 200,
		`{"message":"Profil perusahaan tersimpan"}`)
	expect(t, e.do(&admin, "GET", "/api/settings/company-profile", nil), 200,
		`{"data":{"legal_name":"PT Sulu","address":null,"city":"Bandung","signer_name":"","signer_title":null}}`)

	expect(t, e.do(&admin, "GET", "/api/settings/sales-target", nil), 200, `{"data":{"config":{"harianRp":0,"bulananRp":0}}}`)
	expect(t, e.do(&admin, "PUT", "/api/settings/sales-target", map[string]any{"harianRp": "abc"}), 400,
		`{"success":false,"error":"Nilai target tidak valid (angka Rp, maksimal 100 M)"}`)
	expect(t, e.do(&admin, "PUT", "/api/settings/sales-target", "null"), 500, serverError)
	expect(t, e.do(&admin, "PUT", "/api/settings/sales-target", map[string]any{"bulananRp": "Rp 90.000.000"}), 200,
		`{"data":{"config":{"harianRp":0,"bulananRp":90000000}}}`)
	expect(t, e.do(&admin, "PUT", "/api/settings/sales-target", "{bad"), 200,
		`{"data":{"config":{"harianRp":0,"bulananRp":90000000}}}`)
	expect(t, e.do(&admin, "PUT", "/api/settings/sales-target", map[string]any{"harianRp": 1500000.4}), 200,
		`{"data":{"config":{"harianRp":1500000,"bulananRp":90000000}}}`)
	if got := e.text(`SELECT value FROM configuration.app_settings WHERE key = 'sales_target_config'`); got != `{"harianRp":1500000,"bulananRp":90000000}` {
		t.Fatalf("stored %s", got)
	}

	const off = `{"success":true,"data":{"enabled":false,"imageUrl":null,"available":false}}`
	expect(t, e.do(&admin, "GET", "/api/settings/static-qris", nil), 200, off)
	expect(t, e.do(&admin, "PUT", "/api/settings/static-qris", map[string]any{"enabled": "yes"}), 400,
		`{"success":false,"error":"Data tidak valid"}`)
	expect(t, e.do(&admin, "PUT", "/api/settings/static-qris", "{bad"), 400, `{"success":false,"error":"Data tidak valid"}`)
	expect(t, e.do(&admin, "PUT", "/api/settings/static-qris", map[string]any{"enabled": true}), 400,
		`{"success":false,"error":"Unggah gambar QRIS dulu sebelum mengaktifkan"}`)
	e.setting("static_qris_image_url", " /api/files/payment-qris/a.png ")
	expect(t, e.do(&admin, "PUT", "/api/settings/static-qris", map[string]any{"enabled": true}), 200,
		`{"success":true,"data":{"enabled":true,"imageUrl":"/api/files/payment-qris/a.png","available":true}}`)
	expect(t, e.do(&admin, "PUT", "/api/settings/static-qris", map[string]any{"enabled": false}), 200,
		`{"success":true,"data":{"enabled":false,"imageUrl":"/api/files/payment-qris/a.png","available":false}}`)
}
