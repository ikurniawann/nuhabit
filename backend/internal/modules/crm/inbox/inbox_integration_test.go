package inbox

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/whatsapp"
)

/* ── fakes for the external ports ─────────────────────────────────────── */

type fakeWA struct {
	result SendResult
	sent   []string
}

func (f *fakeWA) SendText(_ context.Context, _ database.Querier, target, message string) SendResult {
	f.sent = append(f.sent, target+"|"+message)
	return f.result
}

type fakeIG struct {
	cfg  *InstagramWebhookConfig
	send InstagramSend
}

func (f *fakeIG) WebhookConfig(context.Context, database.Querier) *InstagramWebhookConfig {
	return f.cfg
}
func (f *fakeIG) SendText(context.Context, database.Querier, string, string) InstagramSend {
	return f.send
}

type fakeAI struct {
	content string
	err     error
	calls   int
}

func (f *fakeAI) Complete(context.Context, database.Querier, []domain.ChatMessage) (string, string, error) {
	f.calls++
	return f.content, "openai:gpt-4o-mini", f.err
}

type fakeGoogle struct {
	fetch GoogleFetch
	reply GoogleReply
}

func (f *fakeGoogle) Status(context.Context, database.Querier) (bool, []string) {
	return false, []string{}
}
func (f *fakeGoogle) FetchReviews(context.Context, database.Querier) GoogleFetch { return f.fetch }
func (f *fakeGoogle) PutReply(context.Context, database.Querier, string, string) GoogleReply {
	return f.reply
}

type fakeNotifier struct {
	mu    sync.Mutex
	fired []string
}

func (f *fakeNotifier) Fire(notifType, dedupKey, _ string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fired = append(f.fired, notifType+":"+dedupKey)
}

/* ── setup ────────────────────────────────────────────────────────────── */

type env struct {
	t      *testing.T
	tx     pgx.Tx
	mux    *http.ServeMux
	wa     *fakeWA
	ig     *fakeIG
	ai     *fakeAI
	google *fakeGoogle
	notify *fakeNotifier
	agent  testutil.Staff
}

var testNow = time.Date(2026, 10, 4, 5, 0, 0, 0, time.UTC)

func setup(t *testing.T) *env {
	t.Helper()
	tx := testutil.Tx(t)
	d := testutil.Deps(t, func() time.Time { return testNow })
	e := &env{
		t: t, tx: tx,
		wa:     &fakeWA{result: SendResult{Success: true, Provider: "gateway", MessageID: ptr("wa-" + testutil.RandomHex(4))}},
		ig:     &fakeIG{cfg: &InstagramWebhookConfig{AppSecret: "rahasia", VerifyToken: "token-uji"}, send: InstagramSend{Success: true}},
		ai:     &fakeAI{content: `{"summary":"Tanya stok.","topic":"Tanya Stok","sentiment":"netral","is_complaint":false,"keywords":["stok kopi"]}`},
		google: &fakeGoogle{reply: GoogleReply{OK: true}},
		notify: &fakeNotifier{},
		agent:  crmtest.Staff(t, "crm.members.inbox"),
	}
	h := newHandler(tx, d, Ports{WhatsApp: e.wa, Instagram: e.ig, AI: e.ai, Google: e.google, Notifier: e.notify, Orders: PosOrdersSQL{}})
	e.mux = crmtest.Mux(h.routes())
	return e
}

func ptr[T any](v T) *T { return &v }

func (e *env) call(method, path string, body any, s *testutil.Staff) (int, map[string]any) {
	e.t.Helper()
	return crmtest.Call(e.t, e.mux, method, path, body, s)
}

func (e *env) conversation(channel, externalID string, phone *string) string {
	e.t.Helper()
	return crmtest.Scalar[string](e.t, e.tx, `INSERT INTO crm.wa_conversations (channel, external_id, phone, last_message_at, status)
		VALUES ($1, $2, $3, now(), 'open') RETURNING id::text`, channel, externalID, phone)
}

func (e *env) message(conversationID, direction, body string, at time.Time) {
	e.t.Helper()
	crmtest.MustExec(e.t, e.tx, `INSERT INTO crm.wa_messages (conversation_id, direction, message_type, body, created_at, status)
		VALUES ($1, $2, 'chat', $3, $4, 'received')`, conversationID, direction, body, at)
}

