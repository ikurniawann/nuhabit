package memberportal

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// fakeNotifier records the last OTP per number instead of sending it.
type fakeNotifier struct {
	mu    sync.Mutex
	codes map[string]string
}

func (f *fakeNotifier) SendOTP(_ context.Context, target, code, _ string) Delivery {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.codes[target] = code
	return Delivery{Delivered: true, Provider: "fake"}
}

func (f *fakeNotifier) SendText(context.Context, string, string, string) Delivery {
	return Delivery{Delivered: true, Provider: "fake"}
}

func (f *fakeNotifier) code(phone string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.codes[phone]
}

// noGateway fails every Xendit call, so top-ups take the simulated path.
type noGateway struct{}

func (noGateway) LoadConfig(context.Context) (*XenditConfig, error) {
	return nil, errors.New("QRIS payment gateway is not configured. Set it in Settings → Payment Gateways.")
}
func (noGateway) CreateDynamicQR(context.Context, string, string, float64, string, string) (*XenditQR, error) {
	return nil, errors.New("unused")
}
func (noGateway) QRPayments(context.Context, string, string) ([]map[string]any, error) {
	return nil, errors.New("unused")
}
func (noGateway) QRCode(context.Context, string, string) (map[string]any, error) {
	return nil, errors.New("unused")
}

// testLog sends module error logs to the test output.
type testLog struct{ t *testing.T }

func (w testLog) Write(p []byte) (int, error) {
	w.t.Log(strings.TrimSpace(string(p)))
	return len(p), nil
}

type harness struct {
	t        *testing.T
	mod      *Module
	mux      http.Handler
	notifier *fakeNotifier
	devCode  string
	ip       string // X-Forwarded-For of every request, so runs never share a per-IP brake
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	t.Setenv("OTP_ENABLED", "true")
	deps := testutil.Deps(t, nil)
	deps.Log = slog.New(slog.NewTextHandler(testLog{t}, &slog.HandlerOptions{Level: slog.LevelError}))
	m := New(deps, Options{Loyalty: &collLoyalty{}})
	h := &harness{t: t, mod: m, mux: testutil.Mux(m), notifier: &fakeNotifier{codes: map[string]string{}}, ip: "go-test-" + testutil.RandomHex(6)}
	t.Cleanup(func() {
		_, _ = testutil.DB(t).Exec(context.Background(), `DELETE FROM platform.rate_limits WHERE key LIKE 'member-%:' || $1`, h.ip)
	})
	m.handler.svc.notifier = h.notifier
	m.handler.svc.payments = noGateway{}
	m.handler.svc.pusher = nil
	m.handler.svc.bypass = func() domain.DevBypass {
		return domain.DevBypass{Code: h.devCode, DatabaseURL: "postgres://postgres@localhost:55432/nuhabit"}
	}
	return h
}

func TestIntegrationOTPDisabled(t *testing.T) {
	h := newHarness(t)
	t.Setenv("OTP_ENABLED", "false")
	for _, path := range []string{
		"/api/member-portal/otp",
		"/api/member-portal/register/otp",
		"/api/member-portal/verify",
		"/api/member-portal/register",
	} {
		status, body, _ := h.do(testutil.Request("POST", path, map[string]any{}))
		if status != http.StatusServiceUnavailable || body["success"] != false {
			t.Fatalf("%s: status %d, body %v", path, status, body)
		}
	}
}

