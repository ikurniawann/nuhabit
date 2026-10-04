package advance

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

// fakeWhatsApp points the workflow at a test gateway.
type fakeWhatsApp struct{ gw *Gateway }

func (f fakeWhatsApp) LoadGateway(context.Context, database.Querier) *Gateway { return f.gw }

// fakeEmployees gives every user the same phone.
type fakeEmployees struct{ phone string }

func (f fakeEmployees) Phone(context.Context, database.Querier, string) (*string, error) {
	return &f.phone, nil
}

// recorder captures the requests an httptest server receives.
type recorder struct {
	mu   sync.Mutex
	reqs []*http.Request
	body [][]byte
}

func (rec *recorder) server(t *testing.T, status int) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		rec.mu.Lock()
		rec.reqs, rec.body = append(rec.reqs, r), append(rec.body, b)
		rec.mu.Unlock()
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func (rec *recorder) count() int {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	return len(rec.reqs)
}

var fixedNow = time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC) // 10:00 WIB

type env struct {
	t     *testing.T
	tx    pgx.Tx
	mux   *http.ServeMux
	wa    *recorder
	venue struct{ company, branch string }
}

func setup(t *testing.T) *env {
	t.Helper()
	tx := testutil.Tx(t)
	d := testutil.Deps(t, func() time.Time { return fixedNow })
	e := &env{t: t, tx: tx, wa: &recorder{}}
	gw := &Gateway{BaseURL: e.wa.server(t, 200).URL, Token: "tok", Timeout: 5 * time.Second}
	h := newHandler(tx, d, Ports{WhatsApp: fakeWhatsApp{gw}, Employees: fakeEmployees{"0812-3456-7890"}})
	e.mux = crmtest.Mux(h.routes())
	ctx := context.Background()
	if err := tx.QueryRow(ctx, `SELECT company_id::text, id::text FROM configuration.branches ORDER BY created_at LIMIT 1`).
		Scan(&e.venue.company, &e.venue.branch); err != nil {
		t.Skipf("no branch fixture: %v", err)
	}
	return e
}

// staff and createStaff create committed staff and roll the test
// transaction back before their cleanup deletes them: rows the transaction
// wrote reference the users, so deleting them first would wait forever.
func (e *env) staff(menus ...string) testutil.Staff {
	e.t.Helper()
	s := crmtest.Staff(e.t, menus...)
	e.t.Cleanup(func() { _ = e.tx.Rollback(context.Background()) })
	return s
}

func (e *env) createStaff(opts testutil.StaffOptions) testutil.Staff {
	e.t.Helper()
	s := testutil.CreateStaff(e.t, opts)
	e.t.Cleanup(func() { _ = e.tx.Rollback(context.Background()) })
	return s
}

// call serves one request inside a savepoint, rolled back when the request
// fails (on the pool every statement stands alone; in the test transaction
// a failed statement would abort everything after it).
func (e *env) call(method, path string, body any, s *testutil.Staff) (int, map[string]any) {
	e.t.Helper()
	crmtest.MustExec(e.t, e.tx, `SAVEPOINT request`)
	code, out := crmtest.Call(e.t, e.mux, method, path, body, s)
	if code >= 400 {
		crmtest.MustExec(e.t, e.tx, `ROLLBACK TO SAVEPOINT request`)
	} else {
		crmtest.MustExec(e.t, e.tx, `RELEASE SAVEPOINT request`)
	}
	return code, out
}

func (e *env) expect(method, path string, body any, s *testutil.Staff, status int, msg string) map[string]any {
	e.t.Helper()
	code, out := e.call(method, path, body, s)
	if code != status {
		e.t.Fatalf("%s %s = %d %v, want %d", method, path, code, out, status)
	}
	if msg != "" {
		got, _ := out["message"].(string)
		if status >= 400 {
			got, _ = out["error"].(string)
		}
		if got != msg {
			e.t.Fatalf("%s %s message = %q, want %q (%v)", method, path, got, msg, out)
		}
	}
	return out
}

// firstRowKeys returns the keys of data[0] in wire order.
func (e *env) firstRowKeys(path string, s *testutil.Staff) []string {
	e.t.Helper()
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, testutil.AsStaff(testutil.Request("GET", path, nil), *s))
	var body struct{ Data []json.RawMessage }
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Data) == 0 {
		e.t.Fatalf("no rows: %s", rec.Body.String())
	}
	dec := json.NewDecoder(bytes.NewReader(body.Data[0]))
	_, _ = dec.Token()
	keys := []string{}
	for dec.More() {
		k, _ := dec.Token()
		keys = append(keys, k.(string))
		var skip json.RawMessage
		_ = dec.Decode(&skip)
	}
	return keys
}

func dataOf(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	d, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("no data object: %v", body)
	}
	return d
}

