package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm"
	"nuhabit/backend/internal/modules/crm/partners"
	"nuhabit/backend/internal/modules/integrations"
	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/modules/integrations/settings"
	"nuhabit/backend/internal/modules/integrations/webhooks"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

// The integrations module mounted with the real guard.
func TestIntegrationsAuthWiring(t *testing.T) {
	deps := testutil.Deps(t, nil)
	mux := testutil.Mux(registry[integrations.Name](deps))
	call := func(target string, s testutil.Staff) int {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, testutil.AsStaff(testutil.Request("GET", target, nil), s))
		return rec.Code
	}
	granted := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"settings.integrations": nil}})
	plain := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos.orders": nil}})
	super := testutil.CreateStaff(t, testutil.StaffOptions{Role: "super_admin"})
	for _, c := range []struct {
		target string
		s      testutil.Staff
		want   int
	}{
		{"/api/settings/integrations", granted, 200}, {"/api/settings/integrations", plain, 403},
		{"/api/settings/wa-notifications", granted, 200}, {"/api/settings/instagram", granted, 403},
		{"/api/settings/instagram", super, 200}, {"/api/settings/payment-gateways", plain, 403},
	} {
		if got := call(c.target, c.s); got != c.want {
			t.Errorf("GET %s = %d, want %d", c.target, got, c.want)
		}
	}
}

type integrationsFixture struct {
	t   *testing.T
	ctx context.Context
	tx  pgx.Tx
}

