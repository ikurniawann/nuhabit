package ticketing

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	contract "nuhabit/backend/internal/contracts/ticketing"
	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

// The public booking flow (/api/public/booking/**) on the shared fixture,
// with in-memory Xendit, promo and branch ports.

type fakePayments struct {
	off      bool
	fail     bool
	invoices []InvoiceRequest
}

func (p *fakePayments) Configured() bool { return !p.off }

func (p *fakePayments) CreateInvoice(_ context.Context, in InvoiceRequest) (Invoice, error) {
	p.invoices = append(p.invoices, in)
	if p.fail {
		return Invoice{}, errors.New("xendit down")
	}
	return Invoice{ID: "inv-" + testutil.RandomHex(3), URL: "https://pay.example/inv", ExpiresAt: time.Date(2099, 1, 1, 3, 0, 0, 0, time.UTC)}, nil
}

func (*fakePayments) ValidWebhookToken(token string) bool { return token == "rahasia" }

type fakePromo struct {
	discount float64
	reject   string
	captured []string
}

func (p *fakePromo) Preview(_ context.Context, _ database.Querier, in PromoCheck) (PromoPreview, error) {
	if p.reject != "" {
		return PromoPreview{Reason: "nonaktif", Message: p.reject}, nil
	}
	return PromoPreview{OK: true, Discount: p.discount, CampaignName: "Hemat " + in.Code, DiscountType: "fixed"}, nil
}

func (p *fakePromo) Hold(_ context.Context, _ database.Querier, _ PromoCheck, _, _ string) (float64, error) {
	if p.reject != "" {
		return 0, httpx.Status(422, p.reject)
	}
	return p.discount, nil
}

func (p *fakePromo) Capture(_ context.Context, _ database.Querier, contextType, contextID string) error {
	p.captured = append(p.captured, contextType+":"+contextID)
	return nil
}

type fakeBranches struct{}

func (fakeBranches) Name(context.Context, database.Querier, string) (*string, error) {
	name := " Kolam Ceria "
	return &name, nil
}

type publicFixture struct {
	*fixture
	slug  string
	pay   *fakePayments
	promo *fakePromo
}

func newPublicFixture(t *testing.T) *publicFixture {
	t.Helper()
	f := newFixture(t)
	p := &publicFixture{fixture: f, slug: "go-" + testutil.RandomHex(4), pay: &fakePayments{}, promo: &fakePromo{}}
	venues := fixedVenue{f.venue.CompanyID, f.venue.BranchID}
	svc := NewService(f.tx, Ports{Venues: venues, Employees: sqlEmployees{}, Messenger: f.wa, AppOrigin: "https://tiket.example",
		Public: PublicPorts{Payments: p.pay, Promo: p.promo, Branches: fakeBranches{}}}, nil, discard)
	f.mux = testutil.Mux(mod{h: newHandler(svc, headerGuard{}, venues)})
	f.ok(f.call("PUT", "/api/ticketing/settings", map[string]any{"booking_slug": p.slug}))
	f.exec(`UPDATE ticketing.ticket_channels SET is_online = true, is_active = true WHERE id = $1`, f.web)
	return p
}

// pub calls a public route from ip.
func (p *publicFixture) pub(method, target string, body any, ip string, headers ...string) response {
	p.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = strings.NewReader(string(raw))
	}
	req := httptest.NewRequest(method, target, rd)
	req.Header.Set("x-forwarded-for", ip)
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	p.mux.ServeHTTP(rec, req)
	out := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
	return out
}

// webTicket is an Active ticket distributed to the website channel.
func (p *publicFixture) webTicket(name string, price float64) (string, string) {
	p.t.Helper()
	product, variant := p.ticket(name, price, price)
	p.ok(p.call("PATCH", "/api/ticketing/products/"+product+"/channels", map[string]any{"channel_id": p.web, "is_distributed": true}))
	return product, variant
}

func tomorrow() string { return domain.AddDaysISO(domain.TodayJakarta(time.Now()), 1) }

func bookingBody(variant string, qty int) map[string]any {
	return map[string]any{
		"visit_date": tomorrow(), "customer_name": "Budi Santoso", "customer_phone": "0812-3456-7890",
		"items": []any{map[string]any{"variant_id": variant, "qty": qty}},
	}
}

