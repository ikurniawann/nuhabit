package whatsapp

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/testutil"
)

// stub is a provider endpoint that records requests and answers with
// status and body.
type stub struct {
	mu       sync.Mutex
	status   int
	body     string
	delay    chan struct{}
	paths    []string
	headers  []http.Header
	requests []map[string]any
}

func (s *stub) start(t *testing.T) string {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var m map[string]any
		_ = json.Unmarshal(raw, &m)
		s.mu.Lock()
		s.paths, s.headers, s.requests = append(s.paths, r.URL.Path), append(s.headers, r.Header.Clone()), append(s.requests, m)
		status, body, delay := s.status, s.body, s.delay
		s.mu.Unlock()
		if delay != nil {
			<-delay
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func digits(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte('0' + rand.IntN(10))
	}
	return string(b)
}

func newClient(t *testing.T, tx pgx.Tx, env map[string]string) *Client {
	t.Helper()
	if _, err := tx.Exec(context.Background(), `DELETE FROM configuration.app_settings WHERE key IN ('wa_gateway_url', 'wa_gateway_token', 'wa_notif_config')`); err != nil {
		t.Fatal(err)
	}
	c := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.Getenv = func(k string) string { return env[k] }
	return c
}

func setting(t *testing.T, tx pgx.Tx, key, value string) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), `INSERT INTO configuration.app_settings (key, value) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, key, value); err != nil {
		t.Fatal(err)
	}
}

type logRow struct{ messageType, status, provider, providerID, reason, body, sentBy, customer string }

// loggedMessage reads the log row of one message; rows written in one
// transaction share created_at, so the body ("" for an OTP's NULL) picks it.
func loggedMessage(t *testing.T, tx pgx.Tx, phone, body string) logRow {
	t.Helper()
	var r logRow
	err := tx.QueryRow(context.Background(), `SELECT message_type, status, COALESCE(provider, ''), COALESCE(provider_message_id, ''),
		COALESCE(error_reason, ''), COALESCE(body, '<null>'), COALESCE(sent_by_user_id::text, ''), COALESCE(customer_id::text, '')
		FROM crm.wa_messages WHERE phone = $1 AND COALESCE(body, '') = $2`, phone, body).
		Scan(&r.messageType, &r.status, &r.provider, &r.providerID, &r.reason, &r.body, &r.sentBy, &r.customer)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestSendTextProviders(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	phone := "62899" + digits(7)
	var customer string
	if err := tx.QueryRow(ctx, `INSERT INTO pos.pos_customers (name, phone) VALUES ('WA Test', $1) RETURNING id::text`, "0"+phone[2:]).Scan(&customer); err != nil {
		t.Fatal(err)
	}

	// Nothing configured.
	c := newClient(t, tx, nil)
	if res := c.SendText(ctx, tx, phone, "hai", "", ""); res.Success || res.Reason != NotConfigured {
		t.Fatalf("unconfigured = %+v", res)
	}
	if r := loggedMessage(t, tx, phone, "hai"); r.status != "failed" || r.messageType != "notification" || r.reason != NotConfigured || r.customer != customer || r.body != "hai" {
		t.Fatalf("log = %+v", r)
	}

	// Gateway: the app_settings token (trimmed) beats the env.
	gw := &stub{status: 200, body: `{"messageId":"gw-1"}`}
	c = newClient(t, tx, map[string]string{"WA_GATEWAY_TOKEN": "env-token"})
	setting(t, tx, "wa_gateway_url", gw.start(t))
	setting(t, tx, "wa_gateway_token", " db-token ")
	if res := c.SendText(ctx, tx, phone, "tagihan", "broadcast", "00000000-0000-0000-0000-000000000001"); !res.Success || res.Provider != "gateway" || res.MessageID != "gw-1" {
		t.Fatalf("gateway = %+v", res)
	}
	if gw.paths[0] != "/send" || gw.headers[0].Get("x-gateway-token") != "db-token" || gw.requests[0]["target"] != phone || gw.requests[0]["message"] != "tagihan" {
		t.Fatalf("gateway request = %v %v %v", gw.paths, gw.headers[0], gw.requests[0])
	}
	if r := loggedMessage(t, tx, phone, "tagihan"); r.status != "sent" || r.messageType != "broadcast" || r.provider != "gateway" || r.providerID != "gw-1" || r.sentBy == "" {
		t.Fatalf("log = %+v", r)
	}
	gw.status, gw.body = 503, `{"error":"Sesi WA terputus"}`
	if res := c.Dispatch(ctx, tx, phone, "x"); res.Success || res.Reason != "Sesi WA terputus" {
		t.Fatalf("gateway refusal = %+v", res)
	}
	gw.body = `nope`
	if res := c.Dispatch(ctx, tx, phone, "x"); res.Reason != "Gateway menolak permintaan kirim" {
		t.Fatalf("gateway default refusal = %+v", res)
	}

	// Meta wins the auto detection.
	meta := &stub{status: 400, body: `{"error":{"message":"Re-engagement message","code":131047,"error_subcode":2494010}}`}
	c = newClient(t, tx, map[string]string{"META_WA_ACCESS_TOKEN": "tok", "META_WA_PHONE_NUMBER_ID": "123", "WA_GATEWAY_TOKEN": "x"})
	c.MetaBase = meta.start(t)
	if res := c.Dispatch(ctx, tx, phone, "halo"); res.Success || res.Provider != "meta" || res.Reason != "Re-engagement message · code 131047 · subcode 2494010" {
		t.Fatalf("meta refusal = %+v", res)
	}
	if meta.paths[0] != "/v21.0/123/messages" || meta.headers[0].Get("Authorization") != "Bearer tok" || meta.requests[0]["type"] != "text" ||
		meta.requests[0]["text"].(map[string]any)["body"] != "halo" {
		t.Fatalf("meta request = %v %v", meta.paths, meta.requests[0])
	}
	meta.status, meta.body = 200, `{"messages":[{"id":"wamid.1"}]}`
	if res := c.Dispatch(ctx, tx, phone, "halo"); !res.Success || res.MessageID != "wamid.1" {
		t.Fatalf("meta = %+v", res)
	}

	// An explicit provider without credentials is not configured.
	c = newClient(t, tx, map[string]string{"WHATSAPP_PROVIDER": "meta", "FONNTE_API_KEY": "fk"})
	if res := c.Dispatch(ctx, tx, phone, "x"); res.Reason != NotConfigured {
		t.Fatalf("explicit meta = %+v", res)
	}

	// Fonnte: an HTTP 200 succeeds even with status false; a non-JSON body fails.
	fon := &stub{status: 200, body: `{"status":false,"reason":"invalid token"}`}
	c = newClient(t, tx, map[string]string{"WHATSAPP_PROVIDER": "fonnte", "FONNTE_API_KEY": "fk"})
	c.FonnteURL = fon.start(t)
	if res := c.Dispatch(ctx, tx, phone, "x"); !res.Success || res.Provider != "fonnte" || res.Reason != "invalid token" {
		t.Fatalf("fonnte = %+v", res)
	}
	if fon.headers[0].Get("Authorization") != "fk" {
		t.Fatal("fonnte auth header")
	}
	fon.status, fon.body = 502, ``
	if res := c.Dispatch(ctx, tx, phone, "x"); res.Success || res.Reason != "Unexpected end of JSON input" {
		t.Fatalf("fonnte broken = %+v", res)
	}
}

func TestSendOTP(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	phone := "62877" + digits(7)
	meta := &stub{status: 200, body: `{"messages":[{"id":"wamid.otp"}]}`}
	c := newClient(t, tx, map[string]string{"META_WA_ACCESS_TOKEN": "tok", "META_WA_PHONE_NUMBER_ID": "9", "META_WA_OTP_LANG": "en"})
	c.MetaBase = meta.start(t)
	if res := c.SendOTP(ctx, tx, phone, "123456", "Kode 123456"); !res.Success {
		t.Fatalf("otp = %+v", res)
	}
	raw, _ := json.Marshal(meta.requests[0]["template"])
	want := `{"components":[{"parameters":[{"text":"123456","type":"text"}],"type":"body"},{"index":"0","parameters":[{"text":"123456","type":"text"}],"sub_type":"url","type":"button"}],"language":{"code":"en"},"name":"otp_login"}`
	if string(raw) != want {
		t.Fatalf("template = %s", raw)
	}
	if r := loggedMessage(t, tx, phone, ""); r.messageType != "otp" || r.body != "<null>" || r.providerID != "wamid.otp" {
		t.Fatalf("otp log = %+v", r)
	}

	// Gateway and Fonnte send the fallback text.
	gw := &stub{status: 200, body: `{}`}
	c = newClient(t, tx, map[string]string{"WA_GATEWAY_TOKEN": "t", "WA_GATEWAY_URL": gw.start(t)})
	c.SendOTP(ctx, tx, phone, "123456", "Kode 123456")
	if gw.requests[0]["message"] != "Kode 123456" {
		t.Fatalf("fallback = %v", gw.requests[0])
	}
}

func TestGatewayTimeoutAndCache(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	release := make(chan struct{})
	gw := &stub{status: 200, body: `{}`, delay: release}
	url := gw.start(t)
	t.Cleanup(func() { close(release) })
	c := newClient(t, tx, map[string]string{"WA_GATEWAY_TOKEN": "t", "WA_GATEWAY_URL": url, "WA_GATEWAY_TIMEOUT_MS": "50"})
	g := c.LoadGateway(ctx, tx)
	if g == nil || g.Timeout != 50*time.Millisecond || g.BaseURL != url {
		t.Fatalf("gateway = %+v", g)
	}
	if res := g.SendText(ctx, "62811", "x"); res.Success || !res.TimedOut || res.Reason != timeoutReason {
		t.Fatalf("timeout = %+v", res)
	}
	// Cached: a token saved afterwards is seen only after 30 seconds.
	setting(t, tx, "wa_gateway_token", "baru")
	if c.LoadGateway(ctx, tx).Token != "t" {
		t.Fatal("cache ignored")
	}
	// A dead endpoint is fetch failed.
	if res := (&Gateway{BaseURL: "http://127.0.0.1:1", Token: "t", Timeout: time.Second}).SendText(ctx, "62811", "x"); res.TimedOut || res.Reason != "fetch failed" {
		t.Fatalf("dead = %+v", res)
	}
}

func TestParseNotifConfig(t *testing.T) {
	def := ParseNotifConfig("")
	if def.Enabled || len(def.Recipients) != 0 || !def.Types["voidBesar"] || !def.Types["prMendesak"] || def.Types["unknown"] || def.VoidThresholdRp != 500000 {
		t.Fatalf("default = %+v", def)
	}
	if got := ParseNotifConfig("not json"); got.VoidThresholdRp != 500000 || got.Enabled {
		t.Fatalf("broken = %+v", got)
	}
	got := ParseNotifConfig(`{"enabled":true,"recipients":["0812-3456-7890","+6281234567890","12345","628111111111",7],"types":{"voidBesar":false,"komplain":"no"},"voidThresholdRp":250000.5}`)
	if !got.Enabled || got.Types["voidBesar"] || !got.Types["komplain"] || got.VoidThresholdRp != 250001 ||
		strings.Join(got.Recipients, ",") != "6281234567890,628111111111" {
		t.Fatalf("parsed = %+v", got)
	}
	// Five valid entries are kept before duplicates collapse.
	got = ParseNotifConfig(`{"recipients":["0811111111","0811111111","0811111111","0811111111","0811111111","0822222222"]}`)
	if strings.Join(got.Recipients, ",") != "62811111111" {
		t.Fatalf("recipients = %v", got.Recipients)
	}
	for in, want := range map[string]string{"0812 3456 7890": "6281234567890", "+62 812-3456": "", "5512345678": "", "62123456789012345": ""} {
		if got := NormalizeRecipient(in); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
}

func TestOwnerNotification(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	gw := &stub{status: 200, body: `{}`}
	c := newClient(t, tx, map[string]string{"WA_GATEWAY_TOKEN": "t", "WA_GATEWAY_URL": gw.start(t)})
	key := "go-test-" + testutil.RandomHex(4)
	claims := func() int {
		var n int
		_ = tx.QueryRow(ctx, `SELECT count(*) FROM configuration.wa_notif_log WHERE notif_type = 'komplain' AND dedup_key = $1`, key).Scan(&n)
		return n
	}

	// Master switch off (the default): silent, nothing claimed.
	if err := c.SendOwnerNotification(ctx, tx, "komplain", key, "pesan", nil); err != nil || len(gw.requests) != 0 || claims() != 0 {
		t.Fatalf("disabled: %v, %d sent", err, len(gw.requests))
	}
	setting(t, tx, "wa_notif_config", `{"enabled":true,"recipients":["081234567890","081298765432"]}`)
	for range 2 {
		if err := c.SendOwnerNotification(ctx, tx, "komplain", key, "pesan", nil); err != nil {
			t.Fatal(err)
		}
	}
	if len(gw.requests) != 2 || gw.requests[0]["target"] != "6281234567890" || gw.requests[1]["target"] != "6281298765432" || claims() != 1 {
		t.Fatalf("sent = %v, claims = %d", gw.requests, claims())
	}

	// Every recipient refused: the claim is released for a retry.
	gw.status, key = 500, key+"-x"
	if err := c.SendOwnerNotification(ctx, tx, "komplain", key, "pesan", nil); err != nil || claims() != 0 {
		t.Fatalf("refused: %v, claims = %d", err, claims())
	}

	// Claim and Release directly.
	id, err := Claim(ctx, tx, "cuti", key, "m", nil)
	if err != nil || id == "" {
		t.Fatalf("claim = %q, %v", id, err)
	}
	if again, err := Claim(ctx, tx, "cuti", key, "m", nil); err != nil || again != "" {
		t.Fatalf("duplicate claim = %q, %v", again, err)
	}
	var recipients string
	_ = tx.QueryRow(ctx, `SELECT recipients::text FROM configuration.wa_notif_log WHERE id = $1`, id).Scan(&recipients)
	if recipients != "[]" {
		t.Fatalf("recipients = %s", recipients)
	}
	if err := Release(ctx, tx, id); err != nil {
		t.Fatal(err)
	}
	if again, _ := Claim(ctx, tx, "cuti", key, "m", nil); again == "" {
		t.Fatal("released key not claimable")
	}
}
