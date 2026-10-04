package settings

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Every write runs in one rolled-back transaction. The guard reads test
// headers: X-Role is the user's role, X-Menu grants the menu prefix; the
// real guard is covered in internal/app.

type headerGuard struct{}

func (headerGuard) RequireUser(r *http.Request) (*auth.User, error) {
	if r.Header.Get("X-Role") == "" {
		return nil, httpx.Unauthorized("")
	}
	return &auth.User{ID: "00000000-0000-0000-0000-000000000001", Role: r.Header.Get("X-Role")}, nil
}

func (g headerGuard) RequireMenuPrefix(r *http.Request, _ ...string) (*auth.User, error) {
	u, err := g.RequireUser(r)
	if err == nil && r.Header.Get("X-Menu") == "" {
		return nil, httpx.Forbidden("Insufficient permissions")
	}
	return u, err
}

type routes []module.Route

func (r routes) Name() string           { return "settings-test" }
func (r routes) Routes() []module.Route { return r }

type fakeMessages struct {
	outbound *OutboundMessage
	result   SendResult
	resent   []string
	marked   []string
}

func (f *fakeMessages) List(context.Context, database.Querier, MessageFilter) ([]MessageRow, MessageSummary, error) {
	return []MessageRow{}, MessageSummary{TotalOut: 1}, nil
}

func (f *fakeMessages) Outbound(context.Context, database.Querier, string) (*OutboundMessage, error) {
	return f.outbound, nil
}

func (f *fakeMessages) Resend(_ context.Context, _ database.DB, m OutboundMessage, by string) SendResult {
	f.resent = append(f.resent, m.ID+"/"+by)
	return f.result
}

func (f *fakeMessages) MarkResent(_ context.Context, _ database.Querier, id string) error {
	f.marked = append(f.marked, id)
	return nil
}

type fakeFlash struct{}

func (fakeFlash) Gather(_ context.Context, _ database.Querier, date string) (domain.FlashReportData, error) {
	return domain.FlashReportData{GuestCount: 2, NettSales: 100000}, nil
}

type fixture struct {
	t   *testing.T
	tx  pgx.Tx
	mux *http.ServeMux
	msg *fakeMessages
	env map[string]string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	f := &fixture{t: t, tx: tx, msg: &fakeMessages{}, env: map[string]string{}}
	now := func() time.Time { return time.Date(2026, 10, 4, 7, 30, 0, 0, time.UTC) }
	h := NewHandler(tx, headerGuard{}, Ports{Messages: f.msg, Flash: fakeFlash{}}, now,
		slog.New(slog.NewTextHandler(io.Discard, nil)), func(k string) string { return f.env[k] })
	f.mux = testutil.Mux(routes(h.Routes()))
	// Start from a known state: the keys these tests touch are cleared.
	f.exec(`DELETE FROM configuration.app_settings WHERE key = ANY($1)`, []string{
		"deepseek_api_key", "deepseek_model", "deepseek_base_url", "openai_api_key", "openai_model", "openai_base_url",
		"google_bp_client_id", "google_bp_client_secret", "google_bp_refresh_token", "google_bp_account_id", "google_bp_location_id",
		"ig_app_secret", "ig_verify_token", "ig_access_token", "ig_account_id", "wa_gateway_url", "wa_gateway_token",
		"wa_notif_config", "pos_shift_report_wa_recipients"})
	return f
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f *fixture) setting(key string) *string {
	f.t.Helper()
	var v *string
	err := f.tx.QueryRow(context.Background(), `SELECT value FROM configuration.app_settings WHERE key = $1`, key).Scan(&v)
	if err != nil && !database.IsNoRows(err) {
		f.t.Fatal(err)
	}
	return v
}

type response struct {
	Status int
	Body   map[string]any
	Raw    string
}

func (r response) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }

// do sends body (a string is sent raw) as role ("" = anonymous); menu
// grants the IAM prefix.
func (f *fixture) do(method, target string, body any, role string, menu bool) response {
	f.t.Helper()
	r := testutil.Request(method, target, body)
	if role != "" {
		r.Header.Set("X-Role", role)
	}
	if menu {
		r.Header.Set("X-Menu", "1")
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, r)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return response{rec.Code, out, rec.Body.String()}
}

func (f *fixture) admin(method, target string, body any) response {
	return f.do(method, target, body, "super_admin", false)
}

func (f *fixture) staff(method, target string, body any) response {
	return f.do(method, target, body, "admin", true)
}