// Ported from app/api/public/booking/[slug]/route.test.ts.
func TestPublicBookingCreateGuards(t *testing.T) {
	p := newPublicFixture(t)
	_, variant := p.webTicket("Kolam", 50000)
	url := "/api/public/booking/" + p.slug

	bad := bookingBody(variant, 2)
	bad["customer_name"] = "B"
	r := p.pub("POST", url, bad, "203.0.113.20")
	if r.Status != 400 || r.Body["error"] != "Validation failed" {
		t.Fatal(r.Raw)
	}
	if _, isList := r.Body["details"].([]any); !isList {
		t.Fatal("details must list the issues")
	}
	past := bookingBody(variant, 2)
	past["visit_date"] = domain.AddDaysISO(domain.TodayJakarta(time.Now()), -1)
	p.fail(p.pub("POST", url, past, "203.0.113.21"), 400, "Tanggal kunjungan sudah lewat")
	dup := bookingBody(variant, 1)
	dup["items"] = []any{map[string]any{"variant_id": variant, "qty": 1}, map[string]any{"variant_id": variant, "qty": 1}}
	p.fail(p.pub("POST", url, dup, "203.0.113.22"), 400, "Varian duplikat dalam pesanan")

	p.pay.off = true
	p.fail(p.pub("POST", url, bookingBody(variant, 2), "203.0.113.23"), 503, "Pembayaran online belum tersedia — silakan beli di loket")
	p.pay.off = false
	r = p.pub("POST", "/api/public/booking/tidak-ada", bookingBody(variant, 2), "203.0.113.24")
	if r.Status != 404 || r.Raw != `{"success":false,"error":"Not found"}` {
		t.Fatal(r.Raw)
	}
	for range 5 {
		p.pub("POST", url, map[string]any{}, "192.0.2.50")
	}
	p.fail(p.pub("POST", url, map[string]any{}, "192.0.2.50"), 429, "Terlalu banyak percobaan — coba lagi beberapa menit lagi")
	if len(p.pay.invoices) != 0 {
		t.Fatal("no invoice before a valid booking")
	}
}

