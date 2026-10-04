package webhooks

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/integrations"
	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Writes run in one rolled-back transaction; other contexts are fakes (the
// real adapters are tested in internal/app). Telegram is an httptest server.

type routes []module.Route

func (r routes) Name() string           { return "webhooks-test" }
func (r routes) Routes() []module.Route { return r }

type fakePayments struct {
	gym, checkout, order *Pending
	topups               map[string]*Pending // column=value
	children             int
	settled              []string
}

func (f *fakePayments) IsGymPurchaseReference(ref string) bool {
	return strings.HasPrefix(ref, "gymcp_")
}
func (f *fakePayments) GymPurchase(context.Context, database.Querier, string) (*Pending, error) {
	return f.gym, nil
}
func (f *fakePayments) SettleGymPurchase(_ context.Context, _ database.DB, ref string, paymentID *string) (any, error) {
	f.settled = append(f.settled, ref+"/"+*paymentID)
	return map[string]string{"status": "paid", "purchase_id": "gp-1"}, nil
}
func (f *fakePayments) Topup(_ context.Context, _ database.Querier, column, value string) (*Pending, error) {
	return f.topups[column+"="+value], nil
}
func (f *fakePayments) Checkout(context.Context, database.Querier, string) (*Pending, error) {
	return f.checkout, nil
}
func (f *fakePayments) CheckoutChildren(context.Context, database.Querier, string) (int, error) {
	return f.children, nil
}
func (f *fakePayments) Order(context.Context, database.Querier, string) (*Pending, error) {
	return f.order, nil
}

type fakeInbox struct {
	replies []string
	echo    bool
}

func (f *fakeInbox) Record(_ context.Context, _ database.DB, m domain.GatewayInbound) (bool, string, error) {
	return !f.echo, "conv-1", nil
}
func (f *fakeInbox) OnInbound(context.Context, database.DB, string, *string, time.Time) (*string, error) {
	text := "Terima kasih"
	return &text, nil
}
func (f *fakeInbox) AutoReply(_ context.Context, _ database.DB, phone, conversationID, text string) {
	f.replies = append(f.replies, phone+"|"+conversationID+"|"+text)
}

type fakePartners struct {
	partner  *Partner
	ingested []PartnerEvent
}

func (f *fakePartners) FindByCode(context.Context, database.Querier, string) (*Partner, error) {
	return f.partner, nil
}
func (f *fakePartners) Ingest(_ context.Context, _ database.DB, _ Partner, e PartnerEvent) (PartnerEventResult, error) {
	f.ingested = append(f.ingested, e)
	return PartnerEventResult{ID: "e1", Status: "processed", XPAwarded: 10}, nil
}

type fixture struct {
	t        *testing.T
	tx       pgx.Tx
	mux      *http.ServeMux
	pay      *fakePayments
	inbox    *fakeInbox
	partners *fakePartners
	env      map[string]string
	now      time.Time
	tg       *telegramServer
}

type telegramServer struct {
	*httptest.Server
	mu   sync.Mutex
	sent []string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	f := &fixture{t: t, tx: tx, pay: &fakePayments{topups: map[string]*Pending{}}, inbox: &fakeInbox{},
		partners: &fakePartners{}, env: map[string]string{}, now: time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)}
	f.tg = &telegramServer{}
	f.tg.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ChatID int64  `json:"chat_id"`
			Text   string `json:"text"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.tg.mu.Lock()
		f.tg.sent = append(f.tg.sent, r.URL.Path+"|"+strconv.FormatInt(body.ChatID, 10)+"|"+body.Text)
		f.tg.mu.Unlock()
		_, _ = w.Write([]byte(`{"ok":true,"result":{}}`))
	}))
	t.Cleanup(f.tg.Close)
	h := NewHandler(tx, Ports{Payments: f.pay, Inbox: f.inbox, Partners: f.partners}, func() time.Time { return f.now },
		slog.New(slog.NewTextHandler(io.Discard, nil)), func(k string) string { return f.env[k] }, f.tg.URL)
	f.mux = testutil.Mux(routes(h.Routes()))
	return f
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

type response struct {
	Status int
	Raw    string
}

func (f *fixture) post(target, body string, headers map[string]string) response {
	f.t.Helper()
	r := httptest.NewRequest("POST", target, strings.NewReader(body))
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, r)
	return response{rec.Code, rec.Body.String()}
}

func expect(t *testing.T, res response, status int, raw string) {
	t.Helper()
	if res.Status != status || res.Raw != raw {
		t.Fatalf("got %d %s, want %d %s", res.Status, res.Raw, status, raw)
	}
}

/* ── Xendit (payments/xendit/webhook/route.test.ts) ──────────────────── */

func (f *fixture) xenditGateway(webhookSecret *string) {
	f.exec(`INSERT INTO configuration.payment_gateways (provider, display_name, is_active, environment, secret_key, webhook_secret)
		VALUES ('xendit', 'Xendit', true, 'sandbox', 'sk', $1)
		ON CONFLICT (provider) DO UPDATE SET is_active = true, secret_key = 'sk', webhook_secret = EXCLUDED.webhook_secret`, webhookSecret)
}

func paid(amount int, ref string) string {
	return `{"event":"qr.payment","data":{"id":"qrpy_1","qr_id":"qr_1","reference_id":"` + ref + `","status":"SUCCEEDED","amount":` + strconv.Itoa(amount) + `}}`
}

func (f *fixture) xendit(body, token string) response {
	return f.post("/api/payments/xendit/webhook", body, map[string]string{"x-callback-token": token})
}

// published lists the xendit events this transaction stored.
func (f *fixture) published() []integrations.XenditQrPaid {
	rows, err := f.tx.Query(context.Background(), `SELECT payload FROM platform.outbox_events WHERE topic = $1 ORDER BY id`, integrations.TopicXenditQrPaid)
	if err != nil {
		f.t.Fatal(err)
	}
	raws, err := pgx.CollectRows(rows, pgx.RowTo[[]byte])
	if err != nil {
		f.t.Fatal(err)
	}
	var out []integrations.XenditQrPaid
	for _, raw := range raws {
		var e integrations.XenditQrPaid
		_ = json.Unmarshal(raw, &e)
		out = append(out, e)
	}
	return out
}

func TestXenditAuthAndConfig(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE configuration.payment_gateways SET is_active = false WHERE provider = 'xendit'`)
	expect(t, f.xendit(paid(50000, "topup_a"), "cb-token"), 200, `{"success":true,"ignored":true,"reason":"xendit_not_configured"}`)
	f.xenditGateway(nil)
	f.pay.topups["reference_id=topup_a"] = &Pending{ID: "tx-1", Amount: "50000"}
	// No webhook secret configured: fail closed.
	expect(t, f.xendit(paid(50000, "topup_a"), "apa-saja"), 401, `{"success":false,"error":"Invalid callback token"}`)
	token := "cb-token"
	f.xenditGateway(&token)
	expect(t, f.xendit(paid(50000, "topup_a"), "salah"), 401, `{"success":false,"error":"Invalid callback token"}`)
	expect(t, f.xendit(`{"data":{"status":"PENDING"}}`, " cb-token "), 200, `{"success":true,"ignored":true,"reason":"not_paid","status":"PENDING"}`)
	expect(t, f.xendit("bukan json", "cb-token"), 200, `{"success":true,"ignored":true,"reason":"not_paid","status":""}`)
	if len(f.published()) != 0 {
		t.Error("nothing may be queued")
	}
	r := httptest.NewRecorder()
	f.mux.ServeHTTP(r, httptest.NewRequest("GET", "/api/payments/xendit/webhook", nil))
	if r.Body.String() != `{"success":true,"service":"xendit-webhook"}` {
		t.Errorf("probe = %s", r.Body.String())
	}
}

