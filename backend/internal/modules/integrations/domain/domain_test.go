package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

func str(s string) *string { return &s }

func parse(t *testing.T, raw string) map[string]any {
	t.Helper()
	v, ok := ParseJSON([]byte(raw))
	if !ok {
		t.Fatalf("bad JSON %s", raw)
	}
	return Obj(v)
}

// lib/payments/xendit.test.ts and lib/security/compare.test.ts.
func TestXenditTokenAndAmount(t *testing.T) {
	for _, c := range []struct {
		in, want string
		ok       bool
	}{{"", "", false}, {"abc", "", false}, {"tok", "tok", true}, {" tok ", "tok", true}, {"wrong", "tok", false}, {"", "tok", false}} {
		if got := VerifyXenditToken(c.in, c.want); got != c.ok {
			t.Errorf("VerifyXenditToken(%q, %q) = %v", c.in, c.want, got)
		}
	}
	for _, c := range []struct {
		expected string
		got      float64
		ok       bool
	}{{"50000.00", 50000, true}, {"50000.4", 50000, true}, {"50000", 1000, false}, {"50000", 0, false}, {"", 50000, false}, {"abc", 50000, false}} {
		if got := AmountMatches(c.expected, c.got); got != c.ok {
			t.Errorf("AmountMatches(%q, %v) = %v", c.expected, c.got, got)
		}
	}
}

func TestParseQrWebhook(t *testing.T) {
	p := ParseQrWebhook(parse(t, `{"event":"qr.payment","data":{"id":"qrpy_1","qr_id":"qr_abc","reference_id":"topup_xyz","status":"SUCCEEDED","amount":50000}}`))
	want := QrWebhook{Paid: true, Status: "SUCCEEDED", QRID: "qr_abc", ReferenceID: "topup_xyz", Amount: 50000, PaymentID: "qrpy_1"}
	if p != want {
		t.Errorf("paid payload = %+v", p)
	}
	if p := ParseQrWebhook(parse(t, `{"data":{"status":"PENDING","qr_id":"qr_1"}}`)); p.Paid {
		t.Error("PENDING must not be paid")
	}
	// Flat payload, string amount, "paid" event without a status.
	p = ParseQrWebhook(parse(t, `{"event":"qr_code.paid","id":"qr_9","external_id":"ref_9","amount":"1500"}`))
	if !p.Paid || p.QRID != "qr_9" || p.ReferenceID != "ref_9" || p.Amount != 1500 || p.PaymentID != "qr_9" {
		t.Errorf("flat payload = %+v", p)
	}
}

func TestResolvePaidAction(t *testing.T) {
	cases := []struct {
		topup, checkout string
		children        int
		order           string
		want            PaidAction
	}{
		{"tx", "co", 0, "o", ActionCreditTopup},
		{"", "co", 2, "", ActionNoopCheckout},
		{"", "co", 0, "o", ActionCompleteCheckout},
		{"", "", 0, "o", ActionCompleteOrder},
		{"", " ", 0, "", ActionIgnore},
	}
	for _, c := range cases {
		if got := ResolvePaidAction(c.topup, c.checkout, c.children, c.order); got != c.want {
			t.Errorf("%+v = %s", c, got)
		}
	}
}

// lib/crm/partners.test.ts (signature and timestamp).
func TestPartnerSignatureAndTimestamp(t *testing.T) {
	secret := strings.Repeat("a", 64)
	body := []byte(`{"external_id":"evt-1","event_type":"photo_session","phone":"0812345678"}`)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if !VerifyPartnerSignature(body, sig, secret) {
		t.Error("valid signature rejected")
	}
	for _, c := range []struct {
		body        []byte
		sig, secret string
	}{
		{append(body, ' '), sig, secret},
		{body, sig, strings.Repeat("b", 64)},
		{body, strings.TrimPrefix(sig, "sha256="), secret},
		{body, "sha256=zz", secret},
		{body, sig, ""},
		{body, "", secret},
	} {
		if VerifyPartnerSignature(c.body, c.sig, c.secret) {
			t.Errorf("accepted %q with %q", c.sig, c.secret)
		}
	}
	now := time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)
	unix := now.Unix()
	for _, c := range []struct {
		header string
		ok     bool
	}{
		{strconv.FormatInt(unix-300, 10), true}, {strconv.FormatInt(unix+300, 10), true},
		{strconv.FormatInt(unix-301, 10), false}, {strconv.FormatInt(unix+301, 10), false},
		{strconv.FormatInt(now.UnixMilli(), 10), false}, {now.Format(time.RFC3339), false}, {"", false},
	} {
		if got := IsTimestampFresh(c.header, now); got != c.ok {
			t.Errorf("IsTimestampFresh(%q) = %v", c.header, got)
		}
	}
}

