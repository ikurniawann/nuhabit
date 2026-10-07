package adapters

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"nuhabit/backend/internal/modules/possales/domain"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/testutil"
)

func TestWaktuWIB(t *testing.T) {
	// Expected strings printed by node v26: toLocaleString("id-ID",
	// {timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short"}).
	for in, want := range map[string]string{
		"2026-10-04T05:07:00Z": "4 Okt 2026, 12.07",
		"2026-01-31T17:30:00Z": "1 Feb 2026, 00.30",
		"2026-05-09T23:59:59Z": "10 Mei 2026, 06.59",
		"2026-12-25T00:00:00Z": "25 Des 2026, 07.00",
		"2026-02-01T16:05:00Z": "1 Feb 2026, 23.05",
		"2026-08-01T00:00:00Z": "1 Agu 2026, 07.00",
	} {
		at, _ := time.Parse(time.RFC3339, in)
		if got := domain.WaktuWIB(at); got != want {
			t.Errorf("%s → %q, want %q", in, got, want)
		}
	}
	// toLocaleDateString("id-ID", {day, month: "long", year}) on a WIB server.
	for in, want := range map[string]string{`"2027-02-28T03:04:05.678Z"`: "28 Februari 2027", `"2027-02-28T20:04:05.678Z"`: "1 Maret 2027", `null`: "tanpa batas waktu"} {
		if got := formatGiftExpiry(json.RawMessage(in)); got != want {
			t.Errorf("%s → %q", in, got)
		}
	}
}

func TestCompNotifMessage(t *testing.T) {
	approved := " Ricky Ardiansyah "
	at, _ := time.Parse(time.RFC3339, "2026-08-24T08:30:00Z")
	got := buildCompNotifMessage(ports.CompNotice{CompType: "foc_comp", OrderNumber: "POS-20260824-0044", GrossIdr: 20000, ApprovedName: &approved}, nil, at)
	want := "NüHabit OS — Komplimen FOC (Free of Charge)\nOrder : POS-20260824-0044\nCustomer : -\nNilai : Rp 20.000\nDisetujui : Ricky Ardiansyah\n24 Agu 2026, 15.30 WIB"
	if got != want {
		t.Fatalf("got %q", got)
	}
	name := "Budi Santoso"
	got = buildCompNotifMessage(ports.CompNotice{CompType: "owner_comp", OrderNumber: "CHK-1", OrderCount: 2, GrossIdr: 104999.5}, &name, at)
	for _, part := range []string{"Komplimen Owner Comp", "Order : CHK-1 (2 order)", "Customer : Budi Santoso", "Nilai : Rp 105.000", "Disetujui : -"} {
		if !strings.Contains(got, part) {
			t.Errorf("missing %q in %q", part, got)
		}
	}
	if compDedupKey(ports.CompNotice{CompType: "foc_comp", OrderNumber: strings.Repeat("x", 200)}) != "comp:foc_comp:"+strings.Repeat("x", 146) {
		t.Error("dedup key not cut to 160")
	}
}

func TestVoidAndGiftMessages(t *testing.T) {
	got := buildVoidBesarMessage("ORD-0042", 750_000, "salah input menu", "Budi")
	want := "🚨 *Void Bernilai Besar*\n\nOrder ORD-0042 senilai *Rp750.000* di-void.\nAlasan: salah input menu\nDisetujui: Budi\n\nCek POS → Laporan untuk rinciannya."
	if got != want {
		t.Fatalf("void = %q", got)
	}
	buyer := "Sari"
	one := buildGiftCardSoldMessage(&buyer, []ports.IssuedGiftCard{{Code: "ABCD2345EFGH", InitialValue: 100000, ExpiresAt: json.RawMessage("null")}})
	if one != "*Gift Card aktif* 🎁\n\nHalo Sari,\n\nGift card kamu sudah aktif dan bisa langsung dipakai di kasir:\n\n• Kode: *ABCD2345EFGH*\n  Saldo: Rp100.000\n  Berlaku: tanpa batas waktu\n\nSimpan kode ini baik-baik. Siapa pun yang memegang kode ini bisa memakai saldonya." {
		t.Fatalf("gift = %q", one)
	}
	two := buildGiftCardSoldMessage(nil, []ports.IssuedGiftCard{{Code: "A", InitialValue: 1, ExpiresAt: json.RawMessage("null")}, {Code: "B", InitialValue: 2, ExpiresAt: json.RawMessage(`"2027-01-01T00:00:00.000Z"`)}})
	if !strings.HasPrefix(two, "*Gift Card aktif* 🎁\n\nGift card kamu") || !strings.Contains(two, "Berlaku: 1 Januari 2027") || !strings.Contains(two, "Simpan semua kode di atas baik-baik.") {
		t.Fatalf("gift two = %q", two)
	}
}