func data(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	d, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("no data object: %v", body)
	}
	return d
}

/* ── conversations ────────────────────────────────────────────────────── */

func TestConversationList(t *testing.T) {
	e := setup(t)
	if code, _ := e.call("GET", "/api/crm/inbox/conversations", nil, nil); code != 401 {
		t.Fatalf("anon: %d", code)
	}
	other := crmtest.Staff(t, "crm.reports")
	if code, _ := e.call("GET", "/api/crm/inbox/conversations", nil, &other); code != 403 {
		t.Fatalf("no grant: %d", code)
	}
	phone := "62899" + testutil.RandomHex(3)
	e.conversation("whatsapp", phone, &phone)
	code, body := e.call("GET", "/api/crm/inbox/conversations?search="+phone+"&channel=whatsapp&status=open", nil, &e.agent)
	if code != 200 {
		t.Fatalf("list: %d %v", code, body)
	}
	d := data(t, body)
	convs := d["conversations"].([]any)
	if len(convs) != 1 || convs[0].(map[string]any)["external_id"] != phone {
		t.Fatalf("conversations: %v", convs)
	}
	for _, k := range []string{"total_unread", "total_active", "total_breached", "total_complaints", "total_whatsapp", "total_instagram"} {
		if _, ok := d["totals"].(map[string]any)[k].(float64); !ok {
			t.Fatalf("totals.%s: %v", k, d["totals"])
		}
	}
	_, body = e.call("GET", "/api/crm/inbox/conversations?assigned=me", nil, &e.agent)
	if n := len(data(t, body)["conversations"].([]any)); n != 0 {
		t.Fatalf("assigned=me: %d", n)
	}
}

func TestConversationDetail(t *testing.T) {
	e := setup(t)
	if code, body := e.call("GET", "/api/crm/inbox/conversations/00000000-0000-4000-8000-000000000000", nil, &e.agent); code != 404 || body["error"] != conversationNotFound {
		t.Fatalf("missing: %d %v", code, body)
	}
	phone := "62877" + testutil.RandomHex(3)
	customer := crmtest.Scalar[string](t, e.tx, `INSERT INTO pos.pos_customers (phone, name, total_xp) VALUES ($1, 'Inbox Member', 50) RETURNING id::text`, phone)
	id := e.conversation("whatsapp", phone, &phone)
	crmtest.MustExec(t, e.tx, `UPDATE crm.wa_conversations SET customer_id = $2 WHERE id = $1`, id, customer)
	e.message(id, "in", "halo kak", testNow)
	code, body := e.call("GET", "/api/crm/inbox/conversations/"+id, nil, &e.agent)
	if code != 200 {
		t.Fatalf("detail: %d %v", code, body)
	}
	d := data(t, body)
	if len(d["messages"].([]any)) != 1 || d["notes"] == nil {
		t.Fatalf("messages/notes: %v", d)
	}
	member := d["member"].(map[string]any)
	if member["name"] != "Inbox Member" || member["total_xp"] != 50.0 || member["recent_orders"] == nil || member["recent_redemptions"] == nil {
		t.Fatalf("member: %v", member)
	}
	// Last: the 22P02 aborts the test transaction.
	if code, body := e.call("GET", "/api/crm/inbox/conversations/bukan-uuid", nil, &e.agent); code != 400 || body["error"] != "Format data tidak valid" {
		t.Fatalf("bad id: %d %v", code, body)
	}
}