func expect(t *testing.T, res response, status int, raw string) {
	t.Helper()
	if res.Status != status || (raw != "" && res.Raw != raw) {
		t.Fatalf("got %d %s, want %d %s", res.Status, res.Raw, status, raw)
	}
}

func TestProviders(t *testing.T) {
	f := newFixture(t)
	expect(t, f.do("GET", "/api/settings/integrations", nil, "admin", false), 403, `{"success":false,"error":"Insufficient permissions"}`)
	expect(t, f.staff("GET", "/api/settings/integrations", nil), 200,
		`{"data":{"deepseek":{"api_key_masked":null,"has_api_key":false,"model":"deepseek-chat","base_url":"https://api.deepseek.com"},"openai":{"api_key_masked":null,"has_api_key":false,"model":"gpt-4o-mini","base_url":"https://api.openai.com/v1"}}}`)
	expect(t, f.staff("PUT", "/api/settings/integrations", map[string]any{
		"api_key": " sk-abcdefghijkl ", "model": " deepseek-x ", "base_url": "https://api.x.com//",
		"openai": map[string]any{"api_key": "op-123456789", "model": "gpt-5"},
	}), 200, `{"message":"Konfigurasi tersimpan"}`)
	expect(t, f.staff("GET", "/api/settings/integrations", nil), 200,
		`{"data":{"deepseek":{"api_key_masked":"sk-a••••••••ijkl","has_api_key":true,"model":"deepseek-x","base_url":"https://api.x.com"},"openai":{"api_key_masked":"op-1••••••••6789","has_api_key":true,"model":"gpt-5","base_url":"https://api.openai.com/v1"}}}`)

	// DeepSeek is saved before the OpenAI object is rejected, as in the TS.
	expect(t, f.staff("PUT", "/api/settings/integrations", map[string]any{"api_key": "", "openai": 5}), 400,
		`{"success":false,"error":"openai tidak valid"}`)
	if f.setting("deepseek_api_key") != nil {
		t.Error("empty api_key must delete the key")
	}
	expect(t, f.staff("PUT", "/api/settings/integrations", map[string]any{"openai": map[string]any{"base_url": "ftp://x"}}), 400,
		`{"success":false,"error":"openai: base_url tidak valid"}`)
	expect(t, f.staff("PUT", "/api/settings/integrations", "{bukan json"), 500, `{"success":false,"error":"Terjadi kesalahan server"}`)
}

func TestGoogleBusiness(t *testing.T) {
	f := newFixture(t)
	expect(t, f.staff("GET", "/api/settings/google-business", nil), 403, `{"success":false,"error":"Insufficient permissions"}`)
	expect(t, f.admin("PUT", "/api/settings/google-business", map[string]any{"client_id": 5}), 400, `{"success":false,"error":"Payload tidak valid"}`)
	expect(t, f.admin("PUT", "/api/settings/google-business", map[string]any{
		"client_id": " cid ", "account_id": "/123/", "location_id": "1, locations/2;1", "client_secret": "secret-value-123", "refresh_token": "",
	}), 200, `{"success":true}`)
	expect(t, f.admin("GET", "/api/settings/google-business", nil), 200,
		`{"success":true,"data":{"client_id":"cid","account_id":"accounts/123","location_id":"locations/1,locations/2","has_client_secret":true,"client_secret_masked":"secr••••••••-123","has_refresh_token":false,"refresh_token_masked":null,"configured":false}}`)
	// An empty secret keeps the stored one.
	expect(t, f.admin("PUT", "/api/settings/google-business", map[string]any{"client_secret": "", "refresh_token": "rt-1234567890"}), 200, "")
	if got := f.admin("GET", "/api/settings/google-business", nil).data(); got["configured"] != true || got["has_client_secret"] != true {
		t.Errorf("after refresh token: %v", got)
	}
	expect(t, f.admin("DELETE", "/api/settings/google-business", nil), 200, `{"success":true}`)
	if f.setting("google_bp_client_secret") != nil || f.setting("google_bp_client_id") != nil {
		t.Error("DELETE must clear the credentials")
	}
}

func TestInstagram(t *testing.T) {
	f := newFixture(t)
	expect(t, f.admin("PUT", "/api/settings/instagram", map[string]any{"verify_token": "verify-me", "app_secret": "app-secret-xyz"}), 200, `{"success":true}`)
	expect(t, f.admin("GET", "/api/settings/instagram", nil), 200,
		`{"success":true,"data":{"verify_token":"verify-me","account_id":"","has_app_secret":true,"app_secret_masked":"app-••••••••-xyz","has_access_token":false,"access_token_masked":null,"webhook_ready":true,"configured":false}}`)
	expect(t, f.admin("PUT", "/api/settings/instagram", map[string]any{"access_token": strings.Repeat("x", 1001)}), 400, `{"success":false,"error":"Payload tidak valid"}`)
	expect(t, f.admin("DELETE", "/api/settings/instagram", nil), 200, `{"success":true}`)
	if f.setting("ig_app_secret") != nil {
		t.Error("DELETE must clear")
	}
}

