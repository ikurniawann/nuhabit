package marketing

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

// Every test runs its handlers on one rolled-back transaction; only the
// staff fixtures are committed (and cleaned up by testutil).

var testNow = time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)

type env struct {
	t     *testing.T
	ctx   context.Context
	tx    pgx.Tx
	h     *handler
	staff testutil.Staff
	tier  string // unique membership_tier that isolates fixture customers
}

func newEnv(t *testing.T) *env {
	t.Helper()
	// Staff first: cleanups run in reverse, so the transaction that may
	// reference the user rolls back before the user is deleted.
	staff := crmtest.Staff(t, "crm.promo")
	d := testutil.Deps(t, func() time.Time { return testNow })
	tx := testutil.Tx(t)
	h := newHandler(tx, d.Auth, func() time.Time { return testNow }, Ports{AppSettingsSQL{}, promoTables{}, FunnelSQL{}})
	e := &env{t: t, ctx: context.Background(), tx: tx, h: h, tier: "gotest-" + testutil.RandomHex(4)}
	e.staff = staff
	return e
}

// promoTables stands in for stored-value's promo service (internal/app wires
// it) with the same SQL, so the voucher test reads real promo rows.
type promoTables struct{}

func (promoTables) IssueCode(ctx context.Context, q database.Querier, companyID, branchID, campaignID, code string) (bool, error) {
	tag, err := q.Exec(ctx, `INSERT INTO promo.promo_codes (company_id, branch_id, campaign_id, code, usage_limit)
		VALUES ($1, $2, $3, $4, 1) ON CONFLICT (branch_id, code) DO NOTHING`, companyID, branchID, campaignID, code)
	return tag.RowsAffected() > 0, err
}

func (promoTables) BatchConversion(ctx context.Context, q database.Querier, codes []string) (Conversion, error) {
	var c Conversion
	err := q.QueryRow(ctx, `SELECT COUNT(DISTINCT r.code_id)::float8, COALESCE(SUM(r.discount_amount), 0)::float8
		FROM promo.promo_redemptions r JOIN promo.promo_codes k ON k.id = r.code_id
		WHERE r.status <> 'released' AND k.code = ANY($1)`, codes).Scan(&c.Count, &c.Value)
	return c, err
}

func (promoTables) PublicConversion(ctx context.Context, q database.Querier, campaignID string, phones []string) (Conversion, error) {
	var c Conversion
	err := q.QueryRow(ctx, `SELECT COUNT(*)::float8, COALESCE(SUM(r.discount_amount), 0)::float8
		FROM promo.promo_redemptions r
		WHERE r.campaign_id = $1 AND r.status <> 'released' AND r.phone = ANY($2)`, campaignID, phones).Scan(&c.Count, &c.Value)
	return c, err
}

// ServeHTTP runs one request in a savepoint, released on success and
// rolled back on an error status, so a request that fails in PostgreSQL
// (22P02 and the like) does not abort the test transaction.
func (e *env) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sp, err := e.tx.Begin(e.ctx)
	if err != nil {
		e.t.Fatal(err)
	}
	e.h.db, e.h.guard.DB = sp, sp
	rec := httptest.NewRecorder()
	crmtest.Mux(e.h.routes()).ServeHTTP(rec, r)
	if rec.Code >= 400 {
		err = sp.Rollback(e.ctx)
	} else {
		err = sp.Commit(e.ctx)
	}
	if err != nil {
		e.t.Fatal(err)
	}
	for k, v := range rec.Header() {
		w.Header()[k] = v
	}
	w.WriteHeader(rec.Code)
	_, _ = w.Write(rec.Body.Bytes())
}

func (e *env) call(method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	return crmtest.Call(e.t, e, method, path, body, &e.staff)
}

func (e *env) raw(method, path string, body any) (int, string) {
	e.t.Helper()
	rec, _ := testutil.Do(e.t, e, testutil.AsStaff(testutil.Request(method, path, body), e.staff))
	return rec.Code, rec.Body.String()
}

func (e *env) exec(sql string, args ...any) { crmtest.MustExec(e.t, e.tx, sql, args...) }

func (e *env) scalar(sql string, args ...any) string {
	return crmtest.Scalar[string](e.t, e.tx, sql, args...)
}