func TestConversationActions(t *testing.T) {
	e := setup(t)
	phone := "62855" + testutil.RandomHex(3)
	id := e.conversation("whatsapp", phone, &phone)
	path := "/api/crm/inbox/conversations/" + id

	if code, body := e.call("POST", path, map[string]any{"action": "terbang"}, &e.agent); code != 400 || body["error"] != "Payload tidak valid" {
		t.Fatalf("bad action: %d %v", code, body)
	}
	if code, _ := e.call("POST", path, map[string]any{"action": "reply", "message": "   "}, &e.agent); code != 400 {
		t.Fatalf("blank reply: %d", code)
	}
	r := testutil.AsStaff(httptest.NewRequest("POST", path, strings.NewReader("{")), e.agent)
	if rec, _ := testutil.Do(t, e.mux, r); rec.Code != 500 {
		t.Fatalf("malformed json: %d", rec.Code)
	}

	if code, body := e.call("POST", path, map[string]any{"action": "assign_me"}, &e.agent); code != 200 || len(body) != 1 {
		t.Fatalf("assign_me: %d %v", code, body)
	}
	if s := crmtest.Scalar[string](t, e.tx, `SELECT status FROM crm.wa_conversations WHERE id = $1`, id); s != "in_progress" {
		t.Fatalf("status after assign: %s", s)
	}
	if code, _ := e.call("POST", path, map[string]any{"action": "add_note", "body": " catatan "}, &e.agent); code != 200 {
		t.Fatalf("add_note: %d", code)
	}
	if n := crmtest.Scalar[string](t, e.tx, `SELECT body FROM crm.wa_internal_notes WHERE conversation_id = $1`, id); n != "catatan" {
		t.Fatalf("note: %q", n)
	}
	if code, _ := e.call("POST", path, map[string]any{"action": "set_complaint", "is_complaint": true, "category": "produk"}, &e.agent); code != 200 {
		t.Fatalf("set_complaint: %d", code)
	}
	if len(e.notify.fired) != 1 || e.notify.fired[0] != "komplain:"+id {
		t.Fatalf("owner notification: %v", e.notify.fired)
	}

	// Reply over WhatsApp: logged as chat, SLA clock stopped, messageId returned.
	e.message(id, "in", "stok ada?", testNow.Add(-time.Minute))
	crmtest.MustExec(t, e.tx, `UPDATE crm.wa_conversations SET awaiting_since = $2 WHERE id = $1`, id, testNow.Add(-2*time.Minute))
	code, body := e.call("POST", path, map[string]any{"action": "reply", "message": " ada kak "}, &e.agent)
	if code != 200 || data(t, body)["messageId"] != *e.wa.result.MessageID {
		t.Fatalf("reply: %d %v", code, body)
	}
	if e.wa.sent[0] != phone+"|ada kak" {
		t.Fatalf("sent: %v", e.wa.sent)
	}
	if n := crmtest.Scalar[int32](t, e.tx, `SELECT first_response_seconds FROM crm.wa_conversations WHERE id = $1`, id); n != 120 {
		t.Fatalf("first_response_seconds: %d", n)
	}
	if typ := crmtest.Scalar[string](t, e.tx, `SELECT message_type FROM crm.wa_messages WHERE conversation_id = $1 AND direction = 'out'`, id); typ != "chat" {
		t.Fatalf("logged type: %s", typ)
	}

	// A refused send is 502 with the provider reason and still logged as failed.
	e.wa.result = SendResult{Provider: "gateway", Reason: "Gateway menolak permintaan kirim"}
	if code, body := e.call("POST", path, map[string]any{"action": "reply", "message": "lagi"}, &e.agent); code != 502 || body["error"] != "Gateway menolak permintaan kirim" {
		t.Fatalf("refused: %d %v", code, body)
	}
	if n := crmtest.Scalar[int64](t, e.tx, `SELECT count(*) FROM crm.wa_messages WHERE conversation_id = $1 AND status = 'failed'`, id); n != 1 {
		t.Fatalf("failed log rows: %d", n)
	}

	// Resolving asks for CSAT through WhatsApp as a system message.
	e.wa.result = SendResult{Success: true, Provider: "fonnte"}
	if code, _ := e.call("POST", path, map[string]any{"action": "set_status", "status": "resolved"}, &e.agent); code != 200 {
		t.Fatalf("resolve: %d", code)
	}
	if n := crmtest.Scalar[int64](t, e.tx, `SELECT count(*) FROM crm.wa_messages WHERE conversation_id = $1 AND message_type = 'system'`, id); n != 1 {
		t.Fatalf("csat request rows: %d", n)
	}
	if code, _ := e.call("POST", path, map[string]any{"action": "mark_read"}, &e.agent); code != 200 {
		t.Fatalf("mark_read: %d", code)
	}
	// A WhatsApp send without a provider id returns data {} (messageId undefined).
	if code, body := e.call("POST", path, map[string]any{"action": "reply", "message": "terima kasih"}, &e.agent); code != 200 || len(data(t, body)) != 0 {
		t.Fatalf("reply without id: %d %v", code, body)
	}
}