func TestPublicBookingFlowAndWebhook(t *testing.T) {
	p := newPublicFixture(t)
	product, variant := p.webTicket("Kolam", 50000)
	bus := outbox.NewBus(nil, discard)
	var released []string
	bus.Subscribe(contract.TopicBookingExpired, "ticketing.test-public-expired", func(_ context.Context, _ pgx.Tx, e outbox.Event) error {
		var ev contract.BookingReleased
		released = append(released, e.Topic)
		return e.Decode(&ev)
	})
	if err := bus.Register(p.ctx, p.tx); err != nil {
		t.Fatal(err)
	}
	base := "/api/public/booking/" + p.slug

	catalog := p.ok(p.pub("GET", base+"/catalog?date="+tomorrow(), nil, "198.51.100.1"))
	eq(t, catalog.data()["venue"], map[string]any{"name": "Kolam Ceria"})
	eq(t, catalog.data()["products"].([]any)[0].(map[string]any)["variants"], []any{
		map[string]any{"variant_id": variant, "variant_name": "Umum", "price": 50000, "season_kind": "regular"}})
	p.fail(p.pub("GET", base+"/catalog?date=kemarin", nil, "198.51.100.1"), 400, "Tanggal kunjungan tidak valid")
	eq(t, p.ok(p.pub("GET", base+"/availability?from="+tomorrow()+"&to="+tomorrow(), nil, "198.51.100.1")).Raw, `{"success":true,"data":{"dates":{}}}`)
	eq(t, p.ok(p.pub("GET", base+"/slots?date="+tomorrow(), nil, "198.51.100.1")).Raw, `{"success":true,"data":{"slots":[]}}`)

	body := bookingBody(variant, 2)
	body["items"].([]any)[0].(map[string]any)["guest_names"] = []any{" Ani ", nil}
	body["promo_code"] = "hemat"
	p.promo.discount = 25000
	created := p.ok(p.pub("POST", base, body, "198.51.100.2"))
	eq(t, created.Body["message"], "Booking dibuat — selesaikan pembayaran")
	d := created.data()
	token := d["access_token"].(string)
	eq(t, []any{d["total"], d["discount_amount"], d["payable"], d["invoice_url"], d["expires_at"], d["status_url"]},
		[]any{100000, 25000, 75000, "https://pay.example/inv", "2099-01-01T03:00:00.000Z", "https://tiket.example/booking/status/" + token})
	inv := p.pay.invoices[0]
	if inv.Amount != 75000 || !strings.HasPrefix(inv.ExternalID, "tkt-booking-") || inv.Description != "Tiket "+d["booking_code"].(string)+" — kunjungan "+tomorrow() {
		t.Fatalf("invoice = %+v", inv)
	}
	id := strings.TrimPrefix(inv.ExternalID, "tkt-booking-")
	eq(t, p.scalar(`SELECT status || '|' || promo_code || '|' || customer_phone || '|' || xendit_invoice_url FROM ticketing.ticket_bookings WHERE id = $1`, id),
		"menunggu-bayar|HEMAT|6281234567890|https://pay.example/inv")
	eq(t, p.scalar(`SELECT string_agg(guest_name, ',' ORDER BY position) FROM ticketing.ticket_booking_guests WHERE booking_id = $1`, id),
		"Ani,Group Budi Santoso - 2")

	// The status page while pending shows the invoice link.
	status := p.ok(p.pub("GET", "/api/public/booking/status/"+token, nil, "198.51.100.3")).data()
	eq(t, []any{status["status"], status["payable"], status["invoice_url"], status["slot_start_time"], status["promo_code"]},
		[]any{"menunggu-bayar", 75000, "https://pay.example/inv", nil, "HEMAT"})
	eq(t, status["items"], []any{map[string]any{"product_name": "Kolam", "variant_name": "Umum", "qty": 2, "unit_price": 50000, "season_kind": "regular", "subtotal": 100000}})
	eq(t, status["guests"], []any{map[string]any{"guest_name": "Ani", "variant_name": "Umum"}, map[string]any{"guest_name": "Group Budi Santoso - 2", "variant_name": "Umum"}})
	r := p.pub("GET", "/api/public/booking/status/BK-ABC234", nil, "198.51.100.3")
	eq(t, []any{r.Status, r.Raw}, []any{404, `{"success":false,"error":"Not found"}`})

	// Ported from app/api/public/booking/webhook/xendit/route.test.ts.
	hook := "/api/public/booking/webhook/xendit"
	paid := func(over map[string]any) map[string]any {
		cb := map[string]any{"id": "inv-1", "external_id": "tkt-booking-" + id, "status": "PAID"}
		for k, v := range over {
			cb[k] = v
		}
		return cb
	}
	r = p.pub("POST", hook, paid(nil), "203.0.113.9", "x-callback-token", "palsu")
	eq(t, []any{r.Status, r.Raw}, []any{401, `{"success":false,"error":"Unauthorized"}`})
	p.fail(p.pub("POST", hook, map[string]any{"status": "PAID"}, "203.0.113.9", "x-callback-token", "rahasia"), 400, "Payload tidak dikenal")
	for _, ext := range []string{"topup-123", "tkt-booking-bukan-uuid", "tkt-pass-x"} {
		eq(t, p.ok(p.pub("POST", hook, paid(map[string]any{"external_id": ext}), "203.0.113.9", "x-callback-token", "rahasia")).Raw, `{"success":true,"ignored":true}`)
	}
	under := p.ok(p.pub("POST", hook, paid(map[string]any{"amount": 50000}), "203.0.113.9", "x-callback-token", "rahasia"))
	eq(t, under.Raw, `{"success":true,"ignored":true}`)
	eq(t, p.scalar(`SELECT status || '|' || webhook_alert FROM ticketing.ticket_bookings WHERE id = $1`, id),
		"menunggu-bayar|Xendit melapor PAID dengan nominal Rp50.000 — kurang dari tagihan booking Rp75.000. Pembayaran TIDAK ditandai lunas; periksa dashboard Xendit.")
	eq(t, p.ok(p.pub("POST", hook, paid(map[string]any{"amount": 75000}), "203.0.113.9", "x-callback-token", "rahasia")).Raw, `{"success":true}`)
	eq(t, p.scalar(`SELECT status || '|' || (paid_at IS NOT NULL) FROM ticketing.ticket_bookings WHERE id = $1`, id), "terbayar|true")
	eq(t, p.promo.captured, []string{"ticket_booking:" + id})
	if len(p.wa.sent) != 1 || !strings.HasPrefix(p.wa.sent[0], "6281234567890|*Pembayaran diterima*") || !strings.Contains(p.wa.sent[0], "Dibayar: Rp75.000") {
		t.Fatalf("wa = %v", p.wa.sent)
	}
	eq(t, p.ok(p.pub("POST", hook, paid(nil), "203.0.113.9", "x-callback-token", "rahasia")).Raw, `{"success":true}`)
	eq(t, len(p.wa.sent), 1)
	paidStatus := p.ok(p.pub("GET", "/api/public/booking/status/"+token, nil, "198.51.100.3")).data()
	eq(t, []any{paidStatus["status"], paidStatus["invoice_url"]}, []any{"terbayar", nil})

	// EXPIRED releases the promo hold through the outbox; PAID on a
	// cancelled booking only raises the refund alert.
	other := p.booking("BK-XPRD23", "menunggu-bayar", product, variant)
	eq(t, p.ok(p.pub("POST", hook, map[string]any{"id": "i", "external_id": "tkt-booking-" + other, "status": "EXPIRED"}, "203.0.113.9", "x-callback-token", "rahasia")).Raw, `{"success":true}`)
	eq(t, p.scalar(`SELECT status FROM ticketing.ticket_bookings WHERE id = $1`, other), "kedaluwarsa")
	cancelled := p.booking("BK-CNCL23", "dibatalkan", product, variant)
	p.ok(p.pub("POST", hook, map[string]any{"id": "i", "external_id": "tkt-booking-" + cancelled, "status": "PAID"}, "203.0.113.9", "x-callback-token", "rahasia"))
	if !strings.HasPrefix(p.scalar(`SELECT webhook_alert FROM ticketing.ticket_bookings WHERE id = $1`, cancelled), "Pembayaran Xendit MASUK untuk booking yang sudah DIBATALKAN") {
		t.Fatal("cancelled booking alert")
	}
	if _, err := bus.Dispatch(p.ctx, p.tx); err != nil {
		t.Fatal(err)
	}
	eq(t, released, []string{contract.TopicBookingExpired})

	// An invoice failure cancels the booking.
	p.pay.fail = true
	p.fail(p.pub("POST", base, bookingBody(variant, 1), "198.51.100.4"), 502, "Pembayaran sedang gangguan — coba lagi")
	eq(t, p.scalar(`SELECT string_agg(status, ',') FROM ticketing.ticket_bookings WHERE refund_note = 'pembuatan-invoice-gagal' AND branch_id = $1`, p.venue.BranchID),
		"dibatalkan")
}