// A paid online shop order linked to the member shows in the transactions
// list next to the POS orders.
func TestTransactionsListShopOrders(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	db := testutil.DB(t)
	ctx := context.Background()
	var id string
	if err := db.QueryRow(ctx, `INSERT INTO shop.orders (status, customer_name, customer_phone, shipping_address, total, paid_at, customer_id, payment_method)
		VALUES ('paid', 'Go', '0812', 'Pickup at Dago', 75000, now(), $1, 'arkcoin') RETURNING id::text`, member.CustomerID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), `DELETE FROM shop.orders WHERE id = $1`, id) })
	status, body, _ := h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/transactions", nil), member))
	if status != 200 {
		t.Fatalf("transactions: %d %v", status, body)
	}
	orders := body["data"].(map[string]any)["orders"].([]any)
	if len(orders) != 1 {
		t.Fatalf("orders = %v", orders)
	}
	if o := orders[0].(map[string]any); o["id"] != id || o["total_amount"] != 75000.0 || o["payment_method"] != "arkcoin" || o["status"] != "paid" {
		t.Errorf("order = %v", o)
	}
}

func (h *harness) do(r *http.Request) (int, map[string]any, *http.Response) {
	h.t.Helper()
	r.Header.Set("X-Forwarded-For", h.ip)
	rec, body := testutil.Do(h.t, h.mux, r)
	return rec.Code, body, rec.Result()
}

func digitsOf(phone string) string { return domain.NormalizePhoneDigits(phone) }

// randomLocalPhone is an unregistered 08xx number with 12 digits.
func randomLocalPhone() string {
	var b strings.Builder
	b.WriteString("0898")
	for _, c := range []byte(testutil.RandomHex(4)) {
		b.WriteByte('0' + c%10)
	}
	return b.String()
}

// newMember creates a test member and removes its XP ledger rows on cleanup
// (the ledger keeps rows with a NULL customer otherwise).
func newMember(t *testing.T) testutil.Member {
	m := testutil.CreateMember(t)
	t.Cleanup(func() {
		ctx := context.Background()
		db := testutil.DB(t)
		_, _ = db.Exec(ctx, `DELETE FROM crm.crm_xp_ledger WHERE customer_id = $1`, m.CustomerID)
		_, _ = db.Exec(ctx, `DELETE FROM pos.pos_wallet_transactions WHERE customer_id = $1`, m.CustomerID)
		_, _ = db.Exec(ctx, `DELETE FROM crm.crm_marketing_optouts WHERE customer_id = $1`, m.CustomerID)
	})
	return m
}

func cleanupOTP(t *testing.T, phone string) {
	t.Cleanup(func() {
		_, _ = testutil.DB(t).Exec(context.Background(), `DELETE FROM crm.member_portal_otp WHERE phone = $1`, phone)
	})
}