func TestInstagramReply(t *testing.T) {
	e := setup(t)
	igsid := "IGSID-" + testutil.RandomHex(4)
	id := e.conversation("instagram", igsid, nil)
	path := "/api/crm/inbox/conversations/" + id
	if code, body := e.call("POST", path, map[string]any{"action": "reply", "message": "halo"}, &e.agent); code != 409 ||
		body["error"] != "Jendela balas 24 jam Instagram sudah lewat. Tunggu pesan berikutnya dari pelanggan." {
		t.Fatalf("closed window: %d %v", code, body)
	}
	e.message(id, "in", "halo admin", testNow.Add(-time.Hour))
	code, body := e.call("POST", path, map[string]any{"action": "reply", "message": "halo juga"}, &e.agent)
	if v, ok := data(t, body)["messageId"]; code != 200 || !ok || v != nil {
		t.Fatalf("reply: %d %v", code, body)
	}
	if n := crmtest.Scalar[int64](t, e.tx, `SELECT count(*) FROM crm.wa_messages WHERE conversation_id = $1 AND direction = 'out' AND channel = 'instagram'`, id); n != 1 {
		t.Fatalf("recorded replies: %d", n)
	}
	e.ig.send = InstagramSend{Reason: "Instagram belum dikonfigurasi — lengkapi kredensial di Settings."}
	if code, body := e.call("POST", path, map[string]any{"action": "reply", "message": "x"}, &e.agent); code != 502 || !strings.HasPrefix(body["error"].(string), "Instagram belum") {
		t.Fatalf("not configured: %d %v", code, body)
	}
}

/* ── templates ────────────────────────────────────────────────────────── */

func TestTemplates(t *testing.T) {
	e := setup(t)
	admin := crmtest.Staff(t, "crm.settings")
	if code, _ := e.call("POST", "/api/crm/inbox/templates", map[string]any{"title": "x", "body": "y"}, &e.agent); code != 403 {
		t.Fatalf("inbox agent cannot manage: %d", code)
	}
	if code, body := e.call("POST", "/api/crm/inbox/templates", map[string]any{"title": "", "body": "y"}, &admin); code != 400 || body["error"] != "Payload tidak valid" {
		t.Fatalf("invalid: %d %v", code, body)
	}
	code, body := e.call("POST", "/api/crm/inbox/templates", map[string]any{"title": " Salam ", "body": "Halo kak"}, &admin)
	row := data(t, body)
	if code != 200 || row["title"] != "Salam" || row["is_active"] != true {
		t.Fatalf("create: %d %v", code, body)
	}
	id := row["id"].(string)
	if code, body := e.call("POST", "/api/crm/inbox/templates", map[string]any{"id": id, "title": "Salam", "body": "Hai", "is_active": false}, &admin); code != 200 || data(t, body)["body"] != "Hai" {
		t.Fatalf("update: %d %v", code, body)
	}
	if code, body := e.call("POST", "/api/crm/inbox/templates", map[string]any{"id": "00000000-0000-4000-8000-000000000000", "title": "a", "body": "b"}, &admin); code != 404 || body["error"] != "Template tidak ditemukan" {
		t.Fatalf("update missing: %d %v", code, body)
	}
	_, body = e.call("GET", "/api/crm/inbox/templates", nil, &e.agent)
	for _, tpl := range body["data"].([]any) {
		if tpl.(map[string]any)["id"] == id {
			t.Fatal("inactive template listed")
		}
	}
	if code, body := e.call("DELETE", "/api/crm/inbox/templates", nil, &admin); code != 400 || body["error"] != "Template id wajib diisi" {
		t.Fatalf("delete without id: %d %v", code, body)
	}
	if code, body := e.call("DELETE", "/api/crm/inbox/templates?id="+id, nil, &admin); code != 200 || body["success"] != true {
		t.Fatalf("delete: %d %v", code, body)
	}
}

/* ── analytics ────────────────────────────────────────────────────────── */