func TestPaymentGateways(t *testing.T) {
	f := newFixture(t)
	f.exec(`INSERT INTO configuration.payment_gateways (provider, display_name, is_active, environment, metadata)
		VALUES ('xendit', 'Xendit', false, 'sandbox', '{"docs":"x"}'), ('midtrans', 'Midtrans', false, 'sandbox', '{"coming_soon":true}')
		ON CONFLICT (provider) DO UPDATE SET display_name = EXCLUDED.display_name, is_active = false, environment = 'sandbox',
		  secret_key = NULL, public_key = NULL, webhook_secret = NULL, callback_url = NULL, metadata = EXCLUDED.metadata`)
	list := f.do("GET", "/api/settings/payment-gateways", nil, "admin", true)
	items, _ := list.Body["data"].([]any)
	if list.Status != 200 || len(items) != 2 || items[0].(map[string]any)["provider"] != "midtrans" || items[0].(map[string]any)["coming_soon"] != true {
		t.Fatalf("list = %s", list.Raw)
	}
	put := func(body map[string]any) response {
		return f.do("PUT", "/api/settings/payment-gateways", body, "admin", true)
	}
	expect(t, put(map[string]any{"provider": "midtrans", "is_active": true, "environment": "sandbox"}), 400,
		`{"success":false,"error":"Midtrans belum tersedia (coming soon)"}`)
	expect(t, put(map[string]any{"provider": "xendit", "is_active": true, "environment": "live"}), 400,
		`{"success":false,"error":"Secret key wajib diisi sebelum mengaktifkan gateway"}`)
	bad := put(map[string]any{"provider": "stripe", "is_active": "ya", "environment": "live"})
	if bad.Status != 400 || bad.Body["error"] != "Validation failed" || len(bad.Body["details"].([]any)) != 2 {
		t.Fatalf("validation = %s", bad.Raw)
	}
	ok := put(map[string]any{"provider": "xendit", "is_active": true, "environment": "live", "secret_key": " xnd_development_abcdef ",
		"webhook_secret": "cb-token-123", "callback_url": "  ", "display_name": " Xendit QRIS "})
	d := ok.data()
	if ok.Status != 200 || ok.Body["message"] != "Payment gateway settings saved" || d["secret_key_masked"] != "xnd_********cdef" ||
		d["webhook_secret_masked"] != "cb-t****-123" || d["has_public_key"] != false || d["callback_url"] != nil ||
		d["display_name"] != "Xendit QRIS" || d["environment"] != "live" || d["is_active"] != true {
		t.Fatalf("save = %s", ok.Raw)
	}
	// A masked secret keeps the stored one.
	put(map[string]any{"provider": "xendit", "is_active": true, "environment": "live", "secret_key": "xnd_********cdef"})
	var secret string
	_ = f.tx.QueryRow(context.Background(), `SELECT secret_key FROM configuration.payment_gateways WHERE provider = 'xendit'`).Scan(&secret)
	if secret != "xnd_development_abcdef" {
		t.Errorf("secret = %q", secret)
	}
}

// fakeGateway is services/wa-gateway: /health, /qr and /send.
type fakeGateway struct {
	*httptest.Server
	mu        sync.Mutex
	connected bool
	sent      []string
}

func newFakeGateway(t *testing.T) *fakeGateway {
	g := &fakeGateway{}
	g.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-gateway-token") != "tok-123456789" {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
			return
		}
		g.mu.Lock()
		defer g.mu.Unlock()
		switch r.URL.Path {
		case "/health":
			_, _ = w.Write([]byte(`{"connected":` + map[bool]string{true: "true", false: "false"}[g.connected] + `,"phone":null,"needsPairing":true}`))
		case "/qr":
			_, _ = w.Write([]byte(`{"qr":"2@pairing"}`))
		case "/send":
			var body struct{ Target, Message string }
			_ = json.NewDecoder(r.Body).Decode(&body)
			g.sent = append(g.sent, body.Target+": "+body.Message)
			if body.Target == "6281200000002" {
				w.WriteHeader(500)
				_, _ = w.Write([]byte(`{"error":"Nomor tidak terdaftar"}`))
				return
			}
			_, _ = w.Write([]byte(`{"messageId":"m-1"}`))
		}
	}))
	t.Cleanup(g.Close)
	return g
}