// venue pins the default venue to an existing company and branch.
func (e *env) venue() (company, branch string) {
	company = e.scalar(`SELECT id::text FROM configuration.companies ORDER BY created_at LIMIT 1`)
	branch = e.scalar(`SELECT id::text FROM configuration.branches WHERE company_id = $1 ORDER BY created_at LIMIT 1`, company)
	for k, v := range map[string]string{"default_company_id": company, "default_branch_id": branch} {
		e.exec(`INSERT INTO crm.crm_settings (key, value) VALUES ($1, to_jsonb($2::text))
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, k, v)
	}
	return company, branch
}

// customer inserts an active customer in the test tier.
func (e *env) customer(name, phone string, xp int, lastVisitDaysAgo int) string {
	return e.scalar(`INSERT INTO pos.pos_customers (name, phone, membership_tier, total_xp, visit_count, total_spent, last_visit, is_active, wa_consent)
		VALUES ($1, $2, $3, $4, $4, $4 * 1000, now() - make_interval(days => $5), true, true) RETURNING id::text`,
		name, phone, e.tier, xp, lastVisitDaysAgo)
}

func phone() string { return "0812" + fmt.Sprint(time.Now().UnixNano()%100000000) }

func expect(t *testing.T, status int, body map[string]any, wantStatus int, wantError string) {
	t.Helper()
	if status != wantStatus {
		t.Fatalf("status %d want %d: %v", status, wantStatus, body)
	}
	if wantError != "" && body["error"] != wantError {
		t.Fatalf("error %v want %q", body["error"], wantError)
	}
}

func data(body map[string]any) map[string]any { m, _ := body["data"].(map[string]any); return m }
func list(body map[string]any) []any          { l, _ := body["data"].([]any); return l }

func TestAuthFailures(t *testing.T) {
	e := newEnv(t)
	other := crmtest.Staff(t, "pos.reports")
	routes := []struct{ method, path string }{
		{"GET", "/api/crm/segments"}, {"POST", "/api/crm/segments"}, {"POST", "/api/crm/segments/preview"},
		{"GET", "/api/crm/segments/x"}, {"PATCH", "/api/crm/segments/x"}, {"DELETE", "/api/crm/segments/x"},
		{"POST", "/api/crm/segments/x/preview"},
		{"GET", "/api/crm/campaigns"}, {"POST", "/api/crm/campaigns"}, {"POST", "/api/crm/campaigns/preview"},
		{"PATCH", "/api/crm/campaigns/x"}, {"GET", "/api/crm/campaigns/x/report"},
		{"GET", "/api/crm/campaign-config"}, {"PUT", "/api/crm/campaign-config"},
		{"GET", "/api/crm/campaign-optouts"}, {"POST", "/api/crm/campaign-optouts"}, {"DELETE", "/api/crm/campaign-optouts"},
		{"GET", "/api/crm/forms"}, {"POST", "/api/crm/forms"},
		{"GET", "/api/crm/forms/x"}, {"PATCH", "/api/crm/forms/x"}, {"DELETE", "/api/crm/forms/x"},
	}
	for _, rt := range routes {
		status, body := crmtest.Call(t, e, rt.method, rt.path, map[string]any{}, nil)
		if status != http.StatusUnauthorized {
			t.Errorf("%s %s without session: %d %v", rt.method, rt.path, status, body)
		}
		status, body = crmtest.Call(t, e, rt.method, rt.path, map[string]any{}, &other)
		if status != http.StatusForbidden {
			t.Errorf("%s %s without menu: %d %v", rt.method, rt.path, status, body)
		}
	}
}

func TestSegmentsCRUD(t *testing.T) {
	e := newEnv(t)

	status, body := e.call("POST", "/api/crm/segments", map[string]any{"name": "", "definition": map[string]any{"source": "x"}})
	expect(t, status, body, 400, "Validation failed")
	if details, _ := body["details"].([]any); len(details) != 2 {
		t.Fatalf("details %v", body["details"])
	}

	status, body = e.call("POST", "/api/crm/segments", map[string]any{
		"name": " Pelanggan setia ", "description": nil,
		"definition": map[string]any{"source": "member", "filters": []any{map[string]any{"field": " city ", "op": "eq", "value": "Bandung", "x": 1}}},
	})
	expect(t, status, body, 201, "")
	if body["message"] != "Segmen dibuat" {
		t.Fatalf("message %v", body["message"])
	}
	created := data(body)
	id, _ := created["id"].(string)
	if created["name"] != "Pelanggan setia" || created["source"] != "member" || created["is_active"] != true || len(created) != 4 {
		t.Fatalf("created %v", created)
	}
	stored := e.scalar(`SELECT definition::text FROM crm.crm_segments WHERE id = $1`, id)
	want := `{"rfm": {"enabled": false, "recency": {"max": 5, "min": 1}, "monetary": {"max": 5, "min": 1}, "frequency": {"max": 5, "min": 1}}, "limit": 5000, "source": "member", "filters": [{"op": "eq", "field": "city", "value": "Bandung"}], "require_wa_consent": false}`
	if stored != want {
		t.Fatalf("stored %s", stored)
	}

	status, body = e.call("GET", "/api/crm/segments", nil)
	expect(t, status, body, 200, "")
	found := false
	for _, it := range list(body) {
		row := it.(map[string]any)
		if row["id"] == id {
			found = true
			if row["creator_name"] != e.staff.FullName || row["last_count"] != nil {
				t.Fatalf("row %v", row)
			}
		}
	}
	if !found {
		t.Fatal("created segment not listed")
	}

	status, body = e.call("GET", "/api/crm/segments/"+id, nil)
	expect(t, status, body, 200, "")
	if data(body)["definition"].(map[string]any)["limit"] != 5000.0 {
		t.Fatalf("get %v", body)
	}
	status, body = e.call("GET", "/api/crm/segments/8a3a46b7-53b9-4052-b168-000000000000", nil)
	expect(t, status, body, 404, "Segmen tidak ditemukan")
	status, body = e.call("GET", "/api/crm/segments/not-a-uuid", nil)
	expect(t, status, body, 400, "Format data tidak valid")

	// PATCH must not reset defaults: toggling is_active keeps the definition.
	e.exec(`UPDATE crm.crm_segments SET last_count = 7 WHERE id = $1`, id)
	status, body = e.call("PATCH", "/api/crm/segments/"+id, map[string]any{"is_active": false})
	expect(t, status, body, 200, "")
	if body["message"] != "Segmen diperbarui" || data(body)["is_active"] != false || data(body)["name"] != "Pelanggan setia" {
		t.Fatalf("patch %v", body)
	}
	if e.scalar(`SELECT definition->>'limit' || '/' || last_count FROM crm.crm_segments WHERE id = $1`, id) != "5000/7" {
		t.Fatal("patch reset the definition or the count")
	}
	status, body = e.call("PATCH", "/api/crm/segments/"+id, map[string]any{"definition": map[string]any{"source": "lead", "limit": 10}})
	expect(t, status, body, 200, "")
	if data(body)["source"] != "lead" || e.scalar(`SELECT COALESCE(last_count::text, 'null') FROM crm.crm_segments WHERE id = $1`, id) != "null" {
		t.Fatalf("definition patch %v", body)
	}
	status, body = e.call("PATCH", "/api/crm/segments/"+id, map[string]any{"bogus": 1})
	expect(t, status, body, 400, "Tidak ada field yang diubah")
	status, body = e.call("PATCH", "/api/crm/segments/"+id, map[string]any{"definition": nil})
	expect(t, status, body, 400, "Validation failed")
	status, _ = e.raw("PATCH", "/api/crm/segments/"+id, "{bad")
	if status != 500 {
		t.Fatalf("malformed body %d", status)
	}

	company, branch := e.venue()
	e.exec(`INSERT INTO crm.crm_campaigns (company_id, branch_id, name, message_template, segment_id, status)
		VALUES ($1, $2, 'k', 'Halo {nama} apa kabar', $3, 'draft')`, company, branch, id)
	status, body = e.call("DELETE", "/api/crm/segments/"+id, nil)
	expect(t, status, body, 409, "Segmen masih dipakai kampanye yang berjalan")
	e.exec(`UPDATE crm.crm_campaigns SET status = 'done' WHERE segment_id = $1`, id)
	status, raw := e.raw("DELETE", "/api/crm/segments/"+id, nil)
	if status != 204 || raw != "" {
		t.Fatalf("delete %d %q", status, raw)
	}
	status, body = e.call("GET", "/api/crm/segments/"+id, nil)
	expect(t, status, body, 404, "Segmen tidak ditemukan")
}

func TestSegmentPreview(t *testing.T) {
	e := newEnv(t)
	e.customer("Ani", phone(), 50, 3)
	e.customer("Budi", phone(), 500, 40)
	e.customer("Cici", phone(), 900, 90)
	e.customer("Tanpa HP", "", 900, 1)

	tierFilter := map[string]any{"field": "membership_tier", "op": "eq", "value": e.tier}
	status, body := e.call("POST", "/api/crm/segments/preview", map[string]any{
		"source": "member",
		"filters": []any{tierFilter,
			map[string]any{"field": "total_xp", "op": "gte", "value": "100"},
			map[string]any{"field": "last_visit", "op": "lt", "value": testNow.AddDate(0, 0, -10).Format("2006-01-02")},
			map[string]any{"field": "name", "op": "in", "value": []any{"Budi", "Cici", ""}},
		},
	})
	expect(t, status, body, 200, "")
	got := data(body)
	if got["total"] != 2.0 || got["with_rfm"] != false {
		t.Fatalf("preview %v", got)
	}
	sample := got["sample"].([]any)
	first := sample[0].(map[string]any)
	if len(sample) != 2 || first["name"] != "Budi" || len(first) != 3 {
		t.Fatalf("sample %v", sample)
	}

	status, body = e.call("POST", "/api/crm/segments/preview", map[string]any{
		"source": "member", "filters": []any{tierFilter,
			map[string]any{"field": "name", "op": "not_in", "value": []any{"Ani", "Tanpa HP"}}},
	})
	expect(t, status, body, 200, "")
	if got := data(body); got["total"] != 2.0 {
		t.Fatalf("not_in preview %v", got)
	}

	status, body = e.call("POST", "/api/crm/segments/preview", map[string]any{
		"source": "member", "filters": []any{tierFilter},
		"rfm": map[string]any{"enabled": true, "monetary": map[string]any{"min": 2}},
	})
	expect(t, status, body, 200, "")
	got = data(body)
	if got["with_rfm"] != true || got["total"] != 2.0 {
		t.Fatalf("rfm preview %v", got)
	}
	top := got["sample"].([]any)[0].(map[string]any)
	if top["name"] != "Cici" || top["m_score"] != 3.0 || top["total_spent"] != "900000.00" {
		t.Fatalf("rfm sample %v", top)
	}

	status, body = e.call("POST", "/api/crm/segments/preview", map[string]any{"source": "lead", "filters": []any{
		map[string]any{"field": "org_name", "op": "eq", "value": "zz-" + e.tier},
	}})
	expect(t, status, body, 200, "")
	if got := data(body); got["total"] != 0.0 || len(got["sample"].([]any)) != 0 {
		t.Fatalf("lead preview %v", got)
	}

	status, body = e.call("POST", "/api/crm/segments/preview", map[string]any{"source": "member", "limit": 0})
	expect(t, status, body, 400, "Validation failed")

	def := fmt.Sprintf(`{"source":"member","filters":[{"field":"membership_tier","op":"eq","value":%q}]}`, e.tier)
	id := e.scalar(`INSERT INTO crm.crm_segments (name, source, definition) VALUES ('s', 'member', $1::jsonb) RETURNING id::text`, def)
	status, body = e.call("POST", "/api/crm/segments/"+id+"/preview", nil)
	expect(t, status, body, 200, "")
	if body["message"] != "3 anggota" || data(body)["total"] != 3.0 {
		t.Fatalf("saved preview %v", body)
	}
	if e.scalar(`SELECT last_count::text FROM crm.crm_segments WHERE id = $1`, id) != "3" {
		t.Fatal("count not remembered")
	}
}

func TestCampaignCreateAndList(t *testing.T) {
	e := newEnv(t)
	e.venue()
	base := func(over map[string]any) map[string]any {
		b := map[string]any{"name": "Promo Oktober", "message_template": "Halo {nama}, ada promo baru!", "segment": map[string]any{}}
		for k, v := range over {
			b[k] = v
		}
		return b
	}
	promo := "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"

	status, body := e.call("POST", "/api/crm/campaigns", base(map[string]any{"promo_campaign_id": promo, "promo_mode": "batch"}))
	if status != 400 || len(body) != 2 || body["error"] != "Mode voucher batch wajib mengisi prefix kode" {
		t.Fatalf("batch without prefix %d %v", status, body)
	}
	status, body = e.call("POST", "/api/crm/campaigns", base(map[string]any{"message_template": "Pakai kode {kode} ya kak"}))
	expect(t, status, body, 400, "Template memuat {kode} tapi kampanye tidak melampirkan promo")
	status, body = e.call("POST", "/api/crm/campaigns", map[string]any{"name": "ab", "message_template": "0123456789", "channels": []any{}})
	expect(t, status, body, 400, "Validation failed")
	details := body["details"].([]any)
	if len(details) != 2 || details[0].(map[string]any)["message"] != "Invalid input: expected nonoptional, received undefined" {
		t.Fatalf("details %v", details)
	}
	status, body = e.call("POST", "/api/crm/campaigns", base(map[string]any{"scheduled_at": "2026-10-04T10:02:00+07:00"}))
	expect(t, status, body, 400, "Waktu kirim minimal 5 menit dari sekarang")

	status, body = e.call("POST", "/api/crm/campaigns", base(map[string]any{"channels": []any{"in_app", "wa"}, "inapp_title": ""}))
	expect(t, status, body, 200, "")
	if body["message"] != "Kampanye dibuat (draft)" || len(data(body)) != 1 {
		t.Fatalf("create %v", body)
	}
	id := data(body)["id"].(string)
	if got := e.scalar(`SELECT status || '|' || segment::text || '|' || array_to_string(channels, ',') || '|' || COALESCE(inapp_title, 'null') FROM crm.crm_campaigns WHERE id = $1`, id); got != `draft|{"tiers": [], "min_xp": null, "last_visit_days": null}|wa,in_app|null` {
		t.Fatalf("stored %s", got)
	}

	status, body = e.call("POST", "/api/crm/campaigns", base(map[string]any{"scheduled_at": "2026-10-05T10:00:00.1234Z"}))
	expect(t, status, body, 200, "")
	if body["message"] != "Kampanye dijadwalkan" {
		t.Fatalf("scheduled %v", body)
	}
	if got := e.scalar(`SELECT status || ' ' || to_char(scheduled_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US') FROM crm.crm_campaigns WHERE id = $1`, data(body)["id"]); got != "scheduled 10:00:00.123000" {
		t.Fatalf("scheduled row %s", got)
	}

	status, body = e.call("GET", "/api/crm/campaigns", nil)
	expect(t, status, body, 200, "")
	var row map[string]any
	for _, it := range list(body) {
		if it.(map[string]any)["id"] == id {
			row = it.(map[string]any)
		}
	}
	if row == nil || row["pending_count"] != "0" || row["inapp_count"] != "0" || row["recipients_built"] != false || row["segment_name"] != nil {
		t.Fatalf("list row %v", row)
	}

	e.exec(`DELETE FROM crm.crm_settings WHERE key = 'default_branch_id'`)
	status, body = e.call("GET", "/api/crm/campaigns", nil)
	expect(t, status, body, 400, "Venue belum dikonfigurasi")
	status, body = e.call("POST", "/api/crm/campaigns", base(nil))
	expect(t, status, body, 400, "Venue belum dikonfigurasi")
}

func TestCampaignLifecycle(t *testing.T) {
	e := newEnv(t)
	company, branch := e.venue()
	ani := e.customer("Ani", phone(), 600, 70)
	optedPhone := phone()
	e.customer("Budi", optedPhone, 700, 80)
	e.customer("Cici", phone(), 10, 5)
	e.exec(`INSERT INTO crm.crm_marketing_optouts (company_id, branch_id, phone) VALUES ($1, $2, $3)`,
		company, branch, "62"+optedPhone[1:])
	segment := map[string]any{"tiers": []any{e.tier}, "min_xp": 100, "last_visit_days": 30}

	status, body := e.call("POST", "/api/crm/campaigns/preview", map[string]any{"segment": segment})
	expect(t, status, body, 200, "")
	prev := data(body)
	if prev["count"] != 1.0 || prev["optedOut"] != 1.0 || len(prev["sample"].([]any)) != 1 {
		t.Fatalf("preview %v", prev)
	}
	if s := prev["sample"].([]any)[0].(map[string]any); s["name"] != "Ani" || len(s) != 3 {
		t.Fatalf("sample %v", s)
	}
	status, body = e.call("POST", "/api/crm/campaigns/preview", map[string]any{"segment": segment, "segment_id": "nope"})
	expect(t, status, body, 400, "Format data tidak valid")
	status, _ = e.raw("POST", "/api/crm/campaigns/preview", "null")
	if status != 500 {
		t.Fatalf("null body %d", status)
	}

	status, body = e.call("POST", "/api/crm/campaigns", map[string]any{
		"name": "Win-back", "message_template": "Halo {nama}, kami kangen!", "segment": segment, "channels": []any{"wa", "in_app"}})
	expect(t, status, body, 200, "")
	id := data(body)["id"].(string)
	path := "/api/crm/campaigns/" + id

	status, body = e.call("PATCH", path, map[string]any{"name": "Win-back Oktober", "daily_cap": nil})
	expect(t, status, body, 200, "")
	if body["message"] != "Kampanye diperbarui" {
		t.Fatalf("edit %v", body)
	}
	status, body = e.call("PATCH", path, map[string]any{"action": "schedule"})
	expect(t, status, body, 400, "Waktu kirim tidak valid")
	status, body = e.call("PATCH", path, map[string]any{"action": "schedule", "scheduled_at": "2026-10-06T01:00:00Z"})
	expect(t, status, body, 200, "")
	if data(body)["scheduled_at"] != "2026-10-06T01:00:00.000Z" || body["message"] != "Kampanye dijadwalkan" {
		t.Fatalf("schedule %v", body)
	}

	status, body = e.call("PATCH", path, map[string]any{"action": "start"})
	expect(t, status, body, 200, "")
	if body["message"] != "Kampanye dimulai: 1 penerima baru, 1 notifikasi in-app terkirim. WA mengikuti master switch & jam kirim." {
		t.Fatalf("start %v", body)
	}
	started := data(body)
	if started["id"] != id || started["inserted"] != 1.0 || started["inApp"] != 1.0 || started["status"] != "sending" {
		t.Fatalf("start data %v", started)
	}
	if got := e.scalar(`SELECT customer_id::text || '|' || phone FROM crm.crm_campaign_recipients WHERE campaign_id = $1`, id); !strings.HasPrefix(got, ani+"|0812") {
		t.Fatalf("recipient %s", got)
	}
	if got := e.scalar(`SELECT title || '|' || body FROM crm.member_notifications WHERE campaign_id = $1`, id); got != "Win-back Oktober|Halo Ani, kami kangen!" {
		t.Fatalf("notification %s", got)
	}

	status, body = e.call("PATCH", path, map[string]any{"name": "Lagi"})
	expect(t, status, body, 409, "Hanya kampanye draft yang bisa diedit — jeda/batalkan dulu")
	status, body = e.call("PATCH", path, map[string]any{"action": "pause"})
	expect(t, status, body, 200, "")
	if body["message"] != "Kampanye dijeda" || e.scalar(`SELECT status FROM crm.crm_campaigns WHERE id = $1`, id) != "paused" {
		t.Fatalf("pause %v", body)
	}
	status, body = e.call("PATCH", path, map[string]any{"action": "resume"})
	expect(t, status, body, 200, "")
	status, body = e.call("PATCH", path, map[string]any{"action": "cancel"})
	expect(t, status, body, 200, "")
	if body["message"] != "Kampanye dibatalkan" {
		t.Fatalf("cancel %v", body)
	}
	status, body = e.call("PATCH", path, map[string]any{"action": "start"})
	expect(t, status, body, 409, "Status kampanye sudah berubah — muat ulang halaman")
	status, body = e.call("PATCH", path, map[string]any{"action": "fly"})
	expect(t, status, body, 400, "Validation failed")
	status, body = e.call("PATCH", "/api/crm/campaigns/8a3a46b7-53b9-4052-b168-000000000000", map[string]any{"action": "pause"})
	expect(t, status, body, 404, "Kampanye tidak ditemukan")

	e.exec(`UPDATE crm.crm_campaign_recipients SET status = 'sent' WHERE campaign_id = $1`, id)
	e.exec(`UPDATE crm.member_notifications SET opened_at = now() WHERE campaign_id = $1`, id)
	status, raw := e.raw("GET", path+"/report", nil)
	if status != 200 {
		t.Fatalf("report %d %s", status, raw)
	}
	var report struct {
		Data map[string]map[string]any `json:"data"`
	}
	_ = json.Unmarshal([]byte(raw), &report)
	if !strings.Contains(raw, `"campaign":{"id":"`+id+`","name":"Win-back Oktober","status":"cancelled","channels":["wa","in_app"],"scheduled_at":"2026-10-06T01:00:00.000Z","started_at":"`) {
		t.Fatalf("report campaign %s", raw)
	}
	if !strings.Contains(raw, `"funnel":{"total":1,"pending":0,"sent":1,"failed":0,"skipped":0,"redeemed":0,"redeemed_value":0},"in_app":{"sent":1,"opened":1,"clicked":0}`) {
		t.Fatalf("report funnel %s", raw)
	}
	status, body = e.call("GET", "/api/crm/campaigns/8a3a46b7-53b9-4052-b168-000000000000/report", nil)
	expect(t, status, body, 404, "Kampanye tidak ditemukan")
}

func TestCampaignBatchVouchersAndConversion(t *testing.T) {
	e := newEnv(t)
	company, branch := e.venue()
	e.customer("Ani", phone(), 600, 70)
	e.customer("Budi", phone(), 700, 80)
	promo := e.scalar(`INSERT INTO promo.promo_campaigns (company_id, branch_id, name, discount_type, value)
		VALUES ($1, $2, 'Go test promo', 'fixed', 10000) RETURNING id::text`, company, branch)
	segID := e.scalar(`INSERT INTO crm.crm_segments (name, source, definition) VALUES ('s', 'member', $1::jsonb) RETURNING id::text`,
		fmt.Sprintf(`{"filters":[{"field":"membership_tier","op":"eq","value":%q}],"rfm":{"enabled":true}}`, e.tier))

	status, body := e.call("POST", "/api/crm/campaigns", map[string]any{
		"name": "Voucher", "message_template": "Halo {nama}, kode {kode}", "segment": nil, "segment_id": segID,
		"promo_campaign_id": promo, "promo_mode": "batch", "voucher_prefix": " win ", "channels": []any{"in_app"}})
	expect(t, status, body, 200, "")
	id := data(body)["id"].(string)
	status, body = e.call("PATCH", "/api/crm/campaigns/"+id, map[string]any{"action": "start"})
	expect(t, status, body, 200, "")
	if body["message"] != "Kampanye selesai: 2 penerima baru, 2 notifikasi in-app terkirim." || data(body)["status"] != "done" {
		t.Fatalf("start %v", body)
	}
	if got := e.scalar(`SELECT string_agg(DISTINCT status || ':' || left(voucher_code, 4), ',') FROM crm.crm_campaign_recipients WHERE campaign_id = $1`, id); got != "skipped:WIN-" {
		t.Fatalf("recipients %s", got)
	}
	if got := e.scalar(`SELECT count(*)::text FROM promo.promo_codes WHERE campaign_id = $1 AND usage_limit = 1`, promo); got != "2" {
		t.Fatalf("codes %s", got)
	}
	if got := e.scalar(`SELECT body FROM crm.member_notifications WHERE campaign_id = $1 LIMIT 1`, id); !strings.Contains(got, ", kode WIN-") {
		t.Fatalf("in-app body %s", got)
	}
	e.exec(`INSERT INTO promo.promo_redemptions (company_id, branch_id, code_id, campaign_id, campaign_name, discount_type, value, context_type, context_id, discount_amount, status)
		SELECT $1, $2, k.id, $3, 'p', 'fixed', 10000, 'pos_order', gen_random_uuid(), 10000.50, 'captured'
		FROM promo.promo_codes k WHERE k.campaign_id = $3 LIMIT 1`, company, branch, promo)
	status, raw := e.raw("GET", "/api/crm/campaigns/"+id+"/report", nil)
	if status != 200 || !strings.Contains(raw, `"skipped":2,"redeemed":1,"redeemed_value":10000.5}`) {
		t.Fatalf("report %d %s", status, raw)
	}
}

func TestCampaignConfig(t *testing.T) {
	e := newEnv(t)
	e.exec(`DELETE FROM configuration.app_settings WHERE key = 'crm_campaign_config'`)
	status, raw := e.raw("GET", "/api/crm/campaign-config", nil)
	if status != 200 || raw != `{"success":true,"data":{"enabled":false,"daily_cap":150}}` {
		t.Fatalf("get %d %s", status, raw)
	}
	status, raw = e.raw("PUT", "/api/crm/campaign-config", map[string]any{"daily_cap": 300})
	if status != 200 || raw != `{"success":true,"data":{"enabled":false,"daily_cap":300},"message":"Konfigurasi tersimpan"}` {
		t.Fatalf("put %d %s", status, raw)
	}
	if got := e.scalar(`SELECT value FROM configuration.app_settings WHERE key = 'crm_campaign_config'`); got != `{"enabled":false,"daily_cap":300}` {
		t.Fatalf("stored %s", got)
	}
	status, body := e.call("PUT", "/api/crm/campaign-config", map[string]any{"enabled": "ya", "daily_cap": 0})
	expect(t, status, body, 400, "Validation failed")
	if len(body["details"].([]any)) != 2 {
		t.Fatalf("details %v", body["details"])
	}
	e.exec(`UPDATE configuration.app_settings SET value = 'not json' WHERE key = 'crm_campaign_config'`)
	status, body = e.call("GET", "/api/crm/campaign-config", nil)
	expect(t, status, body, 500, "Terjadi kesalahan server")
}

func TestCampaignOptouts(t *testing.T) {
	e := newEnv(t)
	e.venue()
	status, body := e.call("POST", "/api/crm/campaign-optouts", map[string]any{"phone": "abcdefgh"})
	expect(t, status, body, 400, "Nomor tidak valid")
	status, body = e.call("POST", "/api/crm/campaign-optouts", map[string]any{"phone": "0812"})
	expect(t, status, body, 400, "Validation failed")
	p := phone()
	status, body = e.call("POST", "/api/crm/campaign-optouts", map[string]any{"phone": p, "note": " minta berhenti "})
	expect(t, status, body, 200, "")
	if body["message"] != "Nomor masuk daftar opt-out" || len(data(body)) != 1 {
		t.Fatalf("add %v", body)
	}
	id := data(body)["id"].(string)
	status, body = e.call("POST", "/api/crm/campaign-optouts", map[string]any{"phone": p})
	if status != 200 || data(body)["id"] != id {
		t.Fatalf("re-add %d %v", status, body)
	}
	status, body = e.call("GET", "/api/crm/campaign-optouts", nil)
	expect(t, status, body, 200, "")
	first := list(body)[0].(map[string]any)
	if first["id"] != id || first["phone"] != "62"+p[1:] || first["note"] != "minta berhenti" || first["source"] != "manual" {
		t.Fatalf("list %v", first)
	}
	status, body = e.call("DELETE", "/api/crm/campaign-optouts?id=x", nil)
	expect(t, status, body, 400, "id tidak valid")
	status, body = e.call("DELETE", "/api/crm/campaign-optouts?id=8a3a46b7-53b9-4052-b168-7a5f0b71c356", nil)
	expect(t, status, body, 404, "Tidak ditemukan")
	status, raw := e.raw("DELETE", "/api/crm/campaign-optouts?id="+id, nil)
	if status != 200 || raw != `{"success":true,"data":{"id":"`+id+`"},"message":"Nomor dikeluarkan dari opt-out"}` {
		t.Fatalf("delete %d %s", status, raw)
	}
}

func TestForms(t *testing.T) {
	e := newEnv(t)
	slug := "go-" + e.tier[7:]
	field := map[string]any{"key": "pic_phone", "label": "HP", "type": "phone"}

	status, body := e.call("POST", "/api/crm/forms", map[string]any{"slug": slug, "name": "N", "title": "T",
		"fields": []any{map[string]any{"key": "city", "label": "", "type": "text"}}})
	expect(t, status, body, 400, "Validation failed")
	details := body["details"].([]any)
	if len(details) != 2 || details[1].(map[string]any)["code"] != "custom" || details[1].(map[string]any)["message"] != "Form wajib punya field pic_phone atau pic_email agar lead bisa dihubungi" {
		t.Fatalf("details %v", details)
	}
	status, body = e.call("POST", "/api/crm/forms", map[string]any{"slug": slug, "name": "N", "title": "T", "fields": []any{map[string]any{"key": "city", "type": "zz"}}})
	expect(t, status, body, 400, "Validation failed")
	if len(body["details"].([]any)) != 2 {
		t.Fatalf("type errors skip the refine: %v", body["details"])
	}

	status, raw := e.raw("POST", "/api/crm/forms", map[string]any{"slug": slug, "name": " Kontak B2B ", "title": "Hubungi kami",
		"fields": []any{field}, "redirect_url": " https://x.test/ok ", "notify_numbers": []any{" 08123456789 "}})
	if status != 201 || !strings.HasSuffix(raw, `"slug":"`+slug+`","name":"Kontak B2B"},"message":"Form dibuat"}`) {
		t.Fatalf("create %d %s", status, raw)
	}
	id := e.scalar(`SELECT id::text FROM crm.crm_forms WHERE slug = $1`, slug)
	if got := e.scalar(`SELECT fields::text || '|' || redirect_url || '|' || notify_numbers::text || '|' || submit_label FROM crm.crm_forms WHERE id = $1`, id); got != `[{"key": "pic_phone", "type": "phone", "label": "HP", "width": 2, "options": [], "required": false}]|https://x.test/ok|["08123456789"]|Kirim` {
		t.Fatalf("stored %s", got)
	}
	status, body = e.call("POST", "/api/crm/forms", map[string]any{"slug": slug, "name": "N", "title": "T", "fields": []any{field}})
	expect(t, status, body, 409, "Slug sudah dipakai form lain")

	e.exec(`UPDATE crm.crm_forms SET fields = '[]' WHERE id = $1`, id)
	status, raw = e.raw("GET", "/api/crm/forms", nil)
	if status != 200 || !strings.Contains(raw, `"fields":[{"key":"pic_name","label":"Nama Anda","type":"text","required":true,"placeholder":"cth. Budi Santoso","help_text":null,"options":[],"width":1}`) {
		t.Fatalf("list %d %s", status, raw)
	}

	company, branch := e.venue()
	lead := e.scalar(`INSERT INTO crm.crm_sales_leads (company_id, branch_id, org_name, pic_name, pic_phone)
		VALUES ($1, $2, 'PT Go', 'Budi', '0812') RETURNING id::text`, company, branch)
	e.exec(`INSERT INTO crm.crm_form_submissions (form_id, lead_id, utm, created_at) VALUES ($1, $2, '{"utm_source":"ig"}', now() - interval '1 minute')`, id, lead)
	e.exec(`INSERT INTO crm.crm_form_submissions (form_id, status, reason) VALUES ($1, 'rejected', 'honeypot')`, id)
	status, raw = e.raw("GET", "/api/crm/forms/"+id, nil)
	if status != 200 || !strings.Contains(raw, `"lead_id":null,"status":"rejected","reason":"honeypot","utm":{},"created_at":"`) ||
		!strings.Contains(raw, `"utm":{"utm_source":"ig"},"created_at":"`) || !strings.Contains(raw, `"org_name":"PT Go","pic_name":"Budi","pic_phone":"0812"}]`) ||
		!strings.Contains(raw, `"org_name":null,"pic_name":null,"pic_phone":null}`) {
		t.Fatalf("submissions %d %s", status, raw)
	}

	status, raw = e.raw("PATCH", "/api/crm/forms/"+id, map[string]any{"is_active": false, "slug": "renamed"})
	if status != 200 || raw != `{"success":true,"data":{"id":"`+id+`","slug":"`+slug+`","name":"Kontak B2B","is_active":false},"message":"Form diperbarui"}` {
		t.Fatalf("patch %d %s", status, raw)
	}
	if e.scalar(`SELECT submit_label || '|' || default_source FROM crm.crm_forms WHERE id = $1`, id) != "Kirim|lainnya" {
		t.Fatal("patch reset defaults")
	}
	status, body = e.call("PATCH", "/api/crm/forms/"+id, map[string]any{"slug": "x"})
	expect(t, status, body, 400, "Tidak ada field yang diubah")
	status, body = e.call("PATCH", "/api/crm/forms/"+id, map[string]any{"fields": []any{map[string]any{"key": "city", "label": "Kota", "type": "text"}}})
	expect(t, status, body, 200, "")

	status, raw = e.raw("DELETE", "/api/crm/forms/"+id, nil)
	if status != 204 || raw != "" {
		t.Fatalf("delete %d %s", status, raw)
	}
	status, body = e.call("GET", "/api/crm/forms/"+id, nil)
	expect(t, status, body, 404, "Form tidak ditemukan")

	main := e.scalar(`INSERT INTO crm.crm_forms (slug, name, title) VALUES ('kontak', 'Kontak', 'Kontak')
		ON CONFLICT (slug) DO UPDATE SET deleted_at = NULL RETURNING id::text`)
	status, body = e.call("DELETE", "/api/crm/forms/"+main, nil)
	expect(t, status, body, 409, "Form utama /public tidak bisa dihapus — nonaktifkan saja")
}