func TestXenditSettlements(t *testing.T) {
	f := newFixture(t)
	token := "cb-token"
	f.xenditGateway(&token)

	// Top-up: amount mismatch is not credited, a match is queued once.
	f.pay.topups["xendit_transaction_id=qr_1"] = &Pending{ID: "tx-1", Amount: "500000.00"}
	expect(t, f.xendit(paid(1000, "topup_a"), token), 200, `{"success":true,"ignored":true,"reason":"amount_mismatch"}`)
	f.pay.topups["xendit_transaction_id=qr_1"] = &Pending{ID: "tx-1", Amount: "50000.00"}
	expect(t, f.xendit(paid(50000, "topup_a"), token), 200, `{"success":true,"queued":true,"data":{"topup_id":"tx-1"}}`)
	ev := f.published()
	if len(ev) != 1 || ev[0] != (integrations.XenditQrPaid{Action: "credit_topup", TargetID: "tx-1", ReferenceID: "topup_a", QRID: "qr_1",
		PaymentID: "qrpy_1", Amount: 50000, XenditPaymentID: "qrpy_1", Notes: "Top-up QRIS"}) {
		t.Fatalf("events = %+v", ev)
	}
	delete(f.pay.topups, "xendit_transaction_id=qr_1")

	// Standalone order.
	f.pay.order = &Pending{ID: "ord-1", Amount: "75000"}
	expect(t, f.xendit(paid(100, "pos-ord-ord-1"), token), 200, `{"success":true,"ignored":true,"reason":"amount_mismatch"}`)
	expect(t, f.xendit(paid(75000, "pos-ord-ord-1"), token), 200, `{"success":true,"queued":true,"data":{"order_id":"ord-1"}}`)

	// Central checkout: mismatch, children already made, then queued.
	f.pay.checkout = &Pending{ID: "co-1", Amount: "120000"}
	expect(t, f.xendit(paid(120, "pos-co"), token), 200, `{"success":true,"ignored":true,"reason":"amount_mismatch"}`)
	f.pay.children = 2
	expect(t, f.xendit(paid(120000, "pos-co"), token), 200, `{"success":true,"ignored":true,"reason":"checkout_children_exist","data":{"checkout_id":"co-1"}}`)
	f.pay.children = 0
	expect(t, f.xendit(paid(120000, "pos-co"), token), 200, `{"success":true,"queued":true,"data":{"checkout_id":"co-1"}}`)
	if ev := f.published(); len(ev) != 3 || ev[1].Action != "complete_order" || ev[2].Action != "complete_checkout" || ev[2].TargetID != "co-1" {
		t.Errorf("events = %+v", ev)
	}

	f.pay.checkout, f.pay.order = nil, nil
	expect(t, f.xendit(paid(1, "unknown"), token), 200, `{"success":true,"ignored":true,"reason":"topup_not_found"}`)

	// Gym credit package: mismatch, then settled synchronously.
	f.pay.gym = &Pending{ID: "gp-1", Amount: "300000.00"}
	expect(t, f.xendit(paid(3000, "gymcp_abc"), token), 200, `{"success":true,"ignored":true,"reason":"amount_mismatch"}`)
	expect(t, f.xendit(paid(300000, "gymcp_abc"), token), 200, `{"success":true,"data":{"gym_purchase":{"purchase_id":"gp-1","status":"paid"}}}`)
	if len(f.pay.settled) != 1 || f.pay.settled[0] != "gymcp_abc/qrpy_1" {
		t.Errorf("settled = %v", f.pay.settled)
	}
}

