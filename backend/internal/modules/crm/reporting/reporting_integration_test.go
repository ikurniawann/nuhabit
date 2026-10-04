package reporting

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

const (
	company = "8a3a46b7-53b9-4052-b168-7a5f0b71c356"
	branch  = "e3ca52e6-b4a7-47cc-b0c9-d2c68be76004"
)

type fakeWA struct {
	mu   sync.Mutex
	sent []string
}

func (f *fakeWA) Gateway(context.Context, database.Querier) TextSender {
	return func(_ context.Context, target, _ string) bool {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.sent = append(f.sent, target)
		return true
	}
}

type env struct {
	mux          *http.ServeMux
	tx           pgx.Tx
	admin, plain testutil.Staff
	other        testutil.Staff
	org          string
	wa           *fakeWA
}

func staff(t *testing.T, role string) testutil.Staff {
	c, b := company, branch
	all := []string{"read", "create", "update", "delete"}
	return testutil.CreateStaff(t, testutil.StaffOptions{Role: role, Menus: map[string][]string{"crm.reports": all},
		CompanyID: &c, BranchID: &b})
}

// setup creates staff before the transaction so the rollback runs before
// the staff cleanup.
func setup(t *testing.T) *env {
	t.Helper()
	e := &env{admin: staff(t, "admin"), plain: staff(t, "pos"), other: crmtest.Staff(t, "crm.settings"), wa: &fakeWA{}}
	e.tx = testutil.Tx(t)
	d := testutil.Deps(t, nil)
	e.mux = crmtest.Mux(newHandler(e.tx, d, Ports{WhatsApp: e.wa}).routes())
	e.org = "Go Report " + testutil.RandomHex(4)
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_sales_leads (company_id, branch_id, org_name, pic_name, pic_phone, score, status, owner_user_id)
		VALUES ($1, $2, $3, 'PIC', '0811', 7, 'baru', $4), ($1, $2, $3 || ' B', 'PIC', '0812', 3, 'baru', $5)`,
		company, branch, e.org, e.plain.UserID, e.admin.UserID)
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_sales_deals (company_id, branch_id, lead_id, title, stage_id, value_estimate, owner_user_id)
		SELECT $1, $2, l.id, 'Deal ' || l.org_name, (SELECT id FROM crm.crm_sales_stages WHERE code = 'prospek-baru'), 5000000, l.owner_user_id
		FROM crm.crm_sales_leads l WHERE l.org_name LIKE $3 || '%'`, company, branch, e.org)
	return e
}

func (e *env) call(t *testing.T, method, path string, body any, s *testutil.Staff) (int, map[string]any) {
	t.Helper()
	return crmtest.Call(t, e.mux, method, path, body, s)
}

func data(body map[string]any) map[string]any { return body["data"].(map[string]any) }

func TestAuthFailures(t *testing.T) {
	e := setup(t)
	for _, rt := range []struct{ method, path string }{
		{"GET", "/api/crm/report-builder"}, {"POST", "/api/crm/report-builder"}, {"GET", "/api/crm/report-builder/datasets"},
		{"POST", "/api/crm/report-builder/run"}, {"GET", "/api/crm/report-builder/x"}, {"PATCH", "/api/crm/report-builder/x"},
		{"DELETE", "/api/crm/report-builder/x"}, {"GET", "/api/crm/dashboards"}, {"POST", "/api/crm/dashboards"},
		{"GET", "/api/crm/dashboards/x"}, {"PATCH", "/api/crm/dashboards/x"}, {"DELETE", "/api/crm/dashboards/x"},
		{"GET", "/api/crm/report-schedules"}, {"POST", "/api/crm/report-schedules"}, {"PATCH", "/api/crm/report-schedules/x"},
		{"DELETE", "/api/crm/report-schedules/x"}, {"POST", "/api/crm/report-schedules/x"},
	} {
		if code, _ := e.call(t, rt.method, rt.path, map[string]any{}, nil); code != 401 {
			t.Fatalf("%s %s anon: %d", rt.method, rt.path, code)
		}
		if code, _ := e.call(t, rt.method, rt.path, map[string]any{}, &e.other); code != 403 {
			t.Fatalf("%s %s no grant: %d", rt.method, rt.path, code)
		}
	}
}