func TestIntegrationLoginFlow(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	phone := digitsOf(member.Phone)
	cleanupOTP(t, phone)

	// Unknown numbers are told to register (the table-order sheet relies on it).
	status, body, _ := h.do(testutil.Request("POST", "/api/member-portal/otp", map[string]any{"phone": randomLocalPhone()}))
	if status != 404 || body["code"] != "not_registered" {
		t.Fatalf("unknown number: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/otp", map[string]any{"phone": "12"}))
	if status != 400 || body["error"] != "Nomor WhatsApp tidak valid" {
		t.Fatalf("bad number: %d %v", status, body)
	}

	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/otp", map[string]any{"phone": member.Phone}))
	if status != 200 || body["success"] != true || body["wa_delivered"] != true || body["dev_bypass"] != false ||
		body["message"] != "Kode OTP dikirim ke WhatsApp Anda" {
		t.Fatalf("otp: %d %v", status, body)
	}
	code := h.notifier.code(phone)

	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/verify", map[string]any{"phone": member.Phone, "code": "abc"}))
	if status != 400 || body["error"] != "Nomor/kode tidak valid" {
		t.Fatalf("malformed code: %d %v", status, body)
	}
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/verify", map[string]any{"phone": member.Phone, "code": wrong}))
	if status != 400 || body["error"] != "Kode salah" {
		t.Fatalf("wrong code: %d %v", status, body)
	}

	req := testutil.Request("POST", "/api/member-portal/verify", map[string]any{"phone": member.Phone, "code": code})
	req.Header.Set("x-app-client", "1")
	status, body, resp := h.do(req)
	data, _ := body["data"].(map[string]any)
	if status != 200 || data["name"] != "Go Test Member" || data["token"] == nil {
		t.Fatalf("verify: %d %v", status, body)
	}
	var cookie *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == "member_session" {
			cookie = c
		}
	}
	if cookie == nil || !cookie.HttpOnly || cookie.Value != data["token"] || cookie.MaxAge != 30*24*3600 ||
		cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" {
		t.Fatalf("cookie %+v", cookie)
	}

	// The code is single use.
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/verify", map[string]any{"phone": member.Phone, "code": code}))
	if status != 400 || body["error"] != "Kode kedaluwarsa. Minta kode baru" {
		t.Fatalf("reuse: %d %v", status, body)
	}

	// The new session works, then logout ends it.
	me := testutil.Request("GET", "/api/member-portal/me", nil)
	me.Header.Set("Authorization", "Bearer "+cookie.Value)
	status, body, _ = h.do(me)
	if status != 200 {
		t.Fatalf("me with new session: %d %v", status, body)
	}
	out := testutil.Request("POST", "/api/member-portal/logout", nil)
	out.AddCookie(cookie)
	status, body, resp = h.do(out)
	if status != 200 || body["success"] != true || !strings.Contains(resp.Header.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("logout: %d %v %s", status, body, resp.Header.Get("Set-Cookie"))
	}
	me = testutil.Request("GET", "/api/member-portal/me", nil)
	me.AddCookie(cookie)
	if status, body, _ = h.do(me); status != 401 || body["error"] != "Unauthorized" {
		t.Fatalf("after logout: %d %v", status, body)
	}

	// 3 codes per number per 10 minutes.
	for i := 0; i < 2; i++ {
		if status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/otp", map[string]any{"phone": member.Phone})); status != 200 {
			t.Fatalf("otp %d: %d %v", i, status, body)
		}
	}
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/otp", map[string]any{"phone": member.Phone}))
	if status != 429 || body["error"] != "Terlalu banyak permintaan. Coba lagi dalam 10 menit" {
		t.Fatalf("rate limit: %d %v", status, body)
	}

	// Five attempts per code, claimed atomically even when parallel.
	var wg sync.WaitGroup
	results := make(chan int, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			guess := "9" + strings.Repeat("0", 4) + string(rune('0'+i%10))
			if guess == h.notifier.code(phone) {
				guess = "888888"
			}
			s, _, _ := h.do(testutil.Request("POST", "/api/member-portal/verify", map[string]any{"phone": member.Phone, "code": guess}))
			results <- s
		}(i)
	}
	wg.Wait()
	close(results)
	tooMany := 0
	for s := range results {
		if s == 429 {
			tooMany++
		}
	}
	if tooMany != 12-domain.OTPMaxAttempts {
		t.Fatalf("parallel guesses: %d got 429, want %d", tooMany, 12-domain.OTPMaxAttempts)
	}
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/verify", map[string]any{"phone": member.Phone, "code": h.notifier.code(phone)}))
	if status != 429 || body["error"] != "Terlalu banyak percobaan. Minta kode baru" {
		t.Fatalf("after attempts: %d %v", status, body)
	}
}

func TestIntegrationDevBypass(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	h.devCode = "000000"
	status, body, _ := h.do(testutil.Request("POST", "/api/member-portal/verify", map[string]any{"phone": member.Phone, "code": ""}))
	if status != 200 {
		t.Fatalf("bypass verify: %d %v", status, body)
	}
	// The bypass never skips the member lookup.
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/verify", map[string]any{"phone": randomLocalPhone(), "code": ""}))
	if status != 404 || body["error"] != "Member tidak ditemukan" {
		t.Fatalf("bypass unknown: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/register/otp", map[string]any{"phone": member.Phone}))
	if status != 200 || body["dev_bypass"] != true || body["wa_delivered"] != false {
		t.Fatalf("register otp bypass: %d %v", status, body)
	}
	h.devCode = ""
	status, _, _ = h.do(testutil.Request("POST", "/api/member-portal/verify", map[string]any{"phone": member.Phone, "code": ""}))
	if status != 400 {
		t.Fatalf("without bypass an empty code is invalid, got %d", status)
	}
}