/* ── wa/inbound (route.test.ts) ──────────────────────────────────────── */

func TestWaInbound(t *testing.T) {
	f := newFixture(t)
	in := func(body, token string) response {
		return f.post("/api/wa/inbound", body, map[string]string{"x-gateway-token": token})
	}
	expect(t, in("{}", "rahasia"), 401, `{"success":false,"error":"Unauthorized"}`)
	f.env["WA_GATEWAY_TOKEN"] = "rahasia"
	expect(t, in("{}", "salah"), 401, `{"success":false,"error":"Unauthorized"}`)
	expect(t, in("{bukan json", "rahasia"), 400, `{"success":false,"error":"JSON tidak valid"}`)
	expect(t, in(`{"messages":[{"remoteJid":"62812000000@s.whatsapp.net","text":"halo"},{"remoteJid":"x@g.us","text":"grup"}]}`, "rahasia"), 200,
		`{"success":true,"stored":1,"skipped":1}`)
	if len(f.inbox.replies) != 1 || f.inbox.replies[0] != "62812000000|conv-1|Terima kasih" {
		t.Errorf("auto-replies = %v", f.inbox.replies)
	}
	// Echoes are skipped; outbound messages get no CS rules.
	f.inbox.echo = true
	expect(t, in(`{"messages":[{"remoteJid":"62812000000@s.whatsapp.net","text":"halo"}]}`, "rahasia"), 200, `{"success":true,"stored":0,"skipped":1}`)
	f.inbox.echo = false
	expect(t, in(`{"messages":[{"remoteJid":"62812000000@s.whatsapp.net","text":"balasan","fromMe":true}]}`, "rahasia"), 200, `{"success":true,"stored":1,"skipped":0}`)
	if len(f.inbox.replies) != 1 {
		t.Error("an outbound message must not auto-reply")
	}
	expect(t, in(`{"x":"`+strings.Repeat("a", 512*1024)+`"}`, "rahasia"), 413, `{"success":false,"error":"Payload terlalu besar"}`)
	// Ten wrong tokens in a minute lock the endpoint.
	for range 9 { // one wrong token was already sent above
		in("{}", "salah")
	}
	expect(t, in("{}", "rahasia"), 429, `{"success":false,"error":"Too many attempts"}`)
	f.now = f.now.Add(61 * time.Second)
	expect(t, in("{}", "rahasia"), 200, `{"success":true,"stored":0,"skipped":0}`)
}