func TestTelegramCommandAndTitle(t *testing.T) {
	for in, want := range map[string]string{"/start": "/start", " /START@bcd_bot hai": "/start", "/stop": "/stop", "halo": "halo", "": ""} {
		if got := TelegramCommand(str(in)); got != want {
			t.Errorf("TelegramCommand(%q) = %q", in, got)
		}
	}
	if got := ChatTitle(TelegramChat{FirstName: str("Arip")}); got == nil || *got != "Arip" {
		t.Errorf("private title = %v", got)
	}
	if got := ChatTitle(TelegramChat{Title: str("Barista BCD"), FirstName: str("x")}); *got != "Barista BCD" {
		t.Errorf("group title = %v", *got)
	}
	if ChatTitle(TelegramChat{}) != nil {
		t.Error("no title must be nil")
	}
}

// lib/whatsapp/inbound.test.ts.
func TestNormalizeInbound(t *testing.T) {
	base := func(over string) any {
		v, _ := ParseJSON([]byte(`{"remoteJid":"628123456789@s.whatsapp.net","fromMe":false,"messageId":"ABC123","timestamp":1752910000,"text":"Halo, saya mau komplain pesanan","mediaType":null,"pushName":"Budi"` + over + `}`))
		return v
	}
	m := NormalizeInbound(base(""))
	if m == nil || m.Direction != "in" || *m.Phone != "628123456789" || *m.Body != "Halo, saya mau komplain pesanan" ||
		*m.ProviderMessageID != "ABC123" || !m.SentAt.Equal(time.Unix(1752910000, 0)) || *m.PushName != "Budi" {
		t.Fatalf("text message = %+v", m)
	}
	if NormalizeInbound(base(`,"fromMe":true`)).Direction != "out" {
		t.Error("fromMe must be out")
	}
	if NormalizeInbound(base(`,"remoteJid":"12345-99@g.us"`)) != nil {
		t.Error("group accepted")
	}
	if m := NormalizeInbound(base(`,"text":null,"mediaType":"image"`)); m == nil || m.Body != nil || *m.MediaType != "image" {
		t.Errorf("media = %+v", m)
	}
	if NormalizeInbound(base(`,"text":"","mediaType":null`)) != nil || NormalizeInbound(base(`,"text":null,"mediaType":"poll"`)) != nil {
		t.Error("empty message accepted")
	}
	if m := NormalizeInbound(base(`,"text":"` + strings.Repeat("x", 9000) + `"`)); len(*m.Body) != 4000 {
		t.Errorf("body len = %d", len(*m.Body))
	}
	if jidToPhone("628123456789:12@s.whatsapp.net") != "628123456789" || jidToPhone("123@s.whatsapp.net") != "" {
		t.Error("jidToPhone")
	}
}