func TestAnalytics(t *testing.T) {
	e := setup(t)
	if code, body := e.call("GET", "/api/crm/inbox/analytics", nil, &e.agent); code != 400 || body["error"] != "Parameter conversation_id wajib diisi" {
		t.Fatalf("missing param: %d %v", code, body)
	}
	if code, body := e.call("POST", "/api/crm/inbox/analytics", map[string]any{"analyze_pending": false}, &e.agent); code != 400 ||
		body["error"] != "Body tidak valid (kirim {conversation_id} atau {analyze_pending:true, limit?})" {
		t.Fatalf("bad body: %d %v", code, body)
	}
	id := e.conversation("whatsapp", "62811"+testutil.RandomHex(3), nil)
	_, body := e.call("GET", "/api/crm/inbox/analytics?conversation_id="+id, nil, &e.agent)
	if v, ok := data(t, body)["insight"]; !ok || v != nil {
		t.Fatalf("no insight yet: %v", body)
	}
	code, body := e.call("POST", "/api/crm/inbox/analytics", map[string]any{"conversation_id": id}, &e.agent)
	if code != 200 || data(t, body)["status"] != "empty" {
		t.Fatalf("empty: %d %v", code, body)
	}
	e.message(id, "in", "stok kopi ada?", testNow)
	code, body = e.call("POST", "/api/crm/inbox/analytics", map[string]any{"conversation_id": id}, &e.agent)
	res := data(t, body)
	if code != 200 || res["status"] != "analyzed" || res["insight"].(map[string]any)["topic"] != "tanya stok" {
		t.Fatalf("analyzed: %d %v", code, body)
	}
	if _, has := res["error"]; has {
		t.Fatal("error only on failure")
	}
	code, body = e.call("POST", "/api/crm/inbox/analytics", map[string]any{"conversation_id": id}, &e.agent)
	if code != 200 || data(t, body)["status"] != "cache" || e.ai.calls != 1 {
		t.Fatalf("cache: %d %v calls=%d", code, body, e.ai.calls)
	}
	_, body = e.call("GET", "/api/crm/inbox/analytics?conversation_id="+id, nil, &e.agent)
	stored := data(t, body)["insight"].(map[string]any)
	if stored["model"] != "openai:gpt-4o-mini" || stored["conversation_id"] != id || len(stored["analyzed_at"].(string)) != 24 {
		t.Fatalf("stored: %v", stored)
	}
	e.ai.content = "maaf"
	code, body = e.call("POST", "/api/crm/inbox/analytics", map[string]any{"conversation_id": id, "force": true}, &e.agent)
	if res := data(t, body); code != 502 || body["success"] != false || res["status"] != "failed" || res["error"] != "Jawaban AI tidak bisa dibaca sebagai JSON" {
		t.Fatalf("failed: %d %v", code, body)
	}
	code, body = e.call("POST", "/api/crm/inbox/analytics", map[string]any{"analyze_pending": true, "limit": 1}, &e.agent)
	summary := data(t, body)["summary"].(map[string]any)
	if code != 200 || summary["requested"].(float64) > 1 {
		t.Fatalf("pending: %d %v", code, body)
	}
}