func TestPublicSlotsCapacityAndPromoCheck(t *testing.T) {
	p := newPublicFixture(t)
	_, variant := p.webTicket("Kolam", 50000)
	base := "/api/public/booking/" + p.slug
	slot := p.ok(p.call("POST", "/api/ticketing/time-slots", map[string]any{"label": "Pagi", "start_time": "08:00", "end_time": "10:00", "capacity": 1}))
	slotID := slot.data()["id"].(string)

	eq(t, p.ok(p.pub("GET", base+"/slots?date="+tomorrow(), nil, "198.51.100.5")).Raw,
		`{"success":true,"data":{"slots":[{"slot_id":"`+slotID+`","label":"Pagi","start_time":"08:00","end_time":"10:00","status":"available"}]}}`)
	p.fail(p.pub("GET", base+"/slots?date=x", nil, "198.51.100.5"), 400, "Tanggal tidak valid")
	p.fail(p.pub("POST", base, bookingBody(variant, 1), "198.51.100.6"), 400, "Pilih slot waktu kunjungan dulu")
	two := bookingBody(variant, 2)
	two["slot_id"] = slotID
	p.fail(p.pub("POST", base, two, "198.51.100.7"), 409, "Slot Pagi pada tanggal ini sudah penuh — pilih slot lain")
	one := bookingBody(variant, 1)
	one["slot_id"] = slotID
	p.ok(p.pub("POST", base, one, "198.51.100.8"))
	if !strings.Contains(p.pub("GET", base+"/slots?date="+tomorrow(), nil, "198.51.100.5").Raw, `"status":"sold_out"`) {
		t.Fatal("slot sold out")
	}

	p.ok(p.call("POST", "/api/ticketing/capacity-dates", map[string]any{"label": "Tutup", "start_date": tomorrow(), "end_date": tomorrow(), "capacity": 0}))
	eq(t, p.ok(p.pub("GET", base+"/availability?from="+tomorrow()+"&to="+tomorrow(), nil, "198.51.100.5")).Raw,
		`{"success":true,"data":{"dates":{"`+tomorrow()+`":"closed"}}}`)
	p.fail(p.pub("GET", base+"/availability?from=2026-01-01&to=2026-06-01", nil, "198.51.100.5"), 400, "Rentang maksimum 92 hari")

	r := p.pub("POST", base+"/promo-check", map[string]any{"code": "x", "subtotal": 1}, "198.51.100.9")
	eq(t, []any{r.Status, r.Raw}, []any{400, `{"success":false,"error":"Validation failed"}`})
	p.promo.discount = 10000
	eq(t, p.ok(p.pub("POST", base+"/promo-check", map[string]any{"code": "HEMAT", "subtotal": 50000, "phone": "0812"}, "198.51.100.9")).Raw,
		`{"success":true,"data":{"ok":true,"discount":10000,"campaign_name":"Hemat HEMAT","discount_type":"fixed"}}`)
	p.promo.reject = "Kode promo tidak aktif"
	eq(t, p.ok(p.pub("POST", base+"/promo-check", map[string]any{"code": "HEMAT", "subtotal": 50000}, "198.51.100.9")).Raw,
		`{"success":true,"data":{"ok":false,"reason":"nonaktif","message":"Kode promo tidak aktif"}}`)
}