// lib/wa/notifications-config.test.ts and the route's PUT rules.
func TestWaNotifConfig(t *testing.T) {
	def := DefaultWaNotifConfig()
	if got := ParseWaNotifConfig(nil); !reflect.DeepEqual(got, def) || got.Enabled || len(got.Recipients) != 0 {
		t.Errorf("default = %+v", got)
	}
	if got := ParseWaNotifConfig(str("{rusak")); !reflect.DeepEqual(got, def) {
		t.Error("broken JSON must fall back")
	}
	cfg := ParseWaNotifConfig(str(`{"recipients":["0858 8097 4659","6285880974659","abc","+62811000111"]}`))
	if !reflect.DeepEqual(cfg.Recipients, []string{"6285880974659", "62811000111"}) {
		t.Errorf("recipients = %v", cfg.Recipients)
	}
	cfg = ParseWaNotifConfig(str(`{"types":{"digest":false,"asing":true},"voidThresholdRp":250000.7,"digestHour":21,"omzetAnjlokPct":60}`))
	if cfg.Types["digest"] || !cfg.Types["voidBesar"] || cfg.Types["asing"] || cfg.VoidThresholdRp != 250001 || cfg.DigestHour != 21 || cfg.OmzetAnjlokPct != 60 {
		t.Errorf("partial = %+v", cfg)
	}
	for _, raw := range []string{`{"voidThresholdRp":-5}`, `{"voidThresholdRp":"x"}`, `{"digestHour":24}`, `{"digestHour":21.5}`, `{"digestHour":"22"}`, `{"omzetAnjlokPct":0}`} {
		if got := ParseWaNotifConfig(str(raw)); got.VoidThresholdRp != 500000 || got.DigestHour != 22 || got.OmzetAnjlokPct != 80 {
			t.Errorf("%s = %+v", raw, got)
		}
	}
	encoded, _ := json.Marshal(def)
	if !strings.HasPrefix(string(encoded), `{"enabled":false,"recipients":[],"types":{"voidBesar":true,"stokHabis":true,`) {
		t.Errorf("JSON order = %s", encoded)
	}

	next, msg := ApplyWaNotifUpdate(def, parse(t, `{"recipients":["0812-3456-7890","6281234567890"],"digestHour":7}`))
	if msg != "" || !reflect.DeepEqual(next.Recipients, []string{"6281234567890"}) || next.DigestHour != 7 {
		t.Errorf("update = %+v %q", next, msg)
	}
	for body, want := range map[string]string{
		`{"digestHour":24}`:      "Jam ringkasan harus 0-23 (WIB)",
		`{"enabled":"ya"}`:       "enabled tidak valid",
		`{"recipients":"x"}`:     "recipients tidak valid",
		`{"recipients":["123"]}`: "Nomor tidak valid: 123. Pakai format 08… atau 62…",
		`{"types":null}`:         "types tidak valid",
		`{"voidThresholdRp":-1}`: "Ambang void tidak valid",
		`{"omzetAnjlokPct":100}`: "Ambang omzet harus 1-99 (persen dari baseline)",
		`{"recipients":["081200000001","081200000002","081200000003","081200000004","081200000005","081200000006"]}`: "Maksimal 5 nomor penerima",
	} {
		if _, msg := ApplyWaNotifUpdate(def, parse(t, body)); msg != want {
			t.Errorf("%s: %q, want %q", body, msg, want)
		}
	}
	shift, ok := CleanShiftReportRecipients([]any{"0812 3456 789", "123", "0812 3456 789"})
	if !ok || !reflect.DeepEqual(shift, []string{"08123456789"}) {
		t.Errorf("shift = %v", shift)
	}
	if got := ParseShiftReportRecipients(str(`["0812",5]`)); !reflect.DeepEqual(got, []string{"0812", "5"}) {
		t.Errorf("stored shift = %v", got)
	}
}

// lib/configuration/payment-gateways.test.ts and app-settings maskSecret.
func TestSecretMasks(t *testing.T) {
	if got := MaskGatewaySecret(str("xnd_development_abcdef")); *got != "xnd_********cdef" {
		t.Errorf("mask = %s", *got)
	}
	if MaskGatewaySecret(str("")) != nil || MaskGatewaySecret(nil) != nil {
		t.Error("empty must be nil")
	}
	if *MaskGatewaySecret(str("short")) != "********" || *MaskGatewaySecret(str("123456789")) != "1234****6789" {
		t.Error("short masks")
	}
	for in, keep := range map[string]bool{"": true, "xnd_********cdef": true, "ab••••cd": true, "x…y": true, "xnd_development_new": false} {
		if KeepExistingSecret(str(in)) != keep {
			t.Errorf("KeepExistingSecret(%q) != %v", in, keep)
		}
	}
	if !KeepExistingSecret(nil) {
		t.Error("nil keeps")
	}
}