func (f integrationsFixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func (f integrationsFixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var v *string
	if err := f.tx.QueryRow(f.ctx, sql, args...).Scan(&v); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return strOrEmpty(v)
}

func TestIntegrationsPaymentLookups(t *testing.T) {
	// Pool fixtures first: their cleanup must run after the tx rolls back.
	cashier := testutil.CreateStaff(t, testutil.StaffOptions{})
	m := testutil.CreateMember(t)
	f := integrationsFixture{t, context.Background(), testutil.Tx(t)}
	deps := testutil.Deps(t, nil)
	p := integrationsPayments{deps: deps}
	ref := "topup_" + testutil.RandomHex(4)
	tx := f.scalar(`INSERT INTO pos.pos_wallet_transactions (customer_id, type, amount, ark_coins, balance_before, balance_after,
		status, reference_id, xendit_transaction_id) VALUES ($1, 'topup', 50000, 0, 0, 0, 'pending', $2, $3) RETURNING id::text`,
		m.CustomerID, ref, "qr_"+ref)
	for _, c := range [][2]string{{"reference_id", ref}, {"xendit_transaction_id", "qr_" + ref}} {
		got, err := p.Topup(f.ctx, f.tx, c[0], c[1])
		if err != nil || got == nil || got.ID != tx || got.Amount != "50000" && got.Amount != "50000.00" {
			t.Fatalf("Topup(%v) = %+v %v", c, got, err)
		}
	}
	if got, _ := p.Topup(f.ctx, f.tx, "reference_id", "nope"); got != nil {
		t.Error("unknown top-up found")
	}
	if _, err := p.Topup(f.ctx, f.tx, "notes", ref); err == nil {
		t.Error("an unknown column must fail")
	}

	coRef, ordRef := "co_"+testutil.RandomHex(4), "ord_"+testutil.RandomHex(4)
	co := f.scalar(`INSERT INTO pos.pos_checkouts (cashier_id, checkout_number, total_amount, xendit_external_id)
		VALUES ($1, $2, 120000, $3) RETURNING id::text`, cashier.UserID, "CO-"+testutil.RandomHex(4), coRef)
	f.exec(`INSERT INTO pos.pos_orders (order_number, cashier_id, total_amount, checkout_id) VALUES ($1, $2, 60000, $3)`,
		"T-"+testutil.RandomHex(4), cashier.UserID, co)
	ord := f.scalar(`INSERT INTO pos.pos_orders (order_number, cashier_id, total_amount, xendit_external_id) VALUES ($1, $2, 75000, $3) RETURNING id::text`,
		"T-"+testutil.RandomHex(4), cashier.UserID, ordRef)
	if got, err := p.Checkout(f.ctx, f.tx, coRef); err != nil || got == nil || got.ID != co || !domain.AmountMatches(got.Amount, 120000) {
		t.Errorf("Checkout = %+v %v", got, err)
	}
	if n, err := p.CheckoutChildren(f.ctx, f.tx, co); err != nil || n != 1 {
		t.Errorf("children = %d %v", n, err)
	}
	if got, err := p.Order(f.ctx, f.tx, ordRef); err != nil || got == nil || got.ID != ord || !domain.AmountMatches(got.Amount, 75000) {
		t.Errorf("Order = %+v %v", got, err)
	}
	if got, err := p.GymPurchase(f.ctx, f.tx, "gymcp_none"); got != nil || err != nil {
		t.Errorf("GymPurchase = %+v %v", got, err)
	}
	res, err := p.SettleGymPurchase(f.ctx, f.tx, "gymcp_none", nil)
	raw, _ := json.Marshal(res)
	if err != nil || string(raw) != `{"status":"not_found"}` {
		t.Errorf("settle = %s %v", raw, err)
	}
	if !p.IsGymPurchaseReference("gymcp_x") || p.IsGymPurchaseReference(ref) {
		t.Error("gym reference prefix")
	}
}

func TestIntegrationsInboxAndMessageLog(t *testing.T) {
	f := integrationsFixture{t, context.Background(), testutil.Tx(t)}
	deps := testutil.Deps(t, nil)
	var sent []string
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Target, Message string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		sent = append(sent, body.Target+": "+body.Message)
		_, _ = w.Write([]byte(`{"messageId":"gw-` + testutil.RandomHex(4) + `"}`))
	}))
	defer gw.Close()
	f.exec(`DELETE FROM configuration.app_settings WHERE key IN ('wa_gateway_url', 'wa_gateway_token')`)
	f.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ('wa_gateway_url', $1), ('wa_gateway_token', 'tok')`, gw.URL)
	t.Setenv("WHATSAPP_PROVIDER", "gateway")
	f.exec(`DELETE FROM crm.crm_settings WHERE key LIKE 'cs_%'`)
	f.exec(`INSERT INTO crm.crm_settings (key, value) VALUES ('cs_business_hours_start', '10'), ('cs_business_hours_end', '"22"'),
		('cs_auto_reply_text', '"Kami tutup"')`)

	in := integrationsInbox{gw: crmInboxGateway(deps)}
	phone := "62899" + strings.Repeat("7", 7)
	body, msgID := "halo", "wamid."+testutil.RandomHex(5)
	night := time.Date(2026, 10, 3, 20, 0, 0, 0, time.UTC) // 03:00 WIB
	m := domain.GatewayInbound{Channel: "whatsapp", ExternalID: phone, Phone: &phone, Direction: "in", Body: &body, ProviderMessageID: &msgID, SentAt: &night}
	stored, conv, err := in.Record(f.ctx, f.tx, m)
	if err != nil || !stored || conv == "" {
		t.Fatalf("Record = %v %q %v", stored, conv, err)
	}
	if again, conv2, _ := in.Record(f.ctx, f.tx, m); again || conv2 != conv {
		t.Errorf("echo = %v %q", again, conv2)
	}
	reply, err := in.OnInbound(f.ctx, f.tx, conv, &body, night)
	if err != nil || reply == nil || *reply != "Kami tutup" {
		t.Fatalf("OnInbound = %v %v", reply, err)
	}
	if again, _ := in.OnInbound(f.ctx, f.tx, conv, &body, night.Add(time.Hour)); again != nil {
		t.Error("one auto-reply per WIB day")
	}
	if f.scalar(`SELECT awaiting_since::text FROM crm.wa_conversations WHERE id = $1`, conv) == "" {
		t.Error("SLA clock not started")
	}
	in.AutoReply(f.ctx, f.tx, phone, conv, *reply)
	if len(sent) != 1 || sent[0] != phone+": Kami tutup" ||
		f.scalar(`SELECT message_type FROM crm.wa_messages WHERE conversation_id = $1 AND direction = 'out'`, conv) != "system" {
		t.Fatalf("auto-reply sent %v", sent)
	}

	// CSAT: a rating after the request closes the conversation again.
	f.exec(`UPDATE crm.wa_conversations SET csat_asked_at = now(), status = 'open' WHERE id = $1`, conv)
	five := "5"
	if _, err := in.OnInbound(f.ctx, f.tx, conv, &five, night.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if f.scalar(`SELECT csat_score::text || status FROM crm.wa_conversations WHERE id = $1`, conv) != "5resolved" {
		t.Error("CSAT not captured")
	}

	// Message log: list, resend a failed one on its conversation, mark it.
	log := integrationsMessageLog{inbox: crmInboxGateway(deps)}
	failed := f.scalar(`INSERT INTO crm.wa_messages (conversation_id, direction, message_type, phone, body, status, error_reason)
		VALUES ($1, 'out', 'chat', $2, 'Pesanan siap', 'failed', 'timeout') RETURNING id::text`, conv, phone)
	rows, summary, err := log.List(f.ctx, f.tx, settings.MessageFilter{Direction: "out", Status: "failed", Search: phone[:8] + "%", Limit: "5"})
	if err != nil || len(rows) != 1 || rows[0].ID != failed || summary.TotalFailed < 1 {
		t.Fatalf("List = %+v %+v %v", rows, summary, err)
	}
	if err := database.WithTx(f.ctx, f.tx, func(sp pgx.Tx) error {
		_, _, err := log.List(f.ctx, sp, settings.MessageFilter{Limit: "1.5"})
		return err
	}); database.PgCode(err) != "22P02" {
		t.Errorf("a fractional limit fails like the TS (22P02): %v", err)
	}
	original, err := log.Outbound(f.ctx, f.tx, failed)
	if err != nil || original == nil || *original.ConversationID != conv {
		t.Fatalf("Outbound = %+v %v", original, err)
	}
	res := log.Resend(f.ctx, f.tx, *original, "")
	if !res.Success || res.MessageID == nil || sent[1] != phone+": Pesanan siap" {
		t.Fatalf("Resend = %+v", res)
	}
	if n := f.scalar(`SELECT count(*)::text FROM crm.wa_messages WHERE conversation_id = $1 AND provider_message_id = $2`, conv, *res.MessageID); n != "1" {
		t.Error("the resend is not logged on the conversation")
	}
	if err := log.MarkResent(f.ctx, f.tx, failed); err != nil || f.scalar(`SELECT status FROM crm.wa_messages WHERE id = $1`, failed) != "sent" {
		t.Errorf("MarkResent: %v", err)
	}
}

func TestIntegrationsPartnersIngest(t *testing.T) {
	m := testutil.CreateMember(t)
	f := integrationsFixture{t, context.Background(), testutil.Tx(t)}
	deps := testutil.Deps(t, nil)
	p := integrationsPartners{events: partners.NewEvents(crm.NewEngine(deps, crmPosReads{}))}
	code := "PB" + strings.ToUpper(testutil.RandomHex(3))
	f.exec(`INSERT INTO crm.crm_integration_partners (code, name, partner_type, is_active, awards_xp, xp_per_event, signing_secret)
		VALUES ($1, 'Photobooth', 'photobooth', true, true, 25, 's3cret')`, code)
	partner, err := p.FindByCode(f.ctx, f.tx, " "+strings.ToLower(code)+" ")
	if err != nil || partner == nil || partner.SigningSecret != "s3cret" || !partner.IsActive {
		t.Fatalf("FindByCode = %+v %v", partner, err)
	}
	if none, err := p.FindByCode(f.ctx, f.tx, "NOPE-"+code); none != nil || err != nil {
		t.Error("unknown partner found")
	}
	subject := m.Phone
	ev := webhooks.PartnerEvent{ExternalID: "ext-1", EventType: "photo", Subject: &subject, Payload: []byte(`{"frame":2}`)}
	res, err := p.Ingest(f.ctx, f.tx, *partner, ev)
	if err != nil || res.Status != "processed" || res.XPAwarded != 25 || res.Duplicate {
		t.Fatalf("Ingest = %+v %v", res, err)
	}
	again, err := p.Ingest(f.ctx, f.tx, *partner, ev)
	if err != nil || !again.Duplicate || again.ID != res.ID || again.XPAwarded != 25 {
		t.Errorf("resend = %+v %v", again, err)
	}
	unknown := "nobody@example.com"
	ev = webhooks.PartnerEvent{ExternalID: "ext-2", EventType: "photo", Subject: &unknown, Payload: []byte(`{}`)}
	if res, _ := p.Ingest(f.ctx, f.tx, *partner, ev); res.Status != "unmatched" || res.XPAwarded != 0 {
		t.Errorf("unmatched = %+v", res)
	}
}

func TestIntegrationsFlashReport(t *testing.T) {
	tx := testutil.Tx(t)
	d, err := integrationsFlashSQL{}.Gather(context.Background(), tx, "2026-10-01")
	if err != nil || d.ByCategory == nil && d.Revenue != 0 {
		t.Fatalf("Gather = %+v %v", d, err)
	}
	if _, err := (integrationsFlashSQL{}).Gather(context.Background(), tx, "2026-13-45"); err == nil {
		t.Error("an impossible date must fail")
	}
	got := flashStalls([]string{"A", "B"}, []domain.FlashLine{{Name: "B", Revenue: 10, Pcs: 1}, {Name: "Tanpa stall", Revenue: 20, Pcs: 2}})
	if len(got) != 3 || got[0].Name != "Tanpa stall" || got[1].Name != "B" || got[2].Name != "A" {
		t.Errorf("stalls = %+v", got)
	}
}
