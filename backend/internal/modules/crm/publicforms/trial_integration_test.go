package publicforms

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/crm/advance"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/whatsapp"
)

type stubGateway struct{ g *whatsapp.Gateway }

func (s stubGateway) LoadGateway(context.Context, database.Querier) *whatsapp.Gateway { return s.g }

// scoreRecords is the one sales-funnel write the lead.created subscriber
// needs here (rescoring); the rest stay unwired.
type scoreRecords struct{ advance.SalesRecords }

func (scoreRecords) SetLeadScore(ctx context.Context, q database.Querier, leadID string, score int, breakdown string) error {
	_, err := q.Exec(ctx, `UPDATE crm.crm_sales_leads SET score = $2, score_breakdown = $3::jsonb, score_updated_at = now() WHERE id = $1`, leadID, score, breakdown)
	return err
}

// trialFixture: a throwaway branch with a slug, the handler on a rolled-back
// transaction, the CRM subscriber on an outbox bus, and a fake WhatsApp
// gateway that records what it sends.
type trialFixture struct {
	*fixture
	slug, branchName, companyID, branchID string
	bus                                   *outbox.Bus
	dispatch                              func()
	wa                                    []map[string]string
}

func newTrialFixture(t *testing.T) *trialFixture {
	t.Helper()
	tx := testutil.Tx(t)
	ctx := context.Background()
	org := testutil.CreateOrg(t, tx)
	f := &trialFixture{fixture: sqlFixture(t, tx), slug: "go-trial-" + testutil.RandomHex(3), companyID: org.CompanyID, branchID: org.BranchID}
	f.exec(`UPDATE configuration.branches SET slug = $2 WHERE id = $1`, org.BranchID, f.slug)
	f.branchName = f.val(`SELECT name FROM configuration.branches WHERE id = $1`, org.BranchID)
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.wa = append(f.wa, body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"messageId":"wamid-1"}`))
	}))
	t.Cleanup(gw.Close)
	deps := testutil.Deps(t, nil)
	ports := advance.Ports{Records: scoreRecords{}, WhatsApp: stubGateway{g: &whatsapp.Gateway{BaseURL: gw.URL, Token: "t", Timeout: 5 * time.Second}}}
	f.mount(newHandler(tx, deps, ports, sqlLeads{}))
	f.bus = outbox.NewBus(nil, deps.Log)
	advance.Subscribe(f.bus, deps, ports)
	if err := f.bus.Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	f.dispatch = func() {
		t.Helper()
		if _, err := f.bus.Dispatch(ctx, tx); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func (f *trialFixture) trial(body any, ip string) (int, map[string]any, string) {
	f.t.Helper()
	r := testutil.Request("POST", "/api/public/site/trial", body)
	r.Header.Set("x-forwarded-for", ip)
	r.Header.Set("user-agent", "go-test-browser")
	res, out := testutil.Do(f.t, f.mux, r)
	data, _ := out["data"].(map[string]any)
	return res.Code, data, strings.TrimSpace(res.Body.String())
}

func (f *trialFixture) body(phone string) map[string]any {
	return map[string]any{
		"branch_slug": f.slug, "first_name": "Ani", "last_name": "Budi", "email": "ani@example.test", "phone": phone,
		"consent_email": true, "consent_sms": false, "source_path": "/locations/" + f.slug,
		"utm": map[string]any{"utm_source": "IG", "utm_campaign": "trial-oktober"},
	}
}

func TestTrialLead(t *testing.T) {
	staff := testutil.CreateStaff(t, testutil.StaffOptions{}) // before the transaction (cleanup order)
	f := newTrialFixture(t)
	f.exec(`INSERT INTO crm.crm_workflow_rules (company_id, name, object, trigger_type, actions)
		VALUES ($1, 'Sambut coba gratis', 'lead', 'created', $2::jsonb)`, f.companyID,
		`[{"type":"notify_in_app","to":"user","user_id":"`+staff.UserID+`","title":"Trial: {{lead.org_name}}","message":"{{event.source}}"}]`)

	code, data, raw := f.trial(f.body("+628123450001"), "10.1.0.1")
	if code != 200 || data["branch_name"] != f.branchName || data["lead_id"] == nil {
		t.Fatalf("%d %s", code, raw)
	}
	lead := data["lead_id"].(string)
	if got := f.val(`SELECT org_name || '|' || pic_name || '|' || pic_phone || '|' || COALESCE(pic_email, '') || '|' || source || '|' || temperature || '|' || status
		|| '|' || branch_id::text || '|' || org_type || '|' || utm_source || '|' || utm_campaign || '|' || landing_page || '|' || (custom->>'trial')
		FROM crm.crm_sales_leads WHERE id = $1`, lead); got != "Ani Budi (trial)|Ani Budi|628123450001|ani@example.test|website|hangat|baru|"+f.branchID+"|perorangan|IG|trial-oktober|/locations/"+f.slug+"|true" {
		t.Errorf("lead = %s", got)
	}
	if got := f.val(`SELECT string_agg(channel || ':' || granted::text || ':' || consent_text_version || ':' || user_agent || ':' || source_path || ':' || length(ip_hash)::text, ',' ORDER BY channel)
		FROM crm.lead_consents WHERE lead_id = $1`, lead); got != "email:true:"+ConsentTextVersion+":go-test-browser:/locations/"+f.slug+":64,sms:false:"+ConsentTextVersion+":go-test-browser:/locations/"+f.slug+":64" {
		t.Errorf("consents = %s", got)
	}
	if len(f.wa) != 1 || f.wa[0]["target"] != "628123450001" || !strings.Contains(f.wa[0]["message"], "Terima kasih, Ani!") || !strings.Contains(f.wa[0]["message"], "Tim "+f.branchName+" akan menghubungi") {
		t.Errorf("whatsapp = %v", f.wa)
	}

	// lead.created travels through the outbox: after dispatch CRM has the
	// event on file and the workflow rule has notified the staff.
	f.dispatch()
	if got := f.val(`SELECT event_type || '|' || (payload->>'form') || '|' || (payload->'utm'->>'utm_source') FROM crm.crm_events
		WHERE subject_id = $1::uuid AND subject_type = 'lead' AND event_type = 'lead.created'`, lead); got != "lead.created|trial|IG" {
		t.Errorf("event = %s", got)
	}
	if got := f.val(`SELECT title || '|' || message FROM public.notifications WHERE user_id = $1 AND title LIKE 'Trial:%'`, staff.UserID); got != "Trial: Ani Budi (trial)|website" {
		t.Errorf("notification = %s", got)
	}

	// The same phone inside a day gets the same lead and nothing else.
	code, again, raw := f.trial(f.body("+628123450001"), "10.1.0.2")
	if code != 200 || again["lead_id"] != lead {
		t.Fatalf("dedupe %d %s", code, raw)
	}
	if n := f.val(`SELECT count(*)::text FROM crm.lead_consents WHERE lead_id = $1`, lead); n != "2" || len(f.wa) != 1 {
		t.Errorf("dedupe wrote consents=%s wa=%d", n, len(f.wa))
	}
	if n := f.val(`SELECT count(*)::text FROM crm.crm_sales_leads WHERE pic_phone = '628123450001'`); n != "1" {
		t.Errorf("leads = %s", n)
	}
}

func TestTrialRejections(t *testing.T) {
	f := newTrialFixture(t)
	leads := func() string {
		return f.val(`SELECT count(*)::text FROM crm.crm_sales_leads WHERE company_id = $1`, f.companyID)
	}

	// A filled honeypot gets the success shape and no lead.
	bot := f.body("+628123450002")
	bot["website_url"] = "http://spam"
	if code, _, raw := f.trial(bot, "10.2.0.1"); code != 200 || raw != `{"success":true,"data":{"lead_id":null,"branch_name":null}}` {
		t.Fatalf("bot %d %s", code, raw)
	}
	if code, _, raw := f.trial("bukan-json", "10.2.0.2"); code != 400 || raw != `{"success":false,"error":"Isian tidak terbaca"}` {
		t.Fatalf("body %d %s", code, raw)
	}
	bad := f.body("08123450003")
	bad["email"] = "bukan-email"
	code, _, raw := f.trial(bad, "10.2.0.3")
	if code != 400 || !strings.HasPrefix(raw, `{"success":false,"error":"Periksa kembali isian Anda","details":[`) ||
		!strings.Contains(raw, `"path":["email"]`) || !strings.Contains(raw, `"path":["phone"]`) {
		t.Fatalf("invalid %d %s", code, raw)
	}
	unknown := f.body("+628123450004")
	unknown["branch_slug"] = "tidak-ada-" + testutil.RandomHex(2)
	if code, _, raw := f.trial(unknown, "10.2.0.4"); code != 404 || raw != `{"success":false,"error":"Cabang tidak ditemukan"}` {
		t.Fatalf("branch %d %s", code, raw)
	}
	if leads() != "0" || len(f.wa) != 0 {
		t.Fatalf("rejected requests wrote leads=%s wa=%d", leads(), len(f.wa))
	}

	// Five requests per IP per five minutes, counted before any work.
	for range 5 {
		f.trial(map[string]any{}, "10.2.0.9")
	}
	if code, _, raw := f.trial(f.body("+628123450005"), "10.2.0.9"); code != 429 || raw != `{"success":false,"error":"Terlalu banyak percobaan. Coba lagi beberapa menit lagi."}` {
		t.Fatalf("limit %d %s", code, raw)
	}
}