func TestProviderAndGoogleInputs(t *testing.T) {
	if _, msg := ParseProviderInput(parse(t, `{"model":" "}`), "openai: "); msg != "openai: model tidak valid" {
		t.Errorf("model msg = %q", msg)
	}
	if _, msg := ParseProviderInput(parse(t, `{"base_url":"ftp://x"}`), ""); msg != "base_url tidak valid" {
		t.Errorf("url msg = %q", msg)
	}
	if _, msg := ParseProviderInput(parse(t, `{"api_key":5}`), ""); msg != "api_key tidak valid" {
		t.Errorf("key msg = %q", msg)
	}
	in, msg := ParseProviderInput(parse(t, `{"api_key":null,"model":"m","base_url":"https://x/"}`), "")
	if msg != "" || !in.APIKeyNull || *in.Model != "m" || *in.BaseURL != "https://x/" {
		t.Errorf("valid = %+v %q", in, msg)
	}
	if WithPrefix("/123/", "accounts") != "accounts/123" || WithPrefix("accounts/9", "accounts") != "accounts/9" || WithPrefix("  ", "accounts") != "" {
		t.Error("WithPrefix")
	}
	if got := ParseLocationIDs("1, locations/2;1 /3/"); !reflect.DeepEqual(got, []string{"locations/1", "locations/2", "locations/3"}) {
		t.Errorf("locations = %v", got)
	}
}

// lib/wa/flash-report.test.ts.
func TestFlashReport(t *testing.T) {
	hours := "11.00–20.00 WIB"
	d := FlashReportData{
		OperationHour: &hours, Revenue: 8_892_000, NettSales: 3_806_000, Discount: 5_086_000, FullDiscountTx: 13,
		KolCompIdr: 350_000, KolCompTx: 3, FocCompIdr: 120_000, FocCompTx: 2, GuestCount: 70,
		ByStall:     []FlashLine{{"Es Cekek Corner", 2_570_500, 103}, {"Sushi Corner", 2_130_000, 36}, {"Kobo Corner", 0, 0}},
		ByCategory:  []FlashLine{{"Makanan", 7_527_000, 200}, {"Minuman", 2_570_500, 103}},
		TopProducts: []FlashLine{{Name: "Yuzu Milk", Pcs: 24}, {Name: "Oolong Peach", Pcs: 23}},
	}
	msg := BuildFlashReportMessage(d, "2026-08-22", "NüHabit")
	for _, want := range []string{"*Daily Flash Report*", "NÜHABIT", "Sabtu, 22 Agustus 2026", "Revenue : Rp 8.892.000",
		"Nett Sales : Rp 3.806.000", "Discount : Rp 5.086.000", "SULU Citizen : 0 Card", "Disc 100% : 13 Transaksi",
		"KOL Comp : Rp 350.000 (3 Trx)", "Komplimen FOC : Rp 120.000 (2 Trx)", "No of Guest : 70 Pax", "Average/Pax : Rp 54.371",
		"Es Cekek Corner : Rp 2.570.500 (103 Pcs)", "Kobo Corner : Rp 0", "Makanan : Rp 7.527.000 (200 Pcs)", "1. Yuzu Milk : 24 pcs",
		"Jam operasional: 11.00–20.00 WIB"} {
		if !strings.Contains(msg, want) {
			t.Errorf("missing %q in\n%s", want, msg)
		}
	}
	if strings.Contains(msg, "Owner Comp") {
		t.Error("owner comp line without comps")
	}
	empty := BuildFlashReportMessage(FlashReportData{}, "2026-10-01", "NüHabit")
	if !strings.Contains(empty, "Average/Pax : Rp 0") || strings.Contains(empty, "Jam operasional") || !strings.Contains(empty, "—") ||
		!strings.Contains(empty, "Kamis, 1 Oktober 2026") {
		t.Errorf("empty report:\n%s", empty)
	}
	start, end, _ := WibDayRange("2026-08-22")
	if start.UTC().Format(time.RFC3339) != "2026-08-21T17:00:00Z" || end.UTC().Format(time.RFC3339) != "2026-08-22T17:00:00Z" {
		t.Errorf("range %v %v", start, end)
	}
	at := time.Date(2026, 8, 4, 7, 5, 0, 0, time.UTC)
	if NowLabel(at) != "4 Agu 2026, 14.05" || TodayWib(time.Date(2026, 10, 3, 18, 0, 0, 0, time.UTC)) != "2026-10-04" {
		t.Errorf("labels %q", NowLabel(at))
	}
}