func listOf(t *testing.T, body map[string]any) []any {
	t.Helper()
	d, ok := body["data"].([]any)
	if !ok {
		t.Fatalf("no data list: %v", body)
	}
	return d
}

func firstIssue(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	details, _ := body["details"].([]any)
	if len(details) == 0 {
		t.Fatalf("no issues: %v", body)
	}
	return details[0].(map[string]any)
}

func TestGuards(t *testing.T) {
	e := setup(t)
	pos := e.staff("pos")
	for _, path := range []string{"/api/crm/approval-rules", "/api/crm/workflow-rules", "/api/crm/scoring-rules", "/api/crm/custom-fields", "/api/crm/approvals"} {
		e.expect("GET", path, nil, nil, 401, "Authentication required")
		e.expect("GET", path, nil, &pos, 403, "Insufficient permissions")
	}
	e.expect("POST", "/api/crm/scoring/recalculate", nil, &pos, 403, "Insufficient permissions")
	e.expect("POST", "/api/crm/approvals/"+testutil.RandomHex(4)+"/decide", map[string]any{"decision": "approve"}, nil, 401, "Authentication required")
}

func TestApprovalRules(t *testing.T) {
	e := setup(t)
	admin := e.staff("crm.settings")

	out := e.expect("POST", "/api/crm/approval-rules", map[string]any{"name": "x", "level": 1, "min_discount_percent": 10}, &admin, 400, "Validation failed")
	if is := firstIssue(t, out); is["code"] != "custom" || is["message"] != "Pilih role atau user approver" {
		t.Fatalf("refine issue = %v", is)
	}
	out = e.expect("POST", "/api/crm/approval-rules", map[string]any{"name": "x", "level": 1.5, "min_discount_percent": 10}, &admin, 400, "Validation failed")
	if len(out["details"].([]any)) != 1 {
		t.Fatalf("a type error skips the refine: %v", out["details"])
	}
	out = e.expect("POST", "/api/crm/approval-rules",
		map[string]any{"name": " Diskon besar ", "level": 2, "min_discount_percent": 20.5, "approver_role": "super_admin"}, &admin, 201, "Aturan approval dibuat")
	rule := dataOf(t, out)
	if rule["name"] != "Diskon besar" || rule["level"] != float64(2) || rule["min_discount_percent"] != "20.50" {
		t.Fatalf("created = %v", rule)
	}
	id := rule["id"].(string)

	list := listOf(t, e.expect("GET", "/api/crm/approval-rules", nil, &admin, 200, ""))
	found := false
	for _, r := range list {
		if r.(map[string]any)["id"] == id {
			found = true
		}
	}
	if !found {
		t.Fatal("list misses the new rule")
	}

	patched := dataOf(t, e.expect("PATCH", "/api/crm/approval-rules/"+id, map[string]any{"is_active": false}, &admin, 200, "Aturan diperbarui"))
	if patched["is_active"] != false || patched["level"] != float64(2) || patched["min_discount_percent"] != "20.50" {
		t.Fatalf("patch must not reset other fields: %v", patched)
	}
	e.expect("PATCH", "/api/crm/approval-rules/"+id, map[string]any{}, &admin, 400, "Tidak ada field yang diubah")
	// Clearing the role trips the table's approver check (23514).
	e.expect("PATCH", "/api/crm/approval-rules/"+id, map[string]any{"approver_role": " "}, &admin, 400, "Data tidak memenuhi ketentuan")
	e.expect("PATCH", "/api/crm/approval-rules/bad-id", map[string]any{"is_active": true}, &admin, 400, "Format data tidak valid")
	e.expect("PATCH", "/api/crm/approval-rules/00000000-0000-4000-8000-000000000000", map[string]any{}, &admin, 404, "Aturan tidak ditemukan")

	code, _ := e.call("DELETE", "/api/crm/approval-rules/"+id, nil, &admin)
	if code != 204 {
		t.Fatalf("delete = %d", code)
	}
	e.expect("DELETE", "/api/crm/approval-rules/"+id, nil, &admin, 404, "Aturan tidak ditemukan")
}