func TestDatasets(t *testing.T) {
	e := setup(t)
	code, body := e.call(t, "GET", "/api/crm/report-builder/datasets", nil, &e.admin)
	if code != 200 {
		t.Fatalf("%d %v", code, body)
	}
	d := data(body)
	ds := d["datasets"].([]any)
	lead := ds[0].(map[string]any)
	if len(ds) != 6 || lead["key"] != "lead" || lead["date_field"] != "created_at" {
		t.Fatal(lead)
	}
	f0 := lead["fields"].([]any)[0].(map[string]any)
	if f0["key"] != "org_name" || f0["options"] != nil || f0["aggregatable"] != false {
		t.Fatal(f0)
	}
	if len(d["filter_ops"].([]any)) != 12 || d["chart_types"].([]any)[0].(map[string]any)["label"] != "Tabel" {
		t.Fatal(d)
	}
}

func TestRunReport(t *testing.T) {
	e := setup(t)
	contains := []any{map[string]any{"field": "org_name", "op": "contains", "value": e.org}}
	code, body := e.call(t, "POST", "/api/crm/report-builder/run", map[string]any{"dataset": "lead", "filters": contains}, &e.admin)
	if code != 200 {
		t.Fatalf("%d %v", code, body)
	}
	res := data(body)
	rows := res["rows"].([]any)
	if res["row_count"] != 2.0 || res["truncated"] != false || res["grouped"] != false || len(rows) != 2 {
		t.Fatal(res)
	}
	if row := rows[0].(map[string]any); row["score"] == nil || row["owner_name"] == nil {
		t.Fatal(row)
	}

	// configuration.users has no "sales" role today, so the owner
	// restriction is covered by the domain tests; other roles see every row.
	_, body = e.call(t, "POST", "/api/crm/report-builder/run", map[string]any{"dataset": "lead", "filters": contains}, &e.plain)
	if data(body)["row_count"] != 2.0 {
		t.Fatal(body)
	}

	code, body = e.call(t, "POST", "/api/crm/report-builder/run", map[string]any{
		"dataset": "deal", "group_by": []any{"stage_name"},
		"aggregates": []any{map[string]any{"fn": "count"}, map[string]any{"fn": "sum", "field": "value"}},
		"filters":    []any{map[string]any{"field": "org_name", "op": "contains", "value": e.org}, map[string]any{"field": "value", "op": "gte", "value": "100"}},
	}, &e.admin)
	if code != 200 {
		t.Fatalf("%d %v", code, body)
	}
	res = data(body)
	row := res["rows"].([]any)[0].(map[string]any)
	if row["stage_name"] != "Prospek Baru" || row["count"] != "2" || row["sum_value"] != "10000000.00" {
		t.Fatal(row)
	}
	if col := res["columns"].([]any)[2].(map[string]any); col["label"] != "Total Nilai Deal" || col["type"] != "currency" || col["isAggregate"] != true {
		t.Fatal(col)
	}

	// Date presets, array and boolean parameters travel as untyped literals.
	code, body = e.call(t, "POST", "/api/crm/report-builder/run", map[string]any{
		"dataset": "deal", "date_preset": "this_year",
		"filters": append([]any{
			map[string]any{"field": "lead_source", "op": "in", "value": []any{"wa", nil}},
			map[string]any{"field": "is_won", "op": "eq", "value": false},
			map[string]any{"field": "pax_estimate", "op": "is_empty"},
		}, contains...),
	}, &e.admin)
	if code != 200 || data(body)["row_count"] != 0.0 {
		t.Fatal(code, body)
	}
	code, body = e.call(t, "POST", "/api/crm/report-builder/run", map[string]any{
		"dataset": "deal", "date_preset": "this_year",
		"filters": append([]any{map[string]any{"field": "is_won", "op": "eq", "value": false}}, contains...),
	}, &e.admin)
	if code != 200 || data(body)["row_count"] != 2.0 {
		t.Fatal(code, body)
	}

	// not_in binds its list as one array parameter.
	for _, c := range []struct {
		stages []any
		want   float64
	}{{[]any{"Prospek Baru"}, 0}, {[]any{"Tahap Lain", ""}, 2}} {
		code, body = e.call(t, "POST", "/api/crm/report-builder/run", map[string]any{
			"dataset": "deal",
			"filters": append([]any{map[string]any{"field": "stage_name", "op": "not_in", "value": c.stages}}, contains...),
		}, &e.admin)
		if code != 200 || data(body)["row_count"] != c.want {
			t.Fatal(c.stages, code, body)
		}
	}

	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, testutil.AsStaff(testutil.Request("POST", "/api/crm/report-builder/run",
		map[string]any{"dataset": "deal", "columns": []any{"title", "value"}, "filters": contains}), e.admin))
	if !strings.Contains(rec.Body.String(), `"rows":[{"title":"Deal `) || !strings.Contains(rec.Body.String(), `"value":"5000000.00"`) {
		t.Fatal(rec.Body.String())
	}

	code, body = e.call(t, "POST", "/api/crm/report-builder/run", map[string]any{"dataset": "pegawai"}, &e.admin)
	if code != 400 || body["error"] != "Validation failed" {
		t.Fatal(code, body)
	}
	if code, _ = e.call(t, "POST", "/api/crm/report-builder/run", map[string]any{"dataset": "lead", "limit": 99999}, &e.admin); code != 400 {
		t.Fatal(code)
	}
	if code, _ = e.call(t, "POST", "/api/crm/report-builder/run", "{bad", &e.admin); code != 500 {
		t.Fatalf("malformed body: %d", code)
	}
}

