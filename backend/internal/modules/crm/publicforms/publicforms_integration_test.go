package publicforms

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/crm/advance"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Ported from app/api/public/crm/forms/[slug]/route.test.ts and
// lib/crm/public-forms-submit.test.ts, on a rolled-back transaction.

// sqlLeads stands in for the sales-funnel Records service, which this
// package may not import (internal/app wires the real one).
type sqlLeads struct{}

func (sqlLeads) Duplicate(ctx context.Context, q database.Querier, companyID, phone, orgName string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM crm.crm_sales_leads
		WHERE company_id = $1 AND pic_phone = $2 AND lower(org_name) = lower($3) AND deleted_at IS NULL`, companyID, phone, orgName).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (sqlLeads) AppendNote(ctx context.Context, q database.Querier, leadID, note string) error {
	_, err := q.Exec(ctx, `UPDATE crm.crm_sales_leads SET notes = COALESCE(notes || E'\n\n', '') || $2 WHERE id = $1`, leadID, note)
	return err
}

func (sqlLeads) Create(ctx context.Context, q database.Querier, in NewLead) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO crm.crm_sales_leads (company_id, branch_id, org_name, org_type, pic_name, pic_phone,
		  pic_email, city, notes, source, temperature, status, custom, utm_source, utm_campaign)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'hangat', 'baru', $11::jsonb, $12, $13) RETURNING id::text`,
		in.CompanyID, in.BranchID, in.OrgName, in.OrgType, in.PicName, in.PicPhone, in.PicEmail, in.City, in.Notes,
		in.Source, in.Custom, in.Attribution.UtmSource, in.Attribution.UtmCampaign).Scan(&id)
	return id, err
}

type noGateway struct{}

func (noGateway) LoadGateway(context.Context, database.Querier) *whatsapp.Gateway { return nil }

type fixture struct {
	t    *testing.T
	mux  *http.ServeMux
	exec func(sql string, args ...any)
	val  func(sql string, args ...any) string
}

func newFixture(t *testing.T) (*fixture, string, string) {
	t.Helper()
	staff := testutil.CreateStaff(t, testutil.StaffOptions{}) // before the transaction (cleanup order)
	tx := testutil.Tx(t)
	ctx := context.Background()
	f := &fixture{t: t}
	f.exec = func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	f.val = func(sql string, args ...any) string {
		t.Helper()
		var v *string
		if err := tx.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nil>"
		}
		return *v
	}
	company := f.val(`SELECT id::text FROM configuration.companies ORDER BY created_at LIMIT 1`)
	branch := f.val(`SELECT id::text FROM configuration.branches WHERE company_id = $1 ORDER BY created_at LIMIT 1`, company)
	h := newHandler(tx, testutil.Deps(t, nil), advance.Ports{WhatsApp: noGateway{}}, sqlLeads{})
	f.mux = http.NewServeMux()
	for _, r := range h.routes() {
		f.mux.Handle(r.Pattern, r.Handler)
	}
	slug := "go-" + testutil.RandomHex(4)
	f.exec(`INSERT INTO crm.crm_forms (company_id, branch_id, slug, name, title, success_message, redirect_url, notify_user_ids)
		VALUES ($1, $2, $3, 'Kontak', 'Hubungi kami', 'Terima kasih!', 'https://example.com/ok', jsonb_build_array($4::text))`,
		company, branch, slug, staff.UserID)
	return f, slug, staff.UserID
}

func (f *fixture) post(slug string, body any, ip string) (int, string) {
	f.t.Helper()
	r := testutil.Request("POST", "/api/public/crm/forms/"+slug, body)
	r.Header.Set("x-forwarded-for", ip)
	r.Header.Set("user-agent", "go-test")
	res, _ := testutil.Do(f.t, f.mux, r)
	return res.Code, strings.TrimSpace(res.Body.String())
}

