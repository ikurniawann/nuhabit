package reports

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/testutil"
)

func setup(t *testing.T) (*http.ServeMux, testutil.Staff) {
	t.Helper()
	tx := testutil.Tx(t)
	d := testutil.Deps(t, nil)
	crmtest.MustExec(t, tx, `INSERT INTO crm.wa_conversations (phone, channel, external_id, status, is_complaint, category, csat_score, first_response_seconds)
		VALUES ('+6299911', 'whatsapp', '+6299911', 'resolved', true, 'layanan', 4, 125)`)
	return crmtest.Mux(newHandler(tx, d, Ports{}).routes()), crmtest.Staff(t, "crm.reports")
}

func TestLoyaltyReport(t *testing.T) {
	mux, staff := setup(t)
	if code, _ := crmtest.Call(t, mux, "GET", "/api/crm/reports", nil, nil); code != 401 {
		t.Fatalf("anon: %d", code)
	}
	other := crmtest.Staff(t, "crm.settings")
	if code, _ := crmtest.Call(t, mux, "GET", "/api/crm/reports", nil, &other); code != 403 {
		t.Fatalf("no grant: %d", code)
	}
	code, body := crmtest.Call(t, mux, "GET", "/api/crm/reports?from=2026-07-10&to=2026-07-01", nil, &staff)
	if code != 400 || body["error"] != "Periode tidak valid (format YYYY-MM-DD, from <= to, maksimal 366 hari)" {
		t.Fatalf("bad period: %d %v", code, body)
	}
	code, body = crmtest.Call(t, mux, "GET", "/api/crm/reports?from=2026-01-01&to=2026-10-04", nil, &staff)
	if code != 200 {
		t.Fatalf("report: %d %v", code, body)
	}
	data := body["data"].(map[string]any)
	if p := data["period"].(map[string]any); p["from"] != "2026-01-01" || p["to"] != "2026-10-04" {
		t.Fatalf("period: %v", p)
	}
	rec := data["reconciliation"].(map[string]any)
	for _, k := range []string{"venues", "totals", "outstanding_balance", "untagged_topup_amount", "untagged_topup_count"} {
		if _, ok := rec[k]; !ok {
			t.Fatalf("reconciliation.%s missing: %v", k, rec)
		}
	}
	for _, s := range data["topSpenders"].([]any) {
		if s.(map[string]any)["last_order_at"] != nil {
			t.Fatal("last_order_at stays null for parity")
		}
	}
}

func TestCSReport(t *testing.T) {
	mux, staff := setup(t)
	code, body := crmtest.Call(t, mux, "GET", "/api/crm/reports/cs", nil, &staff)
	if code != 200 {
		t.Fatalf("cs: %d %v", code, body)
	}
	data := body["data"].(map[string]any)
	sum := data["summary"].(map[string]any)
	if sum["total_conversations"].(float64) < 1 || sum["total_complaints"].(float64) < 1 {
		t.Fatalf("summary: %v", sum)
	}
	if p := data["period"].(map[string]any); len(p["from"].(string)) != 24 {
		t.Fatalf("period uses ISO: %v", p)
	}
	daily := data["daily"].([]any)
	if len(daily) == 0 || len(daily[0].(map[string]any)["tanggal"].(string)) != 24 {
		t.Fatalf("daily: %v", daily)
	}
	cats := data["categories"].([]any)
	found := false
	for _, c := range cats {
		if c.(map[string]any)["category"] == "layanan" {
			found = true
		}
	}
	if !found {
		t.Fatalf("categories: %v", cats)
	}
	if _, ok := data["reviews"].(map[string]any)["avg_rating"]; !ok {
		t.Fatalf("reviews: %v", data["reviews"])
	}
}