func TestIntegrationRegister(t *testing.T) {
	h := newHarness(t)
	db := testutil.DB(t)
	phone := randomLocalPhone()
	digits := digitsOf(phone)
	cleanupOTP(t, digits)
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = db.Exec(ctx, `DELETE FROM crm.crm_marketing_optouts WHERE customer_id IN (SELECT id FROM pos.pos_customers WHERE phone = $1)`, domain.LocalPhoneFormat(digits))
		_, _ = db.Exec(ctx, `DELETE FROM pos.pos_customers WHERE phone = $1`, domain.LocalPhoneFormat(digits))
	})

	// Same answer for members and new numbers.
	status, body, _ := h.do(testutil.Request("POST", "/api/member-portal/register/otp", map[string]any{"phone": phone}))
	if status != 200 || body["wa_delivered"] != true || body["dev_bypass"] != false || body["message"] != nil {
		t.Fatalf("register otp: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/register", map[string]any{"phone": phone, "name": "B"}))
	if status != 400 || body["field"] != "name" {
		t.Fatalf("validation: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/register", map[string]any{"phone": phone, "name": "Budi Test", "code": "12"}))
	if status != 400 || body["field"] != "code" || body["error"] != "Kode harus 6 digit" {
		t.Fatalf("code shape: %d %v", status, body)
	}
	status, body, resp := h.do(testutil.Request("POST", "/api/member-portal/register", map[string]any{
		"phone": phone, "name": "  Budi   Test ", "code": h.notifier.code(digits), "wa_consent": false, "email": "Budi@Test.ID",
	}))
	data, _ := body["data"].(map[string]any)
	if status != 200 || data["name"] != "Budi Test" || data["token"] != nil || resp.Header.Get("Set-Cookie") == "" {
		t.Fatalf("register: %d %v", status, body)
	}
	var memberType string
	var tierOK, optedOut bool
	err := db.QueryRow(context.Background(),
		`SELECT c.member_type, EXISTS (SELECT 1 FROM crm.crm_member_profiles p WHERE p.customer_id = c.id),
		        EXISTS (SELECT 1 FROM crm.crm_marketing_optouts o WHERE o.customer_id = c.id)
		   FROM pos.pos_customers c WHERE c.phone = $1`, domain.LocalPhoneFormat(digits)).Scan(&memberType, &tierOK, &optedOut)
	if err != nil || memberType != "registered" || !tierOK || !optedOut {
		t.Fatalf("stored member: %v %s profile=%v optout=%v", err, memberType, tierOK, optedOut)
	}

	// The owner of a registered number learns it only after a valid code.
	h.do(testutil.Request("POST", "/api/member-portal/register/otp", map[string]any{"phone": phone}))
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/register", map[string]any{"phone": phone, "name": "Budi", "code": h.notifier.code(digits)}))
	if status != 409 || body["field"] != "phone" || body["error"] != "Nomor ini sudah terdaftar. Silakan masuk." {
		t.Fatalf("duplicate: %d %v", status, body)
	}
}