/* ── Telegram (route.test.ts) ────────────────────────────────────────── */

const tgSecret = "s3cr3t-webhook-token"

func (f *fixture) telegram(body, path, header string) response {
	h := map[string]string{}
	if header != "" {
		h["X-Telegram-Bot-Api-Secret-Token"] = header
	}
	return f.post("/api/integrations/telegram/webhook/"+path, body, h)
}

func (f *fixture) chatStatus(id int64) string {
	var s string
	if err := f.tx.QueryRow(context.Background(), `SELECT status FROM configuration.telegram_subscribers WHERE chat_id = $1`, id).Scan(&s); err != nil {
		return ""
	}
	return s
}

func TestTelegramWebhook(t *testing.T) {
	f := newFixture(t)
	f.exec(`DELETE FROM configuration.app_settings WHERE key IN ('telegram_bot_token', 'telegram_webhook_secret')`)
	f.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ('telegram_bot_token', '123:tok'), ('telegram_webhook_secret', $1)`, tgSecret)
	f.exec(`DELETE FROM configuration.telegram_subscribers WHERE chat_id IN (555, -100)`)
	start := func(text string) string {
		return `{"message":{"text":"` + text + `","chat":{"id":555,"type":"private","first_name":"Arip","username":"arip"}}}`
	}
	expect(t, f.telegram(start("/start"), "salah", tgSecret), 401, `{"ok":false}`)
	expect(t, f.telegram(start("/start"), tgSecret, "salah"), 401, `{"ok":false}`)
	expect(t, f.telegram(start("/start"), tgSecret, ""), 401, `{"ok":false}`)
	if f.chatStatus(555) != "" {
		t.Fatal("unauthorized update touched data")
	}

	expect(t, f.telegram(start("/start"), tgSecret, tgSecret), 200, `{"ok":true}`)
	if f.chatStatus(555) != "pending" || len(f.tg.sent) != 1 || !strings.HasPrefix(f.tg.sent[0], "/bot123:tok/sendMessage|555|") ||
		!strings.Contains(f.tg.sent[0], "menyetujui") {
		t.Fatalf("start: %s %v", f.chatStatus(555), f.tg.sent)
	}
	f.exec(`INSERT INTO configuration.telegram_subscribers (chat_id, chat_type, status) VALUES (-100, 'group', 'active')`)
	f.telegram(`{"message":{"text":"/start@bcdcoffee_bot","chat":{"id":-100,"type":"group","title":"Barista BCD"}}}`, tgSecret, tgSecret)
	var title string
	_ = f.tx.QueryRow(context.Background(), `SELECT title FROM configuration.telegram_subscribers WHERE chat_id = -100`).Scan(&title)
	if f.chatStatus(-100) != "active" || title != "Barista BCD" || !strings.Contains(f.tg.sent[1], "sudah menerima") {
		t.Errorf("group start: %s %q %v", f.chatStatus(-100), title, f.tg.sent)
	}
	f.telegram(start("/stop"), tgSecret, tgSecret)
	if f.chatStatus(555) != "stopped" || !strings.Contains(f.tg.sent[2], "dihentikan") {
		t.Errorf("stop: %s", f.chatStatus(555))
	}
	f.telegram(`{"my_chat_member":{"chat":{"id":-100,"type":"group"},"new_chat_member":{"status":"kicked"}}}`, tgSecret, tgSecret)
	if f.chatStatus(-100) != "stopped" {
		t.Error("kicked bot must stop the chat")
	}
	expect(t, f.telegram(start("halo"), tgSecret, tgSecret), 200, `{"ok":true}`)
	if len(f.tg.sent) != 3 {
		t.Errorf("a plain message must not answer: %v", f.tg.sent)
	}
}

/* ── loyalty partners (route.test.ts) ────────────────────────────────── */

func TestLoyaltyEvents(t *testing.T) {
	f := newFixture(t)
	secret := "s3cret"
	sign := func(body string) string {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(body))
		return "sha256=" + hex.EncodeToString(mac.Sum(nil))
	}
	fresh := strconv.FormatInt(f.now.Unix(), 10)
	post := func(body, ts, sig string) response {
		return f.post("/api/integrations/loyalty-events/photobooth", body, map[string]string{"X-Timestamp": ts, "X-Signature": sig})
	}
	unauthorized := `{"success":false,"error":"Unauthorized"}`
	expect(t, post("{}", fresh, sign("{}")), 401, unauthorized)
	f.partners.partner = &Partner{ID: "pt1", IsActive: false, SigningSecret: secret}
	expect(t, post("{}", fresh, sign("{}")), 401, unauthorized)
	f.partners.partner.IsActive = true
	expect(t, post("{}", strconv.FormatInt(f.now.Unix()-301, 10), sign("{}")), 401, unauthorized)
	expect(t, post("{}", fresh, sign("{ }")), 401, unauthorized)
	if len(f.partners.ingested) != 0 {
		t.Fatal("ingested without auth")
	}
	expect(t, post("not json", fresh, sign("not json")), 400, `{"success":false,"error":"Body bukan JSON"}`)
	expect(t, post(`{"event_type":"x"}`, fresh, sign(`{"event_type":"x"}`)), 400, `{"success":false,"error":"Data event tidak valid"}`)
	big := `{"x":"` + strings.Repeat("a", 64*1024) + `"}`
	expect(t, post(big, fresh, sign(big)), 413, `{"success":false,"error":"Payload terlalu besar"}`)
	body := `{"external_id":" ext-1 ","event_type":"photo","email":"","phone":"0811","payload":{"frame":2}}`
	expect(t, post(body, fresh, sign(body)), 200, `{"success":true,"data":{"id":"e1","status":"processed","xp_awarded":10,"duplicate":false}}`)
	got := f.partners.ingested[0]
	if got.ExternalID != "ext-1" || *got.Subject != "0811" || string(got.Payload) != `{"frame":2}` || got.OccurredAt != nil {
		t.Errorf("ingested %+v", got)
	}
}