func TestPublicFormDefinition(t *testing.T) {
	f, slug, _ := newFixture(t)
	res, _ := testutil.Do(t, f.mux, testutil.Request("GET", "/api/public/crm/forms/tidak-ada-"+testutil.RandomHex(3), nil))
	if res.Code != 404 || strings.TrimSpace(res.Body.String()) != `{"success":false,"error":"Form tidak ditemukan"}` {
		t.Fatalf("%d %s", res.Code, res.Body)
	}
	res, body := testutil.Do(t, f.mux, testutil.Request("GET", "/api/public/crm/forms/"+slug, nil))
	data := body["data"].(map[string]any)
	if res.Code != 200 || len(data) != 7 || data["submit_label"] != "Kirim" || data["redirect_url"] != "https://example.com/ok" {
		t.Fatalf("data = %v", data)
	}
	if !strings.Contains(res.Body.String(), `"fields":[{"key":"pic_name","label":"Nama Anda","type":"text","required":true,"placeholder":"cth. Budi Santoso","help_text":null,"options":[],"width":1}`) {
		t.Fatalf("default fields: %s", res.Body)
	}
}

func TestPublicFormSubmissions(t *testing.T) {
	f, slug, staff := newFixture(t)
	formID := f.val(`SELECT id::text FROM crm.crm_forms WHERE slug = $1`, slug)
	recorded := func() string {
		return f.val(`SELECT COALESCE(string_agg(status || ':' || COALESCE(reason, ''), ',' ORDER BY created_at, status), '') FROM crm.crm_form_submissions WHERE form_id = $1`, formID)
	}

	code, body := f.post(slug, "bukan-json", "10.0.0.1")
	if code != 400 || body != `{"success":false,"error":"Isian tidak terbaca"}` {
		t.Fatalf("%d %s", code, body)
	}
	code, body = f.post(slug, map[string]any{"pic_name": "Ani"}, "10.0.0.2")
	if code != 400 || !strings.HasPrefix(body, `{"success":false,"error":"Periksa kembali isian Anda","details":[{"key":"pic_phone","message":"Nomor WhatsApp wajib diisi"}`) {
		t.Fatalf("%d %s", code, body)
	}
	code, body = f.post(slug, map[string]any{"website_url": "spam"}, "10.0.0.3")
	if code != 200 || body != `{"success":true,"data":{"message":"Terima kasih!","redirect_url":"https://example.com/ok"}}` {
		t.Fatalf("bot %d %s", code, body)
	}
	if got := recorded(); got != "rejected:validasi gagal,rejected:honeypot terisi" && got != "rejected:honeypot terisi,rejected:validasi gagal" {
		t.Fatalf("recorded = %s", got)
	}

	valid := map[string]any{"org_name": "PT Kopi Go", "pic_name": "Ani", "pic_phone": "081234567890", "notes": "Sewa tempat",
		"utm_source": "IG", "utm_campaign": "oktober"}
	code, body = f.post(slug, valid, "10.0.0.4")
	if code != 200 || body != `{"success":true,"data":{"message":"Terima kasih!","redirect_url":"https://example.com/ok"}}` {
		t.Fatalf("valid %d %s", code, body)
	}
	lead := f.val(`SELECT id::text FROM crm.crm_sales_leads WHERE org_name = 'PT Kopi Go' AND pic_phone = '6281234567890'`)
	if got := f.val(`SELECT source || '|' || temperature || '|' || status || '|' || utm_campaign || '|' || custom::text FROM crm.crm_sales_leads WHERE id = $1`, lead); got != "instagram|hangat|baru|oktober|{}" {
		t.Errorf("lead = %s", got)
	}
	if got := f.val(`SELECT event_type || '|' || (payload->>'form_slug') || '|' || (payload->'utm'->>'utm_source') FROM crm.crm_events WHERE subject_id = $1::uuid AND subject_type = 'lead'`, lead); got != "lead.created|"+slug+"|IG" {
		t.Errorf("event = %s", got)
	}
	if got := f.val(`SELECT title || '|' || link FROM public.notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, staff); got != "Lead baru: PT Kopi Go|/dashboard/sales-funnel/leads/"+lead {
		t.Errorf("notification = %s", got)
	}

	// The same phone and org reuse the lead and append the note.
	valid["notes"] = "Tambah 20 pax"
	if code, body = f.post(slug, valid, "10.0.0.5"); code != 200 {
		t.Fatalf("duplicate %d %s", code, body)
	}
	if notes := f.val(`SELECT notes FROM crm.crm_sales_leads WHERE id = $1`, lead); !strings.HasPrefix(notes, "Sewa tempat\n\n[Form publik ") || !strings.HasSuffix(notes, "] Tambah 20 pax") {
		t.Errorf("notes = %q", notes)
	}
	if got := f.val(`SELECT submission_count::text FROM crm.crm_forms WHERE id = $1`, formID); got != "2" {
		t.Errorf("submission_count = %s", got)
	}
	if got := f.val(`SELECT string_agg(status, ',' ORDER BY status) FROM crm.crm_form_submissions WHERE form_id = $1 AND lead_id IS NOT NULL`, formID); got != "duplicate,ok" {
		t.Errorf("lead submissions = %s", got)
	}

	// No company on the form and no CRM default venue: 503.
	f.exec(`UPDATE crm.crm_forms SET company_id = NULL WHERE id = $1`, formID)
	f.exec(`DELETE FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`)
	code, body = f.post(slug, valid, "10.0.0.6")
	if code != 503 || body != `{"success":false,"error":"Form belum siap menerima kiriman. Hubungi kami lewat WhatsApp."}` {
		t.Fatalf("no venue %d %s", code, body)
	}

	// Five submissions per IP per five minutes, checked before the database.
	for range 5 {
		f.post("tidak-ada", map[string]any{}, "10.0.0.9")
	}
	code, body = f.post("tidak-ada", map[string]any{}, "10.0.0.9")
	if code != 429 || body != `{"success":false,"error":"Terlalu banyak kiriman — coba lagi beberapa menit lagi"}` {
		t.Fatalf("limit %d %s", code, body)
	}
}

// A form lead fires the lead-created workflow rules like a dashboard lead.
func TestPublicFormLeadRunsLeadCreatedRules(t *testing.T) {
	f, slug, staff := newFixture(t)
	company := f.val(`SELECT company_id::text FROM crm.crm_forms WHERE slug = $1`, slug)
	f.exec(`INSERT INTO crm.crm_workflow_rules (company_id, name, object, trigger_type, actions)
		VALUES ($1, 'Lead baru dari mana saja', 'lead', 'created', $2::jsonb)`, company,
		`[{"type":"notify_in_app","to":"user","user_id":"`+staff+`","title":"Rule: {{lead.org_name}}","message":"{{event.source}}"}]`)
	code, body := f.post(slug, map[string]any{"org_name": "PT Rule Go", "pic_name": "Ani", "pic_phone": "081298765432", "notes": "Outing", "utm_source": "IG"}, "10.0.1.1")
	if code != 200 {
		t.Fatalf("%d %s", code, body)
	}
	lead := f.val(`SELECT id::text FROM crm.crm_sales_leads WHERE org_name = 'PT Rule Go'`)
	if got := f.val(`SELECT r.status FROM crm.crm_workflow_runs r JOIN crm.crm_workflow_rules w ON w.id = r.rule_id
		WHERE w.name = 'Lead baru dari mana saja' AND r.subject_id = $1::uuid`, lead); got != "success" {
		t.Fatalf("run = %s", got)
	}
	if got := f.val(`SELECT title || '|' || message FROM public.notifications WHERE user_id = $1 AND title LIKE 'Rule:%'`, staff); got != "Rule: PT Rule Go|public_form" {
		t.Fatalf("notification = %s", got)
	}
}