// fakeProvider records requests and answers with status/body.
type fakeProvider struct {
	mu       sync.Mutex
	requests []map[string]any
	headers  []http.Header
	paths    []string
	status   int
	body     string
}

func (f *fakeProvider) server(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var m map[string]any
		_ = json.Unmarshal(raw, &m)
		f.mu.Lock()
		f.requests, f.headers, f.paths = append(f.requests, m), append(f.headers, r.Header.Clone()), append(f.paths, r.URL.Path)
		status, body := f.status, f.body
		f.mu.Unlock()
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func testNotifier(t *testing.T, tx pgx.Tx, env map[string]string) *Notifier {
	mustExec(t, tx, `DELETE FROM configuration.app_settings WHERE key IN ('wa_gateway_url', 'wa_gateway_token', 'wa_notif_config')`)
	n := NewNotifier(tx, slog.New(slog.NewTextHandler(io.Discard, nil)), func() time.Time {
		return time.Date(2026, 8, 24, 8, 30, 0, 0, time.UTC)
	})
	n.wa.Getenv = func(k string) string { return env[k] }
	return n
}

type waRow struct{ messageType, status, provider, providerID, errReason, body, sentBy, customer string }

// waMessage reads the log row of one message (rows written in one
// transaction share created_at, so the body identifies it).
func waMessage(t *testing.T, tx pgx.Tx, phone, body string) waRow {
	t.Helper()
	var r waRow
	err := tx.QueryRow(context.Background(), `SELECT message_type, status, COALESCE(provider, ''), COALESCE(provider_message_id, ''),
		COALESCE(error_reason, ''), COALESCE(body, ''), COALESCE(sent_by_user_id::text, ''), COALESCE(customer_id::text, '')
		FROM crm.wa_messages WHERE phone = $1 AND body = $2`, phone, body).
		Scan(&r.messageType, &r.status, &r.provider, &r.providerID, &r.errReason, &r.body, &r.sentBy, &r.customer)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestSendTextProviders(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	phone := "62899" + randDigits(7)
	customer := newCustomer(t, tx, "0"+phone[2:])

	// Not configured.
	n := testNotifier(t, tx, nil)
	if d := n.SendText(ctx, phone, "hai", "", ""); d.OK || d.Reason != "WhatsApp provider belum dikonfigurasi" {
		t.Fatalf("unconfigured = %+v", d)
	}
	if r := waMessage(t, tx, phone, "hai"); r.status != "failed" || r.messageType != "notification" || r.errReason != "WhatsApp provider belum dikonfigurasi" || r.customer != customer || r.body != "hai" {
		t.Fatalf("log = %+v (customer %s, phone %s)", r, customer, phone)
	}

	// Gateway (token from app_settings beats the env).
	gw := &fakeProvider{status: 200, body: `{"messageId":"gw-` + randDigits(6) + `"}`}
	srv := gw.server(t)
	n = testNotifier(t, tx, map[string]string{"WA_GATEWAY_TOKEN": "env-token"})
	mustExec(t, tx, `INSERT INTO configuration.app_settings (key, value) VALUES ('wa_gateway_url', $1), ('wa_gateway_token', ' db-token ')`, srv.URL)
	if d := n.SendText(ctx, phone, "tagihan", "notification", ""); !d.OK {
		t.Fatalf("gateway = %+v", d)
	}
	if gw.paths[0] != "/send" || gw.headers[0].Get("x-gateway-token") != "db-token" || gw.requests[0]["target"] != phone || gw.requests[0]["message"] != "tagihan" {
		t.Fatalf("gateway request = %v %v %v", gw.paths, gw.headers[0], gw.requests[0])
	}
	if r := waMessage(t, tx, phone, "tagihan"); r.status != "sent" || r.provider != "gateway" || !strings.HasPrefix(r.providerID, "gw-") {
		t.Fatalf("log = %+v", r)
	}
	gw.status, gw.body = 503, `{"error":"Sesi WA terputus"}`
	if d := n.SendText(ctx, phone, "x", "", ""); d.OK || d.Reason != "Sesi WA terputus" {
		t.Fatalf("gateway error = %+v", d)
	}
	gw.body = `nope`
	if d := n.SendText(ctx, phone, "x", "", ""); d.Reason != "Gateway menolak permintaan kirim" {
		t.Fatalf("gateway default error = %+v", d)
	}

	// Meta wins the auto detection.
	meta := &fakeProvider{status: 400, body: `{"error":{"message":"Re-engagement message","code":131047,"error_subcode":2494010}}`}
	msrv := meta.server(t)
	n = testNotifier(t, tx, map[string]string{"META_WA_ACCESS_TOKEN": "tok", "META_WA_PHONE_NUMBER_ID": "123", "WA_GATEWAY_TOKEN": "x"})
	n.wa.MetaBase = msrv.URL
	if d := n.SendText(ctx, phone, "halo", "", "00000000-0000-0000-0000-000000000001"); d.OK || d.Reason != "Re-engagement message · code 131047 · subcode 2494010" {
		t.Fatalf("meta error = %+v", d)
	}
	if meta.paths[0] != "/v21.0/123/messages" || meta.headers[0].Get("Authorization") != "Bearer tok" || meta.requests[0]["type"] != "text" {
		t.Fatalf("meta request = %v %v", meta.paths, meta.requests[0])
	}
	if r := waMessage(t, tx, phone, "halo"); r.provider != "meta" || r.sentBy != "00000000-0000-0000-0000-000000000001" {
		t.Fatalf("meta log = %+v", r)
	}

	// Fonnte when forced.
	fon := &fakeProvider{status: 200, body: `{"status":false,"reason":"invalid token"}`}
	fsrv := fon.server(t)
	n = testNotifier(t, tx, map[string]string{"WHATSAPP_PROVIDER": "fonnte", "FONNTE_API_KEY": "fk"})
	n.wa.FonnteURL = fsrv.URL
	if d := n.SendText(ctx, phone, "x", "", ""); !d.OK || d.Reason != "invalid token" {
		t.Fatalf("fonnte = %+v (HTTP 200 counts as success, like the TS)", d)
	}
	if fon.headers[0].Get("Authorization") != "fk" {
		t.Fatal("fonnte auth header")
	}
	fon.status = 401
	if d := n.SendText(ctx, phone, "x", "", ""); d.OK {
		t.Fatalf("fonnte 401 = %+v", d)
	}
}

func TestOwnerNotices(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	gw := &fakeProvider{status: 200, body: `{}`}
	srv := gw.server(t)
	n := testNotifier(t, tx, map[string]string{"WA_GATEWAY_TOKEN": "t", "WA_GATEWAY_URL": srv.URL})
	order := "POS-" + randDigits(8)
	countLog := func(typ, key string) int {
		var c int
		_ = tx.QueryRow(ctx, `SELECT count(*) FROM configuration.wa_notif_log WHERE notif_type = $1 AND dedup_key = $2`, typ, key).Scan(&c)
		return c
	}

	cust := newCustomer(t, tx, "")
	mustExec(t, tx, `UPDATE pos.pos_customers SET name = ' Dewi ' WHERE id = $1`, cust)
	comp := ports.CompNotice{CompType: "owner_comp", OrderNumber: order, GrossIdr: 50000, CustomerID: &cust}
	n.NotifyComp(ctx, comp)
	n.NotifyComp(ctx, comp) // dedup: one message
	if len(gw.requests) != 1 || gw.requests[0]["target"] != compNotifTarget || !strings.Contains(gw.requests[0]["message"].(string), "Customer : Dewi") {
		t.Fatalf("comp requests = %v", gw.requests)
	}
	// A clear gateway failure releases the claim.
	gw.status = 500
	failed := ports.CompNotice{CompType: "foc_comp", OrderNumber: order, GrossIdr: 1}
	n.NotifyComp(ctx, failed)
	if countLog("komplimen", "comp:foc_comp:"+order) != 0 || countLog("komplimen", "comp:owner_comp:"+order) != 1 {
		t.Fatal("comp claims")
	}

	// Large void: below threshold, disabled, then sent once.
	gw.status, gw.requests = 200, nil
	orderID := "11111111-2222-4333-8444-" + randDigits(12)
	void := ports.VoidNotice{OrderID: orderID, OrderNumber: "ORD-1", Total: 750000, Reason: "salah", SupervisorName: "Budi"}
	n.NotifyLargeVoid(ctx, void)
	mustExec(t, tx, `INSERT INTO configuration.app_settings (key, value) VALUES ('wa_notif_config', '{"enabled":true,"recipients":["081234567890"],"voidThresholdRp":700000}')`)
	n.NotifyLargeVoid(ctx, ports.VoidNotice{OrderID: orderID, Total: 699999})
	if len(gw.requests) != 0 {
		t.Fatal("void sent while disabled or below threshold")
	}
	n.NotifyLargeVoid(ctx, void)
	n.NotifyLargeVoid(ctx, void)
	if len(gw.requests) != 1 || gw.requests[0]["target"] != "6281234567890" || !strings.Contains(gw.requests[0]["message"].(string), "*Rp750.000*") || countLog("voidBesar", orderID) != 1 {
		t.Fatalf("void requests = %v", gw.requests)
	}

	// Gift card codes go to the buyer.
	gw.requests = nil
	n.NotifyGiftCardsSold(ctx, ports.GiftCardsSoldNotice{BuyerPhone: "", Cards: []ports.IssuedGiftCard{{Code: "A"}}})
	n.NotifyGiftCardsSold(ctx, ports.GiftCardsSoldNotice{BuyerPhone: "628123", Cards: []ports.IssuedGiftCard{{Code: "ABC", InitialValue: 50000, ExpiresAt: json.RawMessage("null")}}})
	if len(gw.requests) != 1 || gw.requests[0]["target"] != "628123" || !strings.Contains(gw.requests[0]["message"].(string), "*ABC*") {
		t.Fatalf("gift requests = %v", gw.requests)
	}
}

func TestGatewayTimeout(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
	t.Cleanup(func() { close(release); srv.Close() })
	n := testNotifier(t, tx, map[string]string{"WA_GATEWAY_TOKEN": "t", "WA_GATEWAY_URL": srv.URL, "WA_GATEWAY_TIMEOUT_MS": "50"})
	res := n.wa.LoadGateway(ctx, tx).SendText(ctx, "62811", "x")
	if res.Success || !res.TimedOut || res.Reason != "Gateway tidak merespons (timeout)" {
		t.Fatalf("timeout = %+v", res)
	}
	// A timed-out comp notice keeps its claim (at most once).
	order := "POS-" + randDigits(8)
	n.NotifyComp(ctx, ports.CompNotice{CompType: "foc_comp", OrderNumber: order, GrossIdr: 1})
	var c int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM configuration.wa_notif_log WHERE dedup_key = $1`, "comp:foc_comp:"+order).Scan(&c)
	if c != 1 {
		t.Fatalf("claim after timeout = %d", c)
	}
}