// TestOpenAIAdapter runs the real adapter against a stub chat-completions
// server configured through app_settings.
func TestOpenAIAdapter(t *testing.T) {
	tx := testutil.Tx(t)
	var calls []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		calls = append(calls, body)
		if _, jsonMode := body["response_format"]; jsonMode {
			w.WriteHeader(400)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": `{"topic":"x"}`}}}})
	}))
	defer srv.Close()
	crmtest.MustExec(t, tx, `INSERT INTO configuration.app_settings (key, value) VALUES
		('openai_api_key', 'sk-test'), ('openai_base_url', $1), ('openai_model', 'gpt-unknown')
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, srv.URL+"/")
	messages := domain.AnalysisMessages([]domain.TranscriptMessage{{Direction: "in", Body: "halo"}})
	// The base URL is a setting: a loopback or plain-http one is refused
	// unless SAFEHTTP_ALLOW_HOSTS lists it.
	if _, _, err := (OpenAIChat{Getenv: func(string) string { return "" }}).Complete(context.Background(), tx, messages); err == nil || err.Error() != msgOpenAIBaseBlocked || len(calls) != 0 {
		t.Fatalf("unlisted loopback base URL: %v, %d calls", err, len(calls))
	}
	allow := func(k string) string {
		if k == "SAFEHTTP_ALLOW_HOSTS" {
			return strings.TrimPrefix(srv.URL, "http://")
		}
		return ""
	}
	content, model, err := OpenAIChat{Getenv: allow}.Complete(context.Background(), tx, messages)
	if err != nil || content != `{"topic":"x"}` || model != "openai:gpt-4o-mini" {
		t.Fatalf("complete: %q %q %v", content, model, err)
	}
	if len(calls) != 2 || calls[1]["model"] != "gpt-4o-mini" || calls[1]["temperature"] != 0.0 {
		t.Fatalf("calls: %v", calls)
	}
}

/* ── reviews ──────────────────────────────────────────────────────────── */

func (e *env) review(rating int, name string) string {
	e.t.Helper()
	return crmtest.Scalar[string](e.t, e.tx, `INSERT INTO crm.google_reviews (review_id, review_name, reviewer_name, star_rating, review_created_at)
		VALUES ($1, $2, 'Budi', $3, now() - interval '2 days') RETURNING id::text`, name, "accounts/1/locations/9/reviews/"+name, rating)
}

func TestReviewList(t *testing.T) {
	e := setup(t)
	e.review(2, "rv-"+testutil.RandomHex(4))
	code, body := e.call("GET", "/api/crm/reviews?rating=2&status=baru", nil, &e.agent)
	if code != 200 {
		t.Fatalf("list: %d %v", code, body)
	}
	d := data(t, body)
	reviews := d["reviews"].([]any)
	if len(reviews) == 0 {
		t.Fatal("no reviews")
	}
	first := reviews[0].(map[string]any)
	if first["sla_breached"] != true || first["waiting_seconds"].(float64) <= 0 {
		t.Fatalf("sla: %v", first)
	}
	settings := d["settings"].(map[string]any)
	if _, ok := settings["complaintMaxRating"].(float64); !ok {
		t.Fatalf("settings: %v", settings)
	}
	if v := d["viewer"].(map[string]any); v["canApprove"] != true {
		t.Fatalf("admin viewer: %v", v)
	}
	if i := d["integration"].(map[string]any); i["configured"] != false {
		t.Fatalf("integration: %v", i)
	}
	if _, ok := d["summary"].(map[string]any)["rata_rating"].(string); !ok {
		t.Fatalf("rata_rating is numeric text: %v", d["summary"])
	}
	if code, body := e.call("GET", "/api/crm/reviews?rating=2.5", nil, &e.agent); code != 400 || body["error"] != "Format data tidak valid" {
		t.Fatalf("fractional rating: %d %v", code, body)
	}
}

func TestReviewReplies(t *testing.T) {
	e := setup(t)
	agent := testutil.CreateStaff(t, testutil.StaffOptions{Role: "pos", Menus: map[string][]string{"crm.members.inbox": {"read", "create", "update"}}})
	low := e.review(1, "rv-"+testutil.RandomHex(4))
	if code, body := e.call("POST", "/api/crm/reviews", map[string]any{"action": "reply", "id": "x", "comment": "a"}, &agent); code != 400 || body["error"] != "Payload tidak valid" {
		t.Fatalf("invalid: %d %v", code, body)
	}
	code, body := e.call("POST", "/api/crm/reviews", map[string]any{"action": "reply", "id": low, "comment": " Mohon maaf "}, &agent)
	if code != 200 || data(t, body)["pending"] != true {
		t.Fatalf("pending draft: %d %v", code, body)
	}
	if code, body := e.call("POST", "/api/crm/reviews", map[string]any{"action": "approve_reply", "id": low}, &agent); code != 403 ||
		body["error"] != "Hanya admin/super admin yang boleh menyetujui balasan" {
		t.Fatalf("non-approver approve: %d %v", code, body)
	}
	e.google.reply = GoogleReply{Reason: googleNotReady, NotConfigured: true}
	if code, body := e.call("POST", "/api/crm/reviews", map[string]any{"action": "approve_reply", "id": low}, &e.agent); code != 409 || body["error"] != googleNotReady {
		t.Fatalf("approve unconfigured: %d %v", code, body)
	}
	e.google.reply = GoogleReply{OK: true}
	if code, _ := e.call("POST", "/api/crm/reviews", map[string]any{"action": "approve_reply", "id": low}, &e.agent); code != 200 {
		t.Fatalf("approve: %d", code)
	}
	status := crmtest.Scalar[string](t, e.tx, `SELECT status || ':' || reply_comment || ':' || reply_approval_status FROM crm.google_reviews WHERE id = $1`, low)
	if status != "dibalas:Mohon maaf:approved" {
		t.Fatalf("approved row: %s", status)
	}
	if code, body := e.call("POST", "/api/crm/reviews", map[string]any{"action": "reject_reply", "id": low}, &e.agent); code != 404 || body["error"] != noPendingReply {
		t.Fatalf("reject without draft: %d %v", code, body)
	}
	high := e.review(5, "rv-"+testutil.RandomHex(4))
	e.google.reply = GoogleReply{Reason: "quota"}
	if code, body := e.call("POST", "/api/crm/reviews", map[string]any{"action": "reply", "id": high, "comment": "Terima kasih"}, &agent); code != 502 || body["error"] != "quota" {
		t.Fatalf("google refused: %d %v", code, body)
	}
	e.google.reply = GoogleReply{OK: true}
	if code, body := e.call("POST", "/api/crm/reviews", map[string]any{"action": "reply", "id": high, "comment": "Terima kasih"}, &agent); code != 200 || data(t, body)["pending"] != false {
		t.Fatalf("direct reply: %d %v", code, body)
	}
	if code, body := e.call("POST", "/api/crm/reviews", map[string]any{"action": "ignore", "id": high}, &agent); code != 200 || len(body) != 1 {
		t.Fatalf("ignore: %d %v", code, body)
	}
}

func TestReviewSync(t *testing.T) {
	e := setup(t)
	e.google.fetch = GoogleFetch{Reason: googleNotReady, NotConfigured: true}
	if code, body := e.call("POST", "/api/crm/reviews", map[string]any{"action": "sync"}, &e.agent); code != 409 || body["notConfigured"] != true || body["success"] != false {
		t.Fatalf("not configured: %d %v", code, body)
	}
	id := testutil.RandomHex(5)
	reviews := []json.RawMessage{
		json.RawMessage(`{"name":"accounts/1/locations/7/reviews/` + id + `","starRating":"ONE","comment":"lama","createTime":"2026-10-01T10:00:00Z","reviewer":{"displayName":"Ani"}}`),
		json.RawMessage(`{"name":"tanpa-rating","createTime":"2026-10-01T10:00:00Z"}`),
	}
	e.google.fetch = GoogleFetch{OK: true, Reviews: reviews}
	code, body := e.call("POST", "/api/crm/reviews", map[string]any{"action": "sync"}, &e.agent)
	if s := data(t, body); code != 200 || s["fetched"] != 2.0 || s["inserted"] != 1.0 || s["skipped"] != 1.0 {
		t.Fatalf("first sync: %d %v", code, body)
	}
	if len(e.notify.fired) != 1 || e.notify.fired[0] != "reviewRendah:"+id {
		t.Fatalf("owner ping: %v", e.notify.fired)
	}
	_, body = e.call("POST", "/api/crm/reviews", map[string]any{"action": "sync"}, &e.agent)
	if s := data(t, body); s["updated"] != 1.0 || s["inserted"] != 0.0 || len(e.notify.fired) != 1 {
		t.Fatalf("second sync: %v %v", body, e.notify.fired)
	}
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_settings (key, value) VALUES ('gr_sync_enabled', 'false')
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)
	code, body = e.call("POST", "/api/crm/reviews", map[string]any{"action": "sync"}, &e.agent)
	if _, has := body["notConfigured"]; code != 502 || body["error"] != "Sinkronisasi dinonaktifkan" || has {
		t.Fatalf("disabled: %d %v", code, body)
	}
}

/* ── instagram webhook ────────────────────────────────────────────────── */

func TestInstagramWebhook(t *testing.T) {
	e := setup(t)
	get := func(q string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		e.mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/crm/instagram/webhook"+q, nil))
		return rec
	}
	if rec := get("?hub.mode=subscribe&hub.verify_token=token-uji&hub.challenge=12345"); rec.Code != 200 || rec.Body.String() != "12345" || rec.Header().Get("Content-Type") != "text/plain" {
		t.Fatalf("handshake: %d %q", rec.Code, rec.Body.String())
	}
	if rec := get("?hub.mode=subscribe&hub.verify_token=salah&hub.challenge=1"); rec.Code != 403 || rec.Body.String() != "Forbidden" {
		t.Fatalf("wrong token: %d", rec.Code)
	}
	post := func(body, sig string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/crm/instagram/webhook", bytes.NewBufferString(body))
		if sig != "" {
			r.Header.Set("X-Hub-Signature-256", sig)
		}
		rec := httptest.NewRecorder()
		e.mux.ServeHTTP(rec, r)
		return rec
	}
	sender := "IGSID-" + testutil.RandomHex(4)
	mid := "mid-" + testutil.RandomHex(4)
	payload := `{"object":"instagram","entry":[{"messaging":[{"sender":{"id":"` + sender + `"},"timestamp":1759550000000,"message":{"mid":"` + mid + `","text":"halo"}}]}]}`
	if rec := post(payload, "sha256=salah"); rec.Code != 401 || rec.Body.String() != "Signature tidak valid" {
		t.Fatalf("bad signature: %d", rec.Code)
	}
	if rec := post("{oops", sign("{oops")); rec.Code != 200 || rec.Body.String() != `{"received":true}` {
		t.Fatalf("malformed: %d %s", rec.Code, rec.Body.String())
	}
	if rec := post(payload, sign(payload)); rec.Code != 200 || rec.Body.String() != `{"received":true,"stored":1}` {
		t.Fatalf("stored: %d %s", rec.Code, rec.Body.String())
	}
	if rec := post(payload, sign(payload)); rec.Body.String() != `{"received":true,"stored":0}` {
		t.Fatalf("resend: %s", rec.Body.String())
	}
	unread := crmtest.Scalar[int32](t, e.tx, `SELECT unread_count FROM crm.wa_conversations WHERE channel = 'instagram' AND external_id = $1`, sender)
	if unread != 1 {
		t.Fatalf("unread: %d", unread)
	}
	e.ig.cfg = nil
	if rec := get(""); rec.Code != 503 || rec.Body.String() != "Instagram belum dikonfigurasi" {
		t.Fatalf("unconfigured: %d", rec.Code)
	}
}

func sign(body string) string {
	mac := hmac.New(sha256.New, []byte("rahasia"))
	mac.Write([]byte(body))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

/* ── adapters ─────────────────────────────────────────────────────────── */

func TestWhatsAppGatewayAdapter(t *testing.T) {
	tx := testutil.Tx(t)
	var token string
	status := 200
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token = r.Header.Get("x-gateway-token")
		w.WriteHeader(status)
		if status == 200 {
			_, _ = w.Write([]byte(`{"messageId":"m-1"}`))
			return
		}
		_, _ = w.Write([]byte(`{"error":"Nomor tidak terdaftar"}`))
	}))
	defer srv.Close()
	crmtest.MustExec(t, tx, `INSERT INTO configuration.app_settings (key, value) VALUES ('wa_gateway_url', $1), ('wa_gateway_token', 'tok')
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, srv.URL)
	newGateway := func() *WhatsAppGateway {
		c := whatsapp.New(nil)
		c.Getenv = func(string) string { return "" }
		return &WhatsAppGateway{Client: c}
	}
	g := newGateway()
	res := g.SendText(context.Background(), tx, "6281", "halo")
	if !res.Success || res.Provider != "gateway" || *res.MessageID != "m-1" || token != "tok" {
		t.Fatalf("sent: %+v token=%q", res, token)
	}
	status = 400
	if res := g.SendText(context.Background(), tx, "6281", "halo"); res.Success || res.Reason != "Nomor tidak terdaftar" {
		t.Fatalf("refused: %+v", res)
	}
	if res := newGateway().SendText(context.Background(), testutil.Tx(t), "1", "x"); res.Reason != whatsapp.NotConfigured {
		t.Fatalf("unconfigured: %+v", res)
	}
}