func TestWaGateway(t *testing.T) {
	f := newFixture(t)
	expect(t, f.staff("GET", "/api/settings/wa-gateway", nil), 403, "")
	expect(t, f.admin("GET", "/api/settings/wa-gateway", nil), 200,
		`{"success":true,"data":{"configured":false,"status":null,"qr":null,"settings":{"url":"","token_masked":null,"token_from_env":false}}}`)
	expect(t, f.admin("PATCH", "/api/settings/wa-gateway", map[string]any{"url": "ftp://x"}), 400,
		`{"success":false,"error":"URL harus diawali http:// atau https://"}`)
	expect(t, f.admin("PATCH", "/api/settings/wa-gateway", map[string]any{"token": 5}), 400, `{"success":false,"error":"Payload tidak valid"}`)

	// Token from the env only, gateway down.
	f.env["WA_GATEWAY_TOKEN"] = "env-token"
	f.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ('wa_gateway_url', 'http://127.0.0.1:1')`)
	expect(t, f.admin("GET", "/api/settings/wa-gateway", nil), 200,
		`{"success":true,"data":{"configured":true,"reachable":false,"status":null,"qr":null,"settings":{"url":"http://127.0.0.1:1","token_masked":null,"token_from_env":true}}}`)

	g := newFakeGateway(t)
	expect(t, f.admin("PATCH", "/api/settings/wa-gateway", map[string]any{"url": " " + g.URL + " ", "token": "tok-123456789"}), 200,
		`{"success":true,"data":{"configured":true,"reachable":true,"status":{"connected":false,"phone":null,"needsPairing":true}}}`)
	got := f.admin("GET", "/api/settings/wa-gateway", nil)
	expect(t, got, 200, `{"success":true,"data":{"configured":true,"reachable":true,"status":{"connected":false,"phone":null,"needsPairing":true},"qr":"2@pairing","settings":{"url":"`+g.URL+`","token_masked":"tok-••••••••6789","token_from_env":false}}}`)
	g.connected = true
	if d := f.admin("GET", "/api/settings/wa-gateway", nil).data(); d["qr"] != nil {
		t.Errorf("connected gateway must not return a QR: %v", d)
	}
	// An empty token keeps the stored one; an empty URL clears it.
	f.admin("PATCH", "/api/settings/wa-gateway", map[string]any{"url": "", "token": ""})
	if f.setting("wa_gateway_token") == nil || f.setting("wa_gateway_url") != nil {
		t.Error("PATCH empty token must keep, empty url must clear")
	}
}

func TestMessages(t *testing.T) {
	f := newFixture(t)
	expect(t, f.staff("GET", "/api/settings/wa-gateway/messages", nil), 403, "")
	expect(t, f.admin("GET", "/api/settings/wa-gateway/messages?limit=5", nil), 200,
		`{"success":true,"data":{"messages":[],"summary":{"total_out":1,"total_in":0,"total_failed":0}}}`)
	resend := func(body any) response { return f.admin("POST", "/api/settings/wa-gateway/messages", body) }
	expect(t, resend(map[string]any{"id": "x"}), 400, `{"success":false,"error":"Payload tidak valid"}`)
	id := "11111111-1111-4111-8111-111111111111"
	expect(t, resend(map[string]any{"id": id}), 404, `{"success":false,"error":"Pesan tidak ditemukan"}`)
	body := "Halo"
	f.msg.outbound = &OutboundMessage{ID: id, Status: "sent", MessageType: "notification", Body: &body}
	expect(t, resend(map[string]any{"id": id}), 409, `{"success":false,"error":"Hanya pesan berstatus gagal yang bisa dikirim ulang"}`)
	f.msg.outbound = &OutboundMessage{ID: id, Status: "failed", MessageType: "otp"}
	expect(t, resend(map[string]any{"id": id}), 409, `{"success":false,"error":"OTP tidak bisa dikirim ulang — minta member request ulang dari portal"}`)
	f.msg.outbound = &OutboundMessage{ID: id, Status: "failed", MessageType: "notification", Body: &body}
	f.msg.result = SendResult{Reason: "Gateway menolak permintaan kirim"}
	expect(t, resend(map[string]any{"id": id}), 502, `{"success":false,"error":"Gateway menolak permintaan kirim"}`)
	if len(f.msg.marked) != 0 {
		t.Error("a failed resend must not mark the original")
	}
	f.msg.result = SendResult{Success: true}
	expect(t, resend(map[string]any{"id": id}), 200, `{"success":true,"data":{}}`)
	mid := "wamid.1"
	f.msg.result = SendResult{Success: true, MessageID: &mid}
	expect(t, resend(map[string]any{"id": id}), 200, `{"success":true,"data":{"messageId":"wamid.1"}}`)
	if len(f.msg.marked) != 2 || f.msg.resent[0] != id+"/00000000-0000-0000-0000-000000000001" {
		t.Errorf("resent %v marked %v", f.msg.resent, f.msg.marked)
	}
}

// Expectations of settings/wa-notifications/route.test.ts.
func TestWaNotifications(t *testing.T) {
	f := newFixture(t)
	expect(t, f.do("GET", "/api/settings/wa-notifications", nil, "admin", false), 403, "")
	res := f.staff("PUT", "/api/settings/wa-notifications", map[string]any{"recipients": []string{"0812-3456-7890", "6281234567890"}, "digestHour": 7})
	cfg := res.data()["config"].(map[string]any)
	if res.Status != 200 || len(cfg["recipients"].([]any)) != 1 || cfg["recipients"].([]any)[0] != "6281234567890" || cfg["digestHour"] != float64(7) {
		t.Fatalf("PUT = %s", res.Raw)
	}
	again := f.staff("PUT", "/api/settings/wa-notifications", map[string]any{"enabled": true}).data()["config"].(map[string]any)
	if again["recipients"].([]any)[0] != "6281234567890" {
		t.Errorf("partial PUT lost recipients: %v", again)
	}
	got := f.staff("GET", "/api/settings/wa-notifications", nil)
	if got.data()["config"].(map[string]any)["enabled"] != true || len(got.data()["catalog"].([]any)) != 9 {
		t.Errorf("GET = %s", got.Raw)
	}
	before := f.setting("wa_notif_config")
	expect(t, f.staff("PUT", "/api/settings/wa-notifications", map[string]any{"digestHour": 24}), 400,
		`{"success":false,"error":"Jam ringkasan harus 0-23 (WIB)"}`)
	if *f.setting("wa_notif_config") != *before {
		t.Error("an invalid PUT must not save")
	}
	f.staff("PUT", "/api/settings/wa-notifications", map[string]any{"shift_report_recipients": []string{"0812 3456 789", "123", "0812 3456 789"}})
	if got := f.staff("GET", "/api/settings/wa-notifications", nil).data()["shift_report_recipients"].([]any); len(got) != 1 || got[0] != "08123456789" {
		t.Errorf("shift recipients = %v", got)
	}
	expect(t, f.staff("PUT", "/api/settings/wa-notifications", map[string]any{"shift_report_recipients": "x"}), 400,
		`{"success":false,"error":"shift_report_recipients tidak valid"}`)
}

func TestWaNotificationsTestSend(t *testing.T) {
	f := newFixture(t)
	expect(t, f.staff("POST", "/api/settings/wa-notifications/test", nil), 400,
		`{"success":false,"error":"Belum ada nomor penerima. Simpan nomornya dulu."}`)
	f.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ('wa_notif_config', '{"recipients":["6281200000001","6281200000002"]}')`)
	expect(t, f.staff("POST", "/api/settings/wa-notifications/test", nil), 400,
		`{"success":false,"error":"WA Gateway belum dikonfigurasi (Settings → Integrasi atau WA_GATEWAY_URL/TOKEN)"}`)
	g := newFakeGateway(t)
	f.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ('wa_gateway_url', $1), ('wa_gateway_token', 'tok-123456789')`, g.URL)
	expect(t, f.staff("POST", "/api/settings/wa-notifications/test", nil), 200,
		`{"data":{"results":[{"target":"6281200000001","success":true,"reason":null},{"target":"6281200000002","success":false,"reason":"Nomor tidak terdaftar"}],"allOk":false}}`)
	if want := "6281200000001: NüHabit OS — pesan uji notifikasi.\nNomor ini akan menerima notifikasi bisnis otomatis.\n4 Okt 2026, 14.30 WIB"; g.sent[0] != want {
		t.Errorf("message = %q", g.sent[0])
	}
	f.staff("POST", "/api/settings/wa-notifications/test", map[string]any{"flash": true, "date": "2026-10-01"})
	if last := g.sent[len(g.sent)-1]; !strings.Contains(last, "Kamis, 1 Oktober 2026") || !strings.HasSuffix(last, "_(uji kirim manual 4 Okt 2026, 14.30 WIB — data 2026-10-01)_") ||
		!strings.Contains(last, "Average/Pax : Rp 50.000") {
		t.Errorf("flash = %q", last)
	}
}