func TestPublicSeasonPassPurchaseAndActivation(t *testing.T) {
	p := newPublicFixture(t)
	created := p.ok(p.call("POST", "/api/ticketing/products", map[string]any{
		"name": "Pass Tahunan", "product_kind": "season_pass", "status": "active", "base_price": 250000, "validity_months": 6}))
	product := created.data()["id"].(string)
	p.exec(`UPDATE ticketing.ticket_product_channels SET is_distributed = true WHERE ticket_product_id = $1 AND channel_id = $2`, product, p.web)
	base := "/api/public/booking/" + p.slug

	passes := p.ok(p.pub("GET", base+"/passes", nil, "198.51.100.10")).data()
	eq(t, passes["venue"], map[string]any{"name": "Kolam Ceria"})
	eq(t, passes["passes"], []any{map[string]any{"ticket_product_id": product, "name": "Pass Tahunan", "description": nil, "thumbnail_url": nil,
		"validity_months": 6, "entry_policy": "once_per_day", "visit_quota": nil, "unit_price": 250000}})

	p.fail(p.pub("POST", base+"/pass", map[string]any{"ticket_product_id": product, "holder_name": "Sari", "holder_phone": "12345678"}, "198.51.100.11"),
		400, "Nomor WhatsApp tidak valid")
	bought := p.ok(p.pub("POST", base+"/pass", map[string]any{"ticket_product_id": product, "holder_name": "Sari", "holder_phone": "0812 9999 0000"}, "198.51.100.11"))
	eq(t, bought.Body["message"], "Pass dibuat — selesaikan pembayaran")
	token := bought.data()["access_token"].(string)
	eq(t, []any{bought.data()["total"], bought.data()["status_url"]}, []any{250000, "https://tiket.example/pass/status/" + token})
	inv := p.pay.invoices[0]
	if inv.Amount != 250000 || !strings.HasPrefix(inv.Description, "Season Pass SP-") {
		t.Fatalf("invoice = %+v", inv)
	}

	status := p.ok(p.pub("GET", "/api/public/booking/pass-status/"+token, nil, "198.51.100.12")).data()
	eq(t, []any{status["status"], status["qr_value"], status["unit_price"], status["valid_from"]}, []any{"pending", token, 250000, nil})

	hook := "/api/public/booking/webhook/xendit"
	eq(t, p.ok(p.pub("POST", hook, map[string]any{"id": "inv-p", "external_id": inv.ExternalID, "status": "PAID", "amount": 1000}, "203.0.113.9", "x-callback-token", "rahasia")).Raw,
		`{"success":true,"ignored":true}`)
	eq(t, p.ok(p.pub("POST", hook, map[string]any{"id": "inv-p", "external_id": inv.ExternalID, "status": "PAID", "amount": 250000}, "203.0.113.9", "x-callback-token", "rahasia")).Raw,
		`{"success":true}`)
	today := domain.TodayJakarta(time.Now())
	active := p.ok(p.pub("GET", "/api/public/booking/pass-status/"+token, nil, "198.51.100.12")).data()
	eq(t, []any{active["status"], active["valid_from"], active["valid_until"]}, []any{"active", today, domain.AddMonthsISO(today, 6)})
	if len(p.wa.sent) != 1 || !strings.HasPrefix(p.wa.sent[0], "6281299990000|*Season Pass aktif*") {
		t.Fatalf("wa = %v", p.wa.sent)
	}
	p.fail(p.pub("GET", "/api/public/booking/pass-status/nope", nil, "198.51.100.12"), 404, "Not found")
}
