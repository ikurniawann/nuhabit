package salesfunnel_test

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/salesfunnel"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Integration tests run every write in one rolled-back transaction; staff
// sessions are committed by testutil and removed on cleanup.

type env struct {
	t         *testing.T
	ctx       context.Context
	tx        pgx.Tx
	mux       *http.ServeMux
	companyID string
	branchID  string
	waSent    []map[string]string
	replica   func() *http.ServeMux // a second API process on the same database
}

type stubGateway struct{ g *whatsapp.Gateway }

func (s stubGateway) LoadGateway(context.Context, database.Querier) *whatsapp.Gateway { return s.g }

func newEnv(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, nil)
	e := &env{t: t, ctx: context.Background()}
	e.tx = testutil.Tx(t)
	if err := e.tx.QueryRow(e.ctx, `SELECT b.company_id::text, b.id::text FROM configuration.branches b ORDER BY b.created_at LIMIT 1`).
		Scan(&e.companyID, &e.branchID); err != nil {
		t.Skipf("no branch fixture: %v", err)
	}
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		e.waSent = append(e.waSent, body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"messageId":"wamid-1"}`))
	}))
	t.Cleanup(gw.Close)
	ports := app.SalesFunnelPorts(deps)
	ports.Gateway = stubGateway{g: &whatsapp.Gateway{BaseURL: gw.URL, Token: "t", Timeout: 5 * time.Second}}
	e.replica = func() *http.ServeMux { return testutil.Mux(salesfunnel.NewOn(deps, e.tx, ports)) }
	e.mux = e.replica()
	return e
}

// staff creates a user of the venue company holding the menu grants.
func (e *env) staff(role string, menus ...string) testutil.Staff {
	m := map[string][]string{}
	for _, code := range menus {
		m[code] = []string{"read", "create", "update", "delete"}
	}
	company := e.companyID
	s := testutil.CreateStaff(e.t, testutil.StaffOptions{Role: role, Menus: m, CompanyID: &company})
	// Cleanups run last-in first-out: roll the fixtures back before the
	// staff rows they reference are deleted.
	e.t.Cleanup(func() { _ = e.tx.Rollback(context.Background()) })
	return s
}

// seller is a venue user with the sales-funnel menu. The local schema's
// users_role_check has no "sales" role yet, so admins stand in; the
// sales-only rules are covered by the domain tests.
func (e *env) seller() testutil.Staff { return e.staff("admin", "sales-funnel") }

type resp struct {
	Status int
	Body   map[string]any
	Raw    string
	Header http.Header
}

func (r resp) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }
func (r resp) list() []any          { l, _ := r.Body["data"].([]any); return l }

func (e *env) do(s *testutil.Staff, method, target string, body any) resp {
	e.t.Helper()
	return e.send(s, testutil.Request(method, target, body))
}

// send serves req as s (anonymous when nil); a failed request rolls back.
func (e *env) send(s *testutil.Staff, req *http.Request) resp {
	e.t.Helper()
	if s != nil {
		req = testutil.AsStaff(req, *s)
	}
	e.exec(`SAVEPOINT request`)
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	if rec.Code >= 400 {
		e.exec(`ROLLBACK TO SAVEPOINT request`)
	}
	e.exec(`RELEASE SAVEPOINT request`)
	var parsed map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
	return resp{Status: rec.Code, Body: parsed, Raw: rec.Body.String(), Header: rec.Header()}
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.tx.Exec(e.ctx, sql, args...); err != nil {
		e.t.Fatalf("exec %q: %v", sql, err)
	}
}

func (e *env) scalar(sql string, args ...any) any {
	e.t.Helper()
	var v any
	if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(&v); err != nil {
		e.t.Fatalf("scalar %q: %v", sql, err)
	}
	return v
}

func (e *env) expect(r resp, status int, msg string) {
	e.t.Helper()
	if r.Status != status {
		e.t.Fatalf("status %d, want %d: %s", r.Status, status, r.Raw)
	}
	if msg == "" {
		return
	}
	got, _ := r.Body["message"].(string)
	if status >= 400 {
		got, _ = r.Body["error"].(string)
	}
	if got != msg {
		e.t.Fatalf("message %q, want %q (%s)", got, msg, r.Raw)
	}
}

// events counts the outbox events of a topic keyed on key.
func (e *env) events(topic, key string) int {
	e.t.Helper()
	n, _ := e.scalar(`SELECT count(*)::int FROM platform.outbox_events WHERE topic = $1 AND key = $2`, topic, key).(int32)
	return int(n)
}

// localPhone returns a unique 0812… number.
func localPhone() string { return fmt.Sprintf("0812%08d", rand.IntN(100_000_000)) }

// lead creates a lead through the API and returns its id.
func (e *env) lead(s testutil.Staff, org string) (string, string) {
	e.t.Helper()
	p := localPhone()
	r := e.do(&s, "POST", "/api/sales-funnel/leads", map[string]any{"org_name": org, "pic_name": "Budi", "pic_phone": p})
	e.expect(r, 201, "Lead berhasil dibuat")
	return r.data()["id"].(string), "62" + p[1:]
}

// deal creates a deal on the default pipeline for a new lead.
func (e *env) deal(s testutil.Staff) (dealID, leadID string) {
	e.t.Helper()
	leadID, _ = e.lead(s, "PT Deal "+testutil.RandomHex(3))
	r := e.do(&s, "POST", "/api/sales-funnel/deals", map[string]any{"lead_id": leadID, "title": "Gathering"})
	e.expect(r, 201, "")
	return r.data()["id"].(string), leadID
}