func TestRuleAccessIsPerCompany(t *testing.T) {
	e := setup(t)
	scoped := e.createStaff(testutil.StaffOptions{Role: "admin", CompanyID: &e.venue.company,
		Menus: map[string][]string{"crm.settings": {"read", "create", "update", "delete"}}})
	other := crmtest.Scalar[string](t, e.tx, `INSERT INTO configuration.companies (holding_id, name, code)
		SELECT holding_id, 'Other Co', 'OTH-'||$1 FROM configuration.companies WHERE id = $2 RETURNING id::text`, testutil.RandomHex(3), e.venue.company)
	foreign := crmtest.Scalar[string](t, e.tx, `INSERT INTO crm.crm_scoring_rules (company_id, name, kind, event_type, points)
		VALUES ($1, 'Foreign', 'event', 'wa_inbound', 5) RETURNING id::text`, other)
	e.expect("PATCH", "/api/crm/scoring-rules/"+foreign, map[string]any{"points": 5}, &scoped, 404, "Aturan tidak ditemukan")
	for _, r := range listOf(t, e.expect("GET", "/api/crm/scoring-rules", nil, &scoped, 200, "")) {
		if r.(map[string]any)["id"] == foreign {
			t.Fatal("another company's rule is listed")
		}
	}
	// Rules a scoped admin creates belong to the company.
	created := dataOf(t, e.expect("POST", "/api/crm/scoring-rules", map[string]any{"name": "Mine", "kind": "event", "event_type": "deal_created", "points": 5}, &scoped, 201, ""))
	if c := crmtest.Scalar[*string](t, e.tx, `SELECT company_id::text FROM crm.crm_scoring_rules WHERE id = $1`, created["id"]); c == nil || *c != e.venue.company {
		t.Fatalf("company = %v", c)
	}
}

func TestScoringRules(t *testing.T) {
	e := setup(t)
	admin := e.staff("crm.settings")

	out := e.expect("POST", "/api/crm/scoring-rules", map[string]any{"name": "x", "kind": "field", "field": "source", "points": 5}, &admin, 400, "Validation failed")
	if firstIssue(t, out)["message"] != "Aturan field wajib punya field dan operator" {
		t.Fatalf("issues = %v", out["details"])
	}
	out = e.expect("POST", "/api/crm/scoring-rules", map[string]any{"name": "x", "kind": "event", "points": 5}, &admin, 400, "Validation failed")
	if firstIssue(t, out)["message"] != "Aturan event wajib punya event_type" {
		t.Fatalf("issues = %v", out["details"])
	}
	rule := dataOf(t, e.expect("POST", "/api/crm/scoring-rules",
		map[string]any{"name": "Sumber WA", "kind": "field", "field": "source", "operator": "in", "value": []any{"wa", 1.0}, "points": 10, "sort_order": 3, "max_count": 2},
		&admin, 201, "Aturan scoring dibuat"))
	keys := []string{}
	for k := range rule {
		keys = append(keys, k)
	}
	if len(keys) != 5 || rule["kind"] != "field" || rule["points"] != float64(10) || rule["is_active"] != true {
		t.Fatalf("created = %v", rule)
	}
	id := rule["id"].(string)
	if v := crmtest.Scalar[string](t, e.tx, `SELECT value::text FROM crm.crm_scoring_rules WHERE id = $1`, id); v != `["wa", 1]` {
		t.Fatalf("stored value = %s", v)
	}

	patched := e.expect("PATCH", "/api/crm/scoring-rules/"+id, map[string]any{"is_active": false}, &admin, 200, "Aturan diperbarui")
	raw, _ := json.Marshal(patched)
	if string(raw) != `{"data":{"id":"`+id+`","is_active":false,"name":"Sumber WA","points":10},"message":"Aturan diperbarui","success":true}` {
		t.Fatalf("patch body = %s", raw)
	}
	var sortOrder, maxCount int
	if err := e.tx.QueryRow(context.Background(), `SELECT sort_order, max_count FROM crm.crm_scoring_rules WHERE id = $1`, id).Scan(&sortOrder, &maxCount); err != nil || sortOrder != 3 || maxCount != 2 {
		t.Fatalf("PATCH reset defaults: sort_order=%d max_count=%d %v", sortOrder, maxCount, err)
	}
	e.expect("PATCH", "/api/crm/scoring-rules/"+id, map[string]any{"value": nil}, &admin, 200, "")
	if v := crmtest.Scalar[string](t, e.tx, `SELECT jsonb_typeof(value) FROM crm.crm_scoring_rules WHERE id = $1`, id); v != "null" {
		t.Fatalf("value null is stored as JSON null, got %s", v)
	}
	e.expect("PATCH", "/api/crm/scoring-rules/"+id, map[string]any{"points": 500}, &admin, 400, "Validation failed")
	code, _ := e.call("DELETE", "/api/crm/scoring-rules/"+id, nil, &admin)
	if code != 204 {
		t.Fatalf("delete = %d", code)
	}
}