func createReport(t *testing.T, e *env, s *testutil.Staff, name string, shared bool) string {
	t.Helper()
	code, body := e.call(t, "POST", "/api/crm/report-builder", map[string]any{
		"name": name, "is_shared": shared,
		"definition": map[string]any{"dataset": "lead", "filters": []any{map[string]any{"field": "org_name", "op": "contains", "value": e.org}}},
	}, s)
	if code != 201 || body["message"] != "Report disimpan" {
		t.Fatalf("create: %d %v", code, body)
	}
	return data(body)["id"].(string)
}

func TestSavedReports(t *testing.T) {
	e := setup(t)
	id := createReport(t, e, &e.admin, "Lead Go", true)
	privID := createReport(t, e, &e.admin, "Lead Privat", false)

	// A non-admin asking for a shared report gets a private one.
	code, body := e.call(t, "POST", "/api/crm/report-builder", map[string]any{"name": "Sales", "definition": map[string]any{"dataset": "deal"}}, &e.plain)
	if code != 201 || data(body)["is_shared"] != false || data(body)["dataset"] != "deal" {
		t.Fatal(code, body)
	}

	_, body = e.call(t, "GET", "/api/crm/report-builder?dataset=lead", nil, &e.plain)
	found := false
	for _, r := range body["data"].([]any) {
		row := r.(map[string]any)
		if row["id"] == privID {
			t.Fatal("private report of another user is listed")
		}
		if row["id"] == id {
			found = row["active_schedules"] == "0" && row["creator_name"] != nil
		}
	}
	if !found {
		t.Fatal(body)
	}

	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, testutil.AsStaff(testutil.Request("GET", "/api/crm/report-builder/"+id+"?meta=1", nil), e.admin))
	want := `"definition":{"dataset":"lead","columns":[],"filters":[{"field":"org_name","op":"contains","value":"` + e.org +
		`"}],"date_preset":"all_time","group_by":[],"date_bucket":"month","aggregates":[],"sort_dir":"desc","limit":500,"chart_type":"table"},"is_shared":true`
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), want) || strings.Contains(rec.Body.String(), `"result"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	code, body = e.call(t, "GET", "/api/crm/report-builder/"+id, nil, &e.admin)
	if code != 200 || data(body)["result"].(map[string]any)["row_count"] != 2.0 {
		t.Fatal(code, body)
	}
	if code, body = e.call(t, "GET", "/api/crm/report-builder/"+privID, nil, &e.plain); code != 404 || body["error"] != "Report tidak ditemukan" {
		t.Fatal(code, body)
	}

	if code, body = e.call(t, "PATCH", "/api/crm/report-builder/"+id, map[string]any{"name": "x"}, &e.plain); code != 403 ||
		body["error"] != "Hanya pembuat atau admin yang bisa mengubah report ini" {
		t.Fatal(code, body)
	}
	if code, body = e.call(t, "PATCH", "/api/crm/report-builder/"+id, map[string]any{}, &e.admin); code != 400 || body["error"] != "Tidak ada field yang diubah" {
		t.Fatal(code, body)
	}
	code, body = e.call(t, "PATCH", "/api/crm/report-builder/"+id, map[string]any{"name": " Baru ", "definition": map[string]any{"dataset": "deal"}}, &e.admin)
	if code != 200 || body["message"] != "Report diperbarui" || data(body)["name"] != "Baru" || data(body)["dataset"] != "deal" {
		t.Fatal(code, body)
	}
	if d := crmtest.Scalar[string](t, e.tx, `SELECT definition->>'limit' FROM crm.crm_reports WHERE id = $1`, id); d != "500" {
		t.Fatal(d)
	}

	if code, _ = e.call(t, "DELETE", "/api/crm/report-builder/"+id, nil, &e.plain); code != 403 {
		t.Fatal(code)
	}
	if code, _ = e.call(t, "DELETE", "/api/crm/report-builder/"+id, nil, &e.admin); code != 204 {
		t.Fatal(code)
	}
	if code, _ = e.call(t, "GET", "/api/crm/report-builder/"+id, nil, &e.admin); code != 404 {
		t.Fatal(code)
	}
	// Last: the 22P02 aborts the test transaction.
	if code, body = e.call(t, "GET", "/api/crm/report-builder/abc", nil, &e.admin); code != 400 || body["error"] != "Format data tidak valid" {
		t.Fatal(code, body)
	}
}

func TestDashboards(t *testing.T) {
	e := setup(t)
	reportID := createReport(t, e, &e.admin, "Widget Report", true)
	privID := createReport(t, e, &e.admin, "Widget Privat", false)

	code, body := e.call(t, "POST", "/api/crm/dashboards", map[string]any{"name": "Overview Go", "is_default": true}, &e.admin)
	if code != 201 || body["message"] != "Dashboard dibuat" || data(body)["is_default"] != true {
		t.Fatal(code, body)
	}
	id := data(body)["id"].(string)
	if code, body = e.call(t, "POST", "/api/crm/dashboards", map[string]any{"name": ""}, &e.admin); code != 400 || body["error"] != "Validation failed" {
		t.Fatal(code, body)
	}

	_, body = e.call(t, "GET", "/api/crm/dashboards", nil, &e.admin)
	if first := body["data"].([]any)[0].(map[string]any); first["id"] != id || first["widget_count"] != "0" {
		t.Fatal(first)
	}

	widgets := []any{map[string]any{"report_id": reportID, "width": 2}, map[string]any{"report_id": reportID, "title": "KPI", "widget_type": "kpi"}}
	code, body = e.call(t, "PATCH", "/api/crm/dashboards/"+id, map[string]any{"name": "Overview 2", "widgets": widgets}, &e.admin)
	if code != 200 || body["message"] != "Dashboard diperbarui" || data(body)["id"] != id {
		t.Fatal(code, body)
	}
	code, body = e.call(t, "GET", "/api/crm/dashboards/"+id, nil, &e.admin)
	if code != 200 || data(body)["dashboard"].(map[string]any)["name"] != "Overview 2" {
		t.Fatal(code, body)
	}
	ws := data(body)["widgets"].([]any)
	w0, w1 := ws[0].(map[string]any), ws[1].(map[string]any)
	if len(ws) != 2 || w0["title"] != "Widget Report" || w0["width"] != 2.0 || w1["title"] != "KPI" || w1["sort_order"] != 1.0 {
		t.Fatal(ws)
	}
	if w0["result"].(map[string]any)["row_count"] != 2.0 || w0["definition"].(map[string]any)["dataset"] != "lead" {
		t.Fatal(w0)
	}

	// The non-admin sees the dashboard but not the admin's private report.
	if code, body = e.call(t, "PATCH", "/api/crm/dashboards/"+id, map[string]any{"is_default": false}, &e.plain); code != 403 ||
		body["error"] != "Hanya admin yang bisa menetapkan dashboard Overview" {
		t.Fatal(code, body)
	}
	if code, body = e.call(t, "PATCH", "/api/crm/dashboards/"+id, map[string]any{"widgets": []any{map[string]any{"report_id": privID}}}, &e.plain); code != 400 ||
		body["error"] != "Ada report yang tidak bisa diakses" {
		t.Fatal(code, body)
	}
	if code, body = e.call(t, "DELETE", "/api/crm/dashboards/"+id, nil, &e.plain); code != 403 ||
		body["error"] != "Hanya pembuat atau admin yang bisa menghapus dashboard ini" {
		t.Fatal(code, body)
	}
	if code, _ = e.call(t, "DELETE", "/api/crm/dashboards/"+id, nil, &e.admin); code != 204 {
		t.Fatal(code)
	}
	if code, body = e.call(t, "GET", "/api/crm/dashboards/"+id, nil, &e.admin); code != 404 || body["error"] != "Dashboard tidak ditemukan" {
		t.Fatal(code, body)
	}
}

func TestSchedules(t *testing.T) {
	e := setup(t)
	reportID := createReport(t, e, &e.admin, "Jadwal Report", true)
	user := map[string]any{"type": "user", "user_id": e.admin.UserID}

	if code, body := e.call(t, "POST", "/api/crm/report-schedules", map[string]any{}, &e.plain); code != 403 ||
		body["error"] != "Hanya admin yang bisa membuat laporan terjadwal" {
		t.Fatal(code, body)
	}
	code, body := e.call(t, "POST", "/api/crm/report-schedules", map[string]any{"report_id": reportID, "name": "Rekap", "recipients": []any{user}}, &e.admin)
	issue := body["details"].([]any)[0].(map[string]any)
	if code != 400 || issue["message"] != "Jadwal mingguan wajib memilih hari" || issue["code"] != "custom" {
		t.Fatal(code, body)
	}
	_, body = e.call(t, "POST", "/api/crm/report-schedules", map[string]any{"report_id": reportID, "name": "Rekap", "frequency": "daily",
		"recipients": []any{map[string]any{"type": "fax"}, map[string]any{"type": "number", "number": "123"}}}, &e.admin)
	details := body["details"].([]any)
	if u := details[0].(map[string]any); u["code"] != "invalid_union" || len(u["errors"].([]any)) != 2 {
		t.Fatal(details)
	}
	if n := details[1].(map[string]any); n["code"] != "too_small" || len(n["path"].([]any)) != 3 {
		t.Fatal(details)
	}
	if code, body = e.call(t, "POST", "/api/crm/report-schedules", map[string]any{"report_id": "11111111-1111-4111-8111-111111111111",
		"name": "Rekap", "frequency": "daily", "recipients": []any{user}}, &e.admin); code != 404 || body["error"] != "Report tidak ditemukan" {
		t.Fatal(code, body)
	}

	code, body = e.call(t, "POST", "/api/crm/report-schedules", map[string]any{"report_id": reportID, "name": "Rekap", "frequency": "weekly",
		"day_of_week": 1, "channel": "in_app", "recipients": []any{user}}, &e.admin)
	if code != 201 || body["message"] != "Jadwal dibuat" || data(body)["next_run_at"] == nil || data(body)["frequency"] != "weekly" {
		t.Fatal(code, body)
	}
	id := data(body)["id"].(string)

	_, body = e.call(t, "GET", "/api/crm/report-schedules", nil, &e.admin)
	found := false
	for _, r := range body["data"].([]any) {
		row := r.(map[string]any)
		if row["id"] == id {
			found = row["report_name"] == "Jadwal Report" && row["hour"] == 8.0 && row["recipients"].([]any)[0].(map[string]any)["type"] == "user"
		}
	}
	if !found {
		t.Fatal(body)
	}

	if code, body = e.call(t, "PATCH", "/api/crm/report-schedules/"+id, map[string]any{"name": "x"}, &e.plain); code != 403 ||
		body["error"] != "Hanya admin yang bisa mengubah jadwal" {
		t.Fatal(code, body)
	}
	if code, body = e.call(t, "PATCH", "/api/crm/report-schedules/"+id, map[string]any{}, &e.admin); code != 400 || body["error"] != "Tidak ada field yang diubah" {
		t.Fatal(code, body)
	}
	code, body = e.call(t, "PATCH", "/api/crm/report-schedules/"+id, map[string]any{"is_active": false}, &e.admin)
	if code != 200 || body["message"] != "Jadwal diperbarui" || data(body)["next_run_at"] != nil || data(body)["is_active"] != false {
		t.Fatal(code, body)
	}

	code, body = e.call(t, "POST", "/api/crm/report-schedules/"+id, nil, &e.admin)
	if code != 200 || body["message"] != "Terkirim ke 1 penerima" {
		t.Fatal(code, body)
	}
	if d := data(body); d["ok"] != true || d["sent"] != 1.0 || d["rowCount"] != 2.0 {
		t.Fatal(d)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*)::int FROM public.notifications WHERE user_id = $1 AND title = 'Laporan: Jadwal Report'`, e.admin.UserID); n != 1 {
		t.Fatal(n)
	}
	if s := crmtest.Scalar[string](t, e.tx, `SELECT last_status FROM crm.crm_report_schedules WHERE id = $1`, id); s != "ok" {
		t.Fatal(s)
	}

	// WhatsApp: typed numbers go through the gateway too.
	code, _ = e.call(t, "PATCH", "/api/crm/report-schedules/"+id, map[string]any{"channel": "wa",
		"recipients": []any{user, map[string]any{"type": "number", "number": "0812-3456-7890"}}}, &e.admin)
	if code != 200 {
		t.Fatal(code)
	}
	_, body = e.call(t, "POST", "/api/crm/report-schedules/"+id, nil, &e.admin)
	if data(body)["sent"] != 2.0 || len(e.wa.sent) != 1 || e.wa.sent[0] != "6281234567890" {
		t.Fatal(body, e.wa.sent)
	}

	if code, _ = e.call(t, "DELETE", "/api/crm/report-schedules/"+id, nil, &e.admin); code != 204 {
		t.Fatal(code)
	}
	if code, body = e.call(t, "PATCH", "/api/crm/report-schedules/"+id, map[string]any{"name": "x"}, &e.admin); code != 404 || body["error"] != "Jadwal tidak ditemukan" {
		t.Fatal(code, body)
	}
}