func TestIntegrationProfileAndAccount(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	db := testutil.DB(t)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM crm.crm_marketing_optouts WHERE customer_id = $1`, member.CustomerID)
	})

	if status, body, _ := h.do(testutil.Request("GET", "/api/member-portal/me", nil)); status != 401 || body["error"] != "Unauthorized" {
		t.Fatalf("no session: %d %v", status, body)
	}
	status, body, _ := h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/me", nil), member))
	data, _ := body["data"].(map[string]any)
	profile, _ := data["profile"].(map[string]any)
	completion, _ := data["completion"].(map[string]any)
	if status != 200 || profile["id"] != member.CustomerID || profile["birth_date"] != nil || data["ark_coin_balance"] != 0.0 ||
		completion["complete"] != false || data["tiers"] == nil || data["marketing_opt_in"] != false {
		t.Fatalf("me: %d %v", status, body)
	}
	if labels, _ := completion["missing_labels"].([]any); len(labels) == 0 {
		t.Fatalf("missing labels %v", completion)
	}

	status, body, _ = h.do(testutil.AsMember(testutil.Request("PUT", "/api/member-portal/profile", map[string]any{"gender": "x"}), member))
	if status != 400 || body["error"] != "Data profil tidak valid" {
		t.Fatalf("invalid profile: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("PUT", "/api/member-portal/profile", map[string]any{
		"email": "go@test.id", "birth_date": "1990-05-17", "gender": "male", "city": "Bandung", "photo_url": "/x.jpg", "wa_consent": true,
	}), member))
	data, _ = body["data"].(map[string]any)
	if status != 200 || body["message"] == nil || data["completion"].(map[string]any)["percent"] != 100.0 {
		t.Fatalf("profile: %d %v", status, body)
	}
	var granted bool
	_ = db.QueryRow(context.Background(), `SELECT free_xp_granted_at IS NOT NULL FROM pos.pos_customers WHERE id = $1`, member.CustomerID).Scan(&granted)
	if !granted {
		t.Fatal("free XP not granted on a complete profile")
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("PUT", "/api/member-portal/profile", map[string]any{"city": "Jakarta"}), member))
	if status != 200 || body["data"].(map[string]any)["free_xp_awarded"] != 0.0 || body["message"] != "Profil tersimpan" {
		t.Fatalf("second save: %d %v", status, body)
	}

	status, body, _ = h.do(testutil.AsMember(testutil.Request("PUT", "/api/member-portal/consent", map[string]any{"enabled": false}), member))
	if status != 200 || body["data"].(map[string]any)["marketing_opt_in"] != false {
		t.Fatalf("consent off: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("PUT", "/api/member-portal/consent", map[string]any{"enabled": true}), member))
	if status != 200 || body["data"].(map[string]any)["marketing_opt_in"] != true {
		t.Fatalf("consent on: %d %v", status, body)
	}
	if status, _, _ = h.do(testutil.AsMember(testutil.Request("PUT", "/api/member-portal/consent", map[string]any{"enabled": "yes"}), member)); status != 400 {
		t.Fatalf("consent invalid: %d", status)
	}

	for _, path := range []string{"/visits", "/transactions", "/promos", "/events", "/challenges", "/reviews", "/bills",
		"/notifications", "/push", "/app/home", "/app/home/bookings", "/app/home/visits", "/topup"} {
		status, body, _ = h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal"+path, nil), member))
		if status != 200 || body["success"] != true {
			t.Errorf("GET %s: %d %v", path, status, body)
		}
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/orders/"+member.CustomerID, nil), member))
	if status != 404 || body["error"] != "Order tidak ditemukan" {
		t.Fatalf("foreign order: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/app/home/announcements/not-a-uuid", nil), member))
	if status != 404 || body["error"] != "Pengumuman tidak ditemukan" {
		t.Fatalf("announcement: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("PATCH", "/api/member-portal/app/home/me", map[string]any{
		"emergencyContact": map[string]any{"name": "Ibu", "phone": "08123456", "relation": "Ibu"}, "acceptWaiver": true,
	}), member))
	if status != 200 {
		t.Fatalf("patch account: %d %v", status, body)
	}
	var waiver string
	_ = db.QueryRow(context.Background(), `SELECT waiver_version FROM pos.pos_customers WHERE id = $1`, member.CustomerID).Scan(&waiver)
	if waiver != domain.WaiverVersion {
		t.Fatalf("waiver %q", waiver)
	}
	if status, _, _ = h.do(testutil.AsMember(testutil.Request("PATCH", "/api/member-portal/app/home/me", map[string]any{"acceptWaiver": false}), member)); status != 400 {
		t.Fatalf("acceptWaiver false must be rejected, got %d", status)
	}
}

func TestIntegrationInboxPushQR(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	db := testutil.DB(t)
	var notifID string
	if err := db.QueryRow(context.Background(),
		`INSERT INTO crm.member_notifications (customer_id, type, title, body, link_url) VALUES ($1, 'promo', 'Promo', 'Isi', 'promos') RETURNING id`,
		member.CustomerID).Scan(&notifID); err != nil {
		t.Fatal(err)
	}
	status, body, _ := h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/notifications", nil), member))
	data, _ := body["data"].(map[string]any)
	if status != 200 || data["unread"] != 1.0 || len(data["notifications"].([]any)) != 1 {
		t.Fatalf("inbox: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/notifications/track", map[string]any{"id": notifID, "event": "click"}), member))
	if status != 200 || body["data"].(map[string]any)["link_url"] != "promos" {
		t.Fatalf("track: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/notifications/track", map[string]any{"id": member.CustomerID, "event": "open"}), member))
	if status != 404 || body["error"] != "Notifikasi tidak ditemukan" {
		t.Fatalf("track missing: %d %v", status, body)
	}
	status, _, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/notifications", map[string]any{}), member))
	_, body, _ = h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/notifications", nil), member))
	if status != 200 || body["data"].(map[string]any)["unread"] != 0.0 {
		t.Fatalf("mark all read: %d %v", status, body)
	}
	if status, _, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/notifications", map[string]any{"ids": []string{"x"}}), member)); status != 400 {
		t.Fatalf("bad ids: %d", status)
	}

	endpoint := "https://push.example.test/" + testutil.RandomHex(8)
	sub := map[string]any{"endpoint": endpoint, "keys": map[string]any{"p256dh": "k", "auth": "a"}}
	if status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/push", sub), member)); status != 200 {
		t.Fatalf("subscribe: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/push", nil), member))
	if data = body["data"].(map[string]any); status != 200 || data["devices"] != 1.0 || data["public_key"] != nil {
		t.Fatalf("push status: %d %v", status, body)
	}
	if status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/push", map[string]any{"endpoint": "nope"}), member)); status != 400 || body["error"] != "Langganan notifikasi tidak valid" {
		t.Fatalf("bad subscription: %d %v", status, body)
	}
	if status, _, _ = h.do(testutil.AsMember(testutil.Request("DELETE", "/api/member-portal/push", map[string]any{"endpoint": endpoint}), member)); status != 200 {
		t.Fatalf("unsubscribe: %d", status)
	}

	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/qr", nil), member))
	data, _ = body["data"].(map[string]any)
	token, _ := data["token"].(string)
	if status != 200 || !strings.HasPrefix(token, "nhqr_") || data["ttl_seconds"] != 60.0 || data["expires_at"] == nil {
		t.Fatalf("qr: %d %v", status, body)
	}
}

func TestIntegrationEventsChallengesReviews(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	other := newMember(t)
	db := testutil.DB(t)
	ctx := context.Background()
	var eventID, challengeID string
	if err := db.QueryRow(ctx,
		`INSERT INTO crm.events (title, description, starts_at, ends_at, capacity, booking_closes_hours, cancel_deadline_hours, status)
		 VALUES ('Go Test Event', 'x', now() + interval '3 days', now() + interval '3 days 2 hours', 1, 1, 24, 'published') RETURNING id`).Scan(&eventID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(ctx, `DELETE FROM crm.events WHERE id = $1`, eventID) })
	if err := db.QueryRow(ctx,
		`INSERT INTO crm.challenges (title, description, metric, target, starts_at, ends_at, reward_xp, reward_ark_idr, is_active)
		 VALUES ('Go Test Challenge', 'x', 'visits', 3, now() - interval '1 day', now() + interval '7 days', 10, 0, true) RETURNING id`).Scan(&challengeID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(ctx, `DELETE FROM crm.challenges WHERE id = $1`, challengeID) })

	status, body, _ := h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/events", map[string]any{"event_id": eventID}), member))
	if status != 200 || body["data"].(map[string]any)["kind"] != "confirm" {
		t.Fatalf("book: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/events", map[string]any{"event_id": eventID}), member))
	if status != 409 || body["error"] != "Anda sudah terdaftar di event ini" {
		t.Fatalf("double book: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/events", map[string]any{"event_id": eventID}), other))
	if data := body["data"].(map[string]any); status != 200 || data["kind"] != "waitlist" || data["position"] != 1.0 {
		t.Fatalf("waitlist: %d %v", status, body)
	}
	_, body, _ = h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/events", nil), member))
	var bookingID string
	for _, e := range body["data"].([]any) {
		if ev := e.(map[string]any); ev["id"] == eventID {
			bookingID, _ = ev["booking_id"].(string)
			if ev["confirmed_count"] != 1.0 || ev["booking_status"] != "confirmed" {
				t.Fatalf("event row %v", ev)
			}
		}
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("DELETE", "/api/member-portal/events?booking_id="+bookingID, nil), other))
	if status != 409 || body["error"] != "Booking tidak ditemukan" {
		t.Fatalf("cancel someone else's booking: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("DELETE", "/api/member-portal/events?booking_id="+bookingID, nil), member))
	if data := body["data"].(map[string]any); status != 200 || data["ok"] != true || data["lateCancel"] != false {
		t.Fatalf("cancel: %d %v", status, body)
	}
	var promoted string
	_ = db.QueryRow(ctx, `SELECT status FROM crm.event_bookings WHERE event_id = $1 AND customer_id = $2`, eventID, other.CustomerID).Scan(&promoted)
	if promoted != "confirmed" {
		t.Fatalf("waitlist not promoted: %s", promoted)
	}

	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/challenges", map[string]any{"challenge_id": challengeID}), member))
	if status != 200 {
		t.Fatalf("join: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/challenges", map[string]any{"challenge_id": challengeID}), member))
	if status != 409 {
		t.Fatalf("join twice: %d %v", status, body)
	}
	_, body, _ = h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/challenges", nil), member))
	found := false
	for _, c := range body["data"].([]any) {
		if ch := c.(map[string]any); ch["id"] == challengeID {
			found = true
			if ch["joined"] != true || ch["my_rank"] != 1.0 || ch["phase"] != "running" || ch["progress"].(map[string]any)["completed"] != false {
				t.Fatalf("challenge view %v", ch)
			}
			board := ch["leaderboard"].([]any)
			if len(board) != 1 || board[0].(map[string]any)["is_me"] != true || board[0].(map[string]any)["name"] != "Go M." {
				t.Fatalf("leaderboard %v", board)
			}
		}
	}
	if !found {
		t.Fatal("joined challenge missing")
	}

	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/reviews", map[string]any{"order_id": eventID, "rating": 6}), member))
	if status != 400 || body["error"] != "Pilih 1 sampai 5 bintang" {
		t.Fatalf("bad rating: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/reviews", map[string]any{"order_id": eventID, "rating": 5}), member))
	if status != 400 || body["error"] != "Order tidak ditemukan" {
		t.Fatalf("missing order: %d %v", status, body)
	}
}

func TestIntegrationTopupSimulated(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	db := testutil.DB(t)
	ctx := context.Background()
	t.Cleanup(func() {
		_, _ = db.Exec(ctx, `DELETE FROM pos.pos_wallet_transactions WHERE customer_id = $1`, member.CustomerID)
	})

	// Without the dev guards and without Xendit the QRIS is unavailable.
	status, body, _ := h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/topup", map[string]any{"amount": 50000}), member))
	if status != 503 || !strings.HasPrefix(body["error"].(string), "Pembayaran QRIS belum tersedia: ") {
		t.Fatalf("no gateway: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/topup", map[string]any{}), member))
	if status != 400 || body["error"] != "Pilih paket atau isi nominal" {
		t.Fatalf("schema: %d %v", status, body)
	}
	if status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/topup/"+member.CustomerID+"/simulate-paid", nil), member)); status != 404 || body["error"] != "Not found" {
		t.Fatalf("simulate without guards: %d %v", status, body)
	}

	h.devCode = "000000"
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/topup", map[string]any{"amount": 500}), member))
	if status != 400 || !strings.HasPrefix(body["error"].(string), "Minimal top-up Rp") {
		t.Fatalf("minimum: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/topup", map[string]any{"amount": 50000}), member))
	data, _ := body["data"].(map[string]any)
	id, _ := data["id"].(string)
	if status != 200 || data["status"] != "pending" || data["simulated"] != true || data["amount"] != 50000.0 ||
		!strings.HasPrefix(data["qr_string"].(string), "DEV-SIMULATED-QRIS-topup_") {
		t.Fatalf("create: %d %v", status, body)
	}
	_, body, _ = h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/topup", nil), member))
	if body["data"].(map[string]any)["pending_id"] != id || body["data"].(map[string]any)["can_simulate"] != true {
		t.Fatalf("options: %v", body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/topup/"+id+"/simulate-paid", nil), member))
	data, _ = body["data"].(map[string]any)
	if status != 200 || data["status"] != "completed" || data["balance_after"] != 50000.0 || data["qr_string"] != nil {
		t.Fatalf("simulate: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("POST", "/api/member-portal/topup/"+id+"/simulate-paid", nil), member))
	if status != 400 || body["error"] != "Top-up tidak dalam status menunggu pembayaran" {
		t.Fatalf("simulate twice: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/topup/"+id, nil), member))
	if status != 200 || body["data"].(map[string]any)["status"] != "completed" {
		t.Fatalf("status: %d %v", status, body)
	}
	var balance float64
	_ = db.QueryRow(ctx, `SELECT ark_coin_balance::float FROM pos.pos_customers WHERE id = $1`, member.CustomerID).Scan(&balance)
	if balance != 50000 {
		t.Fatalf("balance %v", balance)
	}
	if status, body, _ = h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/topup/x", nil), member)); status != 400 || body["error"] != "ID tidak valid" {
		t.Fatalf("bad id: %d %v", status, body)
	}
}

type fakeCredits struct{}

func (fakeCredits) CreditSummary(context.Context, string) (CreditSummary, error) {
	return CreditSummary{Balance: 3, LowBalance: true, ExpiringCredits: 1}, nil
}

func TestIntegrationAppAccount(t *testing.T) {
	h := newHarness(t)
	if routeExists(h.mod, "GET /api/member-portal/app/home/me") {
		t.Fatal("GET /app/home/me must stay in TS without a credit wallet")
	}
	h.mod.handler.credits = fakeCredits{}
	h.mux = testutil.Mux(h.mod)
	member := newMember(t)
	status, body, _ := h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/app/home/me", nil), member))
	data, _ := body["data"].(map[string]any)
	m, _ := data["member"].(map[string]any)
	if status != 200 || data["balance"] != 3.0 || data["lowBalance"] != true || data["expiringCredits"] != 1.0 ||
		m["fullName"] != "Go Test Member" || m["email"] != "" || m["status"] != "ACTIVE" || m["emergencyContact"] != nil {
		t.Fatalf("account: %d %v", status, body)
	}
}

func routeExists(m *Module, pattern string) bool {
	for _, r := range m.Routes() {
		if r.Pattern == pattern {
			return true
		}
	}
	return false
}