func TestCustomFields(t *testing.T) {
	e := setup(t)
	admin := e.staff("crm.settings")
	key := "f" + testutil.RandomHex(4)

	out := e.expect("POST", "/api/crm/custom-fields", map[string]any{"object": "lead", "key": "Budget", "label": "B", "field_type": "text"}, &admin, 400, "Validation failed")
	if is := firstIssue(t, out); is["message"] != "key: huruf kecil, angka, underscore; diawali huruf" || is["code"] != "invalid_format" {
		t.Fatalf("issue = %v", is)
	}
	out = e.expect("POST", "/api/crm/custom-fields", map[string]any{"object": "lead", "key": key, "label": "S", "field_type": "picklist"}, &admin, 400, "Validation failed")
	if firstIssue(t, out)["message"] != "Picklist wajib punya minimal satu pilihan" {
		t.Fatalf("issues = %v", out["details"])
	}
	field := dataOf(t, e.expect("POST", "/api/crm/custom-fields",
		map[string]any{"object": "lead", "key": " " + key + " ", "label": "Segmen", "field_type": "picklist", "options": []any{" A "},
			"validation": map[string]any{"min": 1.0, "extra": true}, "sort_order": 4}, &admin, 201, "Custom field dibuat"))
	if field["key"] != key || field["field_type"] != "picklist" {
		t.Fatalf("created = %v", field)
	}
	id := field["id"].(string)
	if v := crmtest.Scalar[string](t, e.tx, `SELECT options::text || validation::text FROM crm.crm_custom_fields WHERE id = $1`, id); v != `["A"]{"min": 1}` {
		t.Fatalf("stored = %s", v)
	}
	e.expect("POST", "/api/crm/custom-fields", map[string]any{"object": "lead", "key": key, "label": "Dup", "field_type": "text"}, &admin, 409, "Key sudah dipakai untuk objek ini")

	list := listOf(t, e.expect("GET", "/api/crm/custom-fields?object=lead", nil, &admin, 200, ""))
	for _, r := range list {
		if r.(map[string]any)["object"] != "lead" {
			t.Fatalf("object filter leaked %v", r)
		}
	}
	patched := dataOf(t, e.expect("PATCH", "/api/crm/custom-fields/"+id, map[string]any{"key": "zzz", "label": "Segmen Baru"}, &admin, 200, "Custom field diperbarui"))
	if patched["key"] != key || patched["label"] != "Segmen Baru" {
		t.Fatalf("key must not change: %v", patched)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT sort_order FROM crm.crm_custom_fields WHERE id = $1`, id); n != 4 {
		t.Fatalf("PATCH reset sort_order to %d", n)
	}
	e.expect("PATCH", "/api/crm/custom-fields/"+id, map[string]any{"key": "zzz"}, &admin, 400, "Tidak ada field yang diubah")
	code, _ := e.call("DELETE", "/api/crm/custom-fields/"+id, nil, &admin)
	if code != 204 {
		t.Fatalf("delete = %d", code)
	}
}

func TestWorkflowRules(t *testing.T) {
	e := setup(t)
	admin := e.staff("crm.settings")
	act := []any{map[string]any{"type": "notify_in_app", "title": "t", "message": "m"}}

	out := e.expect("POST", "/api/crm/workflow-rules", map[string]any{"name": "r", "object": "lead", "trigger_type": "inactive_days", "actions": act}, &admin, 400, "Validation failed")
	if firstIssue(t, out)["message"] != "Trigger 'tidak ada aktivitas' butuh jumlah hari" {
		t.Fatalf("issues = %v", out["details"])
	}
	out = e.expect("POST", "/api/crm/workflow-rules", map[string]any{"name": "r", "object": "lead", "trigger_type": "created",
		"actions": []any{map[string]any{"type": "bogus"}}}, &admin, 400, "Validation failed")
	if is := firstIssue(t, out); is["code"] != "invalid_union" || len(is["path"].([]any)) != 3 {
		t.Fatalf("union issue = %v", is)
	}
	out = e.expect("POST", "/api/crm/workflow-rules", map[string]any{"name": "r", "object": "lead", "trigger_type": "created",
		"actions": []any{map[string]any{"type": "update_field", "field": "owner_user_id", "value": "x"}}}, &admin, 400, "Validation failed")
	if firstIssue(t, out)["message"] != "Field pada aksi update_field tidak diizinkan untuk objek ini" {
		t.Fatalf("issues = %v", out["details"])
	}
	out = e.expect("POST", "/api/crm/workflow-rules", map[string]any{"name": "r", "object": "lead", "trigger_type": "created", "actions": []any{}}, &admin, 400, "Validation failed")
	if firstIssue(t, out)["message"] != "Too small: expected array to have >=1 items" {
		t.Fatalf("issues = %v", out["details"])
	}

	created := dataOf(t, e.expect("POST", "/api/crm/workflow-rules", map[string]any{
		"name": "Lead baru", "object": "lead", "trigger_type": "created", "trigger_config": map[string]any{"days": 3, "extra": 1},
		"conditions": []any{map[string]any{"field": "source", "op": "eq", "value": "wa"}},
		"actions":    []any{map[string]any{"type": "wait", "days": 1.0}, map[string]any{"type": "create_task", "title": "Hubungi"}},
	}, &admin, 201, "Workflow rule dibuat"))
	id := created["id"].(string)
	if created["object"] != "lead" || created["trigger_type"] != "created" || created["is_active"] != true {
		t.Fatalf("created = %v", created)
	}
	stored := crmtest.Scalar[string](t, e.tx, `SELECT trigger_config::text || actions::text FROM crm.crm_workflow_rules WHERE id = $1`, id)
	if stored != `{"days": 3}[{"days": 1, "type": "wait", "hours": 0}, {"type": "create_task", "title": "Hubungi", "priority": "normal", "assign_to": "owner", "due_in_days": 1, "activity_type": "tugas"}]` {
		t.Fatalf("stored = %s", stored)
	}

	got := dataOf(t, e.expect("GET", "/api/crm/workflow-rules/"+id, nil, &admin, 200, ""))
	if got["run_count"] != float64(0) || got["conditions"].([]any)[0].(map[string]any)["value"] != "wa" {
		t.Fatalf("get = %v", got)
	}
	if len(listOf(t, e.expect("GET", "/api/crm/workflow-rules", nil, &admin, 200, ""))) == 0 {
		t.Fatal("empty list")
	}

	toggled := e.expect("PATCH", "/api/crm/workflow-rules/"+id, map[string]any{"is_active": false}, &admin, 200, "Rule dinonaktifkan")
	if d := dataOf(t, toggled); len(d) != 2 || d["is_active"] != false {
		t.Fatalf("toggle = %v", d)
	}
	e.expect("PATCH", "/api/crm/workflow-rules/"+id, map[string]any{"is_active": "yes"}, &admin, 400, "Validation failed")
	replaced := dataOf(t, e.expect("PATCH", "/api/crm/workflow-rules/"+id, map[string]any{
		"name": "Lead baru 2", "object": "deal", "trigger_type": "stage_changed", "actions": act,
	}, &admin, 200, "Workflow rule diperbarui"))
	if replaced["name"] != "Lead baru 2" || replaced["object"] != "deal" || replaced["is_active"] != true {
		t.Fatalf("replace = %v", replaced)
	}
	runs := dataOf(t, e.expect("GET", "/api/crm/workflow-rules/"+id+"/runs", nil, &admin, 200, ""))
	if len(runs["runs"].([]any)) != 0 || len(runs["scheduled"].([]any)) != 0 {
		t.Fatalf("runs = %v", runs)
	}
	e.expect("GET", "/api/crm/workflow-rules/00000000-0000-4000-8000-000000000000", nil, &admin, 404, "Rule tidak ditemukan")
	code, _ := e.call("DELETE", "/api/crm/workflow-rules/"+id, nil, &admin)
	if code != 204 {
		t.Fatalf("delete = %d", code)
	}
}

// salesFixture inserts a lead, deal and quotation of the test venue.
func (e *env) salesFixture(owner string) (lead, deal, quote string) {
	e.t.Helper()
	tag := testutil.RandomHex(3)
	crmtest.MustExec(e.t, e.tx, `UPDATE crm.crm_scoring_rules SET is_active = false`) // only the test's rules score
	lead = crmtest.Scalar[string](e.t, e.tx, `INSERT INTO crm.crm_sales_leads (company_id, branch_id, org_name, pic_name, pic_phone, source, owner_user_id)
		VALUES ($1, $2, 'PT Kopi '||$3, 'Ani', '081234567890', 'wa', $4) RETURNING id::text`, e.venue.company, e.venue.branch, tag, owner)
	deal = crmtest.Scalar[string](e.t, e.tx, `INSERT INTO crm.crm_sales_deals (company_id, branch_id, lead_id, title, stage_id)
		VALUES ($1, $2, $3, 'Gathering', (SELECT id FROM crm.crm_sales_stages ORDER BY sort_order LIMIT 1)) RETURNING id::text`, e.venue.company, e.venue.branch, lead)
	quote = crmtest.Scalar[string](e.t, e.tx, `INSERT INTO crm.crm_sales_quotations (company_id, branch_id, deal_id, quote_number, subtotal, total, discount_percent, approval_status)
		VALUES ($1, $2, $3, 'Q-'||$4, 1000000, 750000, 25, 'pending') RETURNING id::text`, e.venue.company, e.venue.branch, deal, tag)
	return lead, deal, quote
}

// approvalRequest opens a request on quote: level 1 by role admin, level 2
// by the named user.
func (e *env) approvalRequest(quote, requester, level2User string) string {
	e.t.Helper()
	id := crmtest.Scalar[string](e.t, e.tx, `INSERT INTO crm.crm_approval_requests (company_id, branch_id, subject_id, requested_by, discount_percent, amount)
		VALUES ($1, $2, $3, $4, 25, 750000) RETURNING id::text`, e.venue.company, e.venue.branch, quote, requester)
	crmtest.MustExec(e.t, e.tx, `INSERT INTO crm.crm_approval_steps (request_id, level, approver_role, approver_user_id)
		VALUES ($1, 1, 'admin', NULL), ($1, 2, NULL, $2)`, id, level2User)
	crmtest.MustExec(e.t, e.tx, `UPDATE crm.crm_sales_quotations SET approval_request_id = $2 WHERE id = $1`, quote, id)
	return id
}

func TestApprovalDecisionRunsWorkflowAndScoring(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	salesMenu := map[string][]string{"sales-funnel": {"read", "create", "update"}}
	requester := e.createStaff(testutil.StaffOptions{Role: "pos", Menus: salesMenu})
	approver1 := e.createStaff(testutil.StaffOptions{Role: "admin", Menus: salesMenu})
	approver2 := e.createStaff(testutil.StaffOptions{Role: "pos", Menus: salesMenu})
	lead, _, quote := e.salesFixture(requester.UserID)
	reqID := e.approvalRequest(quote, requester.UserID, approver2.UserID)

	hooks := &recorder{}
	hookURL := hooks.server(t, 202).URL + "/hook"
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_workflow_rules (company_id, name, object, trigger_type, run_once_per_record, actions)
		VALUES ($1, 'Approval berubah', 'quotation', 'status_changed', false, $2::jsonb)`, e.venue.company,
		`[{"type":"notify_in_app","to":"user","user_id":"`+requester.UserID+`","title":"{{quotation.quote_number}} {{event.approval}}","message":"Total {{quotation.total}} untuk {{lead.org_name}}"},
		  {"type":"webhook","url":"`+hookURL+`","secret":"rahasia"}]`)
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_scoring_rules (company_id, name, kind, field, operator, value, points)
		VALUES ($1, 'Sumber WA', 'field', 'source', 'eq', '"WA"', 10)`, e.venue.company)
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_workflow_rules (company_id, name, object, trigger_type, trigger_config, actions)
		VALUES ($1, 'Lead hangat', 'lead', 'score_reached', '{"score": 10}', $2::jsonb)`, e.venue.company,
		`[{"type":"update_field","field":"temperature","value":"panas"},
		  {"type":"create_task","title":"Follow up {{lead.org_name}} ({{lead.temperature}})","activity_type":"telepon","due_in_days":2,"priority":"high","assign_to":"creator"},
		  {"type":"wait","days":0,"hours":3},
		  {"type":"notify_in_app","to":"owner","title":"later","message":"later"}]`)

	path := "/api/crm/approvals/" + reqID + "/decide"
	e.expect("POST", path, map[string]any{"decision": "maybe"}, &approver1, 400, "Validation failed")
	e.expect("POST", path, map[string]any{"decision": "approve"}, &approver2, 403, "Anda bukan approver tingkat ini")
	e.expect("POST", "/api/crm/approvals/bad/decide", map[string]any{"decision": "approve"}, &approver1, 400, "Format data tidak valid")
	e.expect("POST", "/api/crm/approvals/00000000-0000-4000-8000-000000000000/decide", map[string]any{"decision": "approve"}, &approver1, 404, "Permintaan approval tidak ditemukan")

	inbox := listOf(t, e.expect("GET", "/api/crm/approvals", nil, &approver1, 200, ""))
	var mine map[string]any
	for _, r := range inbox {
		if row := r.(map[string]any); row["id"] == reqID {
			mine = row
		}
	}
	if mine == nil || mine["can_decide"] != true || mine["discount_percent"] != "25.00" || mine["quotation_status"] != "draft" ||
		mine["org_name"] == nil || len(mine["steps"].([]any)) != 2 || mine["requested_by_name"] != requester.FullName {
		t.Fatalf("inbox row = %v", mine)
	}
	keys := e.firstRowKeys("/api/crm/approvals", &approver1)
	if len(keys) != 21 || keys[9] != "quote_number" || keys[20] != "can_decide" {
		t.Fatalf("inbox keys = %v", keys)
	}
	for _, r := range listOf(t, e.expect("GET", "/api/crm/approvals", nil, &approver2, 200, "")) {
		if r.(map[string]any)["id"] == reqID {
			t.Fatal("level 1 is not waiting on approver2")
		}
	}

	out := e.expect("POST", path, map[string]any{"decision": "approve", "comment": " oke "}, &approver1, 200, "Disetujui tingkat ini — lanjut ke tingkat 2")
	if d := dataOf(t, out); d["ok"] != true || d["status"] != "pending" || d["next_level"] != float64(2) {
		t.Fatalf("level 1 = %v", d)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*) FROM public.notifications WHERE user_id = $1 AND title LIKE 'Approval diskon 25% — Q-%' AND link = $2`,
		approver2.UserID, "/dashboard/sales-funnel/approvals?request="+reqID); n != 1 {
		t.Fatalf("approver notifications = %d", n)
	}
	if e.wa.count() != 1 || e.wa.reqs[0].Header.Get("x-gateway-token") != "tok" {
		t.Fatalf("WA sends = %d", e.wa.count())
	}

	out = e.expect("POST", path, map[string]any{"decision": "approve"}, &approver2, 200, "Disetujui — quotation boleh dikirim")
	if d := dataOf(t, out); d["status"] != "approved" || d["next_level"] != nil {
		t.Fatalf("level 2 = %v", d)
	}
	e.expect("POST", path, map[string]any{"decision": "reject"}, &approver2, 409, "Permintaan sudah diputuskan")

	if s := crmtest.Scalar[string](t, e.tx, `SELECT approval_status FROM crm.crm_sales_quotations WHERE id = $1`, quote); s != "approved" {
		t.Fatalf("quotation approval_status = %s", s)
	}
	if c := crmtest.Scalar[string](t, e.tx, `SELECT comment FROM crm.crm_approval_steps WHERE request_id = $1 AND level = 1`, reqID); c != "oke" {
		t.Fatalf("comment = %q", c)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*) FROM public.notifications WHERE user_id = $1 AND title LIKE 'Diskon Q-% DISETUJUI' AND message = 'Quotation boleh dikirim'`, requester.UserID); n != 1 {
		t.Fatalf("requester notifications = %d", n)
	}

	// Two decisions, two quotation.status_changed events, two workflow runs.
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*) FROM crm.crm_events WHERE subject_id = $1 AND event_type = 'quotation.status_changed'`, quote); n != 2 {
		t.Fatalf("quotation events = %d", n)
	}
	var status string
	var results []byte
	if err := e.tx.QueryRow(ctx, `SELECT r.status, r.actions_result::text FROM crm.crm_workflow_runs r JOIN crm.crm_workflow_rules w ON w.id = r.rule_id
		WHERE w.name = 'Approval berubah' AND r.subject_id = $1 ORDER BY r.created_at DESC LIMIT 1`, quote).Scan(&status, &results); err != nil || status != "success" {
		t.Fatalf("run = %s %s %v", status, results, err)
	}
	title := crmtest.Scalar[string](t, e.tx, `SELECT title || ' / ' || message FROM public.notifications WHERE user_id = $1 AND title LIKE '%approved' LIMIT 1`, requester.UserID)
	if !strings.HasPrefix(title, "Q-") || !strings.Contains(title, " approved / Total 750000.00 untuk PT Kopi ") {
		t.Fatalf("rendered = %q", title)
	}
	if hooks.count() != 2 {
		t.Fatalf("webhooks = %d", hooks.count())
	}
	mac := hmac.New(sha256.New, []byte("rahasia"))
	mac.Write(hooks.body[0])
	sig := hex.EncodeToString(mac.Sum(nil))
	if hooks.reqs[0].Header.Get("X-NuHabit-Signature") != sig || hooks.reqs[0].Header.Get("X-BCDCoffee-Signature") != sig {
		t.Fatal("webhook signature")
	}
	var hook struct {
		RuleID      string         `json:"rule_id"`
		SubjectType string         `json:"subject_type"`
		Record      map[string]any `json:"record"`
		SentAt      string         `json:"sent_at"`
	}
	if err := json.Unmarshal(hooks.body[0], &hook); err != nil || hook.SubjectType != "quotation" || hook.Record["total"] != "750000.00" || hook.SentAt != "2026-10-04T03:00:00.000Z" {
		t.Fatalf("hook body = %s", hooks.body[0])
	}

	// The first event scored the lead 10 points, which crossed the
	// score_reached bar once: field update, task, then a queued action.
	if s := crmtest.Scalar[int](t, e.tx, `SELECT score FROM crm.crm_sales_leads WHERE id = $1`, lead); s != 10 {
		t.Fatalf("lead score = %d", s)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*) FROM crm.crm_events WHERE subject_id = $1 AND event_type = 'lead.score_changed'`, lead); n != 1 {
		t.Fatalf("score events = %d", n)
	}
	if temp := crmtest.Scalar[string](t, e.tx, `SELECT temperature FROM crm.crm_sales_leads WHERE id = $1`, lead); temp != "panas" {
		t.Fatalf("temperature = %s", temp)
	}
	var taskTitle, owner string
	var due time.Time
	if err := e.tx.QueryRow(ctx, `SELECT title, owner_user_id::text, due_at FROM crm.crm_sales_activities WHERE lead_id = $1`, lead).Scan(&taskTitle, &owner, &due); err != nil {
		t.Fatal(err)
	}
	if taskTitle[:9] != "Follow up" || taskTitle[len(taskTitle)-7:] != "(panas)" || owner != approver1.UserID ||
		!due.Equal(time.Date(2026, 10, 6, 2, 0, 0, 0, time.UTC)) {
		t.Fatalf("task = %q %s %s", taskTitle, owner, due)
	}
	var runAt time.Time
	if err := e.tx.QueryRow(ctx, `SELECT run_at FROM crm.crm_scheduled_actions s JOIN crm.crm_workflow_rules w ON w.id = s.rule_id WHERE w.name = 'Lead hangat' AND s.subject_id = $1`, lead).Scan(&runAt); err != nil ||
		!runAt.Equal(fixedNow.Add(3*time.Hour)) {
		t.Fatalf("scheduled run_at = %s %v", runAt, err)
	}
	if s := crmtest.Scalar[string](t, e.tx, `SELECT r.status FROM crm.crm_workflow_runs r JOIN crm.crm_workflow_rules w ON w.id = r.rule_id WHERE w.name = 'Lead hangat'`); s != "scheduled" {
		t.Fatalf("lead run = %s", s)
	}
}

func TestApprovalReject(t *testing.T) {
	e := setup(t)
	salesMenu := map[string][]string{"sales-funnel": {"read"}}
	requester := e.createStaff(testutil.StaffOptions{Role: "pos", Menus: salesMenu})
	approver := e.createStaff(testutil.StaffOptions{Role: "super_admin", Menus: salesMenu})
	_, _, quote := e.salesFixture(requester.UserID)
	reqID := e.approvalRequest(quote, requester.UserID, approver.UserID)

	out := e.expect("POST", "/api/crm/approvals/"+reqID+"/decide", map[string]any{"decision": "reject", "comment": "terlalu besar"}, &approver, 200, "Ditolak")
	if d := dataOf(t, out); d["status"] != "rejected" || d["next_level"] != nil {
		t.Fatalf("reject = %v", d)
	}
	if s := crmtest.Scalar[string](t, e.tx, `SELECT approval_status FROM crm.crm_sales_quotations WHERE id = $1`, quote); s != "rejected" {
		t.Fatalf("approval_status = %s", s)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*) FROM public.notifications WHERE user_id = $1 AND title LIKE '%DITOLAK' AND message = 'terlalu besar'`, requester.UserID); n != 1 {
		t.Fatalf("requester notifications = %d", n)
	}
	// The requester sees their own request in the mine view.
	found := false
	for _, r := range listOf(t, e.expect("GET", "/api/crm/approvals?status=all", nil, &requester, 200, "")) {
		if row := r.(map[string]any); row["id"] == reqID && row["can_decide"] == false && row["status"] == "rejected" {
			found = true
		}
	}
	if !found {
		t.Fatal("requester inbox misses the request")
	}
}

func TestRecalculateScores(t *testing.T) {
	e := setup(t)
	admin := e.staff("crm.settings")
	lead, _, _ := e.salesFixture(admin.UserID)
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_scoring_rules (company_id, name, kind, event_type, points, max_count)
		VALUES ($1, 'Deal', 'event', 'deal_created', 15, 3)`, e.venue.company)
	out := e.expect("POST", "/api/crm/scoring/recalculate", nil, &admin, 200, "")
	d := dataOf(t, out)
	if d["total"].(float64) < 1 || d["changed"].(float64) < 1 {
		t.Fatalf("recalc = %v", out)
	}
	var score int
	var breakdown string
	if err := e.tx.QueryRow(context.Background(), `SELECT score, score_breakdown::text FROM crm.crm_sales_leads WHERE id = $1`, lead).Scan(&score, &breakdown); err != nil || score != 15 {
		t.Fatalf("score = %d %s %v", score, breakdown, err)
	}
	if breakdown[:2] != `[{` || !json.Valid([]byte(breakdown)) {
		t.Fatalf("breakdown = %s", breakdown)
	}
}

func TestUpdateFieldCoercesTextLikeNodePostgres(t *testing.T) {
	e := setup(t)
	_, deal, _ := e.salesFixture(e.staff("crm.settings").UserID)
	ctx := context.Background()
	s := SalesFunnelSQL{}
	for field, v := range map[string]string{"pax_estimate": "12", "is_event_date_fixed": "true"} {
		if err := s.UpdateField(ctx, e.tx, "deal", deal, field, &v); err != nil {
			t.Fatalf("%s: %v", field, err)
		}
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT pax_estimate FROM crm.crm_sales_deals WHERE id = $1 AND is_event_date_fixed`, deal); n != 12 {
		t.Fatalf("pax = %d", n)
	}
}
