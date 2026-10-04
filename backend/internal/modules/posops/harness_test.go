package posops_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/posops"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run every route on one transaction that is rolled back,
// so fixtures and writes leave nothing behind. Staff come from testutil and
// are removed after the rollback.

type harness struct {
	t     *testing.T
	ctx   context.Context
	deps  module.Deps
	tx    pgx.Tx
	mux   http.Handler
	staff testutil.Staff
	wa    *fakeWhatsApp
}

type fakeWhatsApp struct {
	mu   sync.Mutex
	sent []sentText
	fail map[string]string // phone -> reason
}

type sentText struct{ target, message, by string }

func (f *fakeWhatsApp) SendText(_ context.Context, target, message, by string) posops.Delivery {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, sentText{target, message, by})
	if reason, bad := f.fail[target]; bad {
		return posops.Delivery{Reason: reason}
	}
	return posops.Delivery{Delivered: true}
}

func newHarness(t *testing.T, menus map[string][]string) *harness {
	t.Helper()
	deps := testutil.Deps(t, nil)
	if menus == nil {
		menus = map[string][]string{"pos.operations": nil}
	}
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Menus: menus})
	tx := testutil.Tx(t)
	ports := app.PosOpsPorts(deps)
	wa := &fakeWhatsApp{fail: map[string]string{}}
	ports.WhatsApp = wa
	return &harness{
		t: t, ctx: context.Background(), deps: deps, tx: tx,
		mux: testutil.Mux(posops.NewOn(tx, deps, ports)), staff: staff, wa: wa,
	}
}

func (h *harness) exec(sql string, args ...any) {
	h.t.Helper()
	if _, err := h.tx.Exec(h.ctx, sql, args...); err != nil {
		h.t.Fatalf("exec %q: %v", sql, err)
	}
}

func (h *harness) scalar(dst any, sql string, args ...any) {
	h.t.Helper()
	if err := h.tx.QueryRow(h.ctx, sql, args...).Scan(dst); err != nil {
		h.t.Fatalf("query %q: %v", sql, err)
	}
}

func (h *harness) id(sql string, args ...any) string {
	h.t.Helper()
	var id string
	h.scalar(&id, sql, args...)
	return id
}

type response struct {
	status int
	raw    string
	body   map[string]any
}

// call serves a request as the harness staff (anonymous when anon is set)
// and checks the status.
func (h *harness) call(method, path string, body any, status int) response {
	h.t.Helper()
	return h.do(testutil.AsStaff(testutil.Request(method, path, body), h.staff), status)
}

func (h *harness) anon(method, path string, body any, status int) response {
	h.t.Helper()
	return h.do(testutil.Request(method, path, body), status)
}

// do serves r inside a savepoint: a request whose SQL failed (as it would
// on its own pooled connection) does not abort the shared transaction.
func (h *harness) do(r *http.Request, status int) response {
	h.t.Helper()
	h.exec("SAVEPOINT request")
	rec, out := testutil.Do(h.t, h.mux, r)
	if _, err := h.tx.Exec(h.ctx, "RELEASE SAVEPOINT request"); err != nil {
		h.exec("ROLLBACK TO SAVEPOINT request")
	}
	if rec.Code != status {
		h.t.Fatalf("%s %s: status %d, want %d: %s", r.Method, r.URL, rec.Code, status, rec.Body.String())
	}
	return response{status: rec.Code, raw: rec.Body.String(), body: out}
}

// jsonEq fails unless got (any JSON-able value) equals the JSON want.
func jsonEq(t *testing.T, got any, want string) {
	t.Helper()
	gb, _ := json.Marshal(got)
	var g, w any
	_ = json.Unmarshal(gb, &g)
	if err := json.Unmarshal([]byte(want), &w); err != nil {
		t.Fatalf("bad want JSON: %v", err)
	}
	gs, _ := json.Marshal(g)
	ws, _ := json.Marshal(w)
	if string(gs) != string(ws) {
		t.Fatalf("got  %s\nwant %s", gs, ws)
	}
}

// keysInOrder fails unless the raw JSON object at the start of raw lists
// keys in this order.
func keysInOrder(t *testing.T, raw string, keys ...string) {
	t.Helper()
	pos := 0
	for _, k := range keys {
		i := strings.Index(raw[pos:], `"`+k+`":`)
		if i < 0 {
			t.Fatalf("key %q missing or out of order in %s", k, raw)
		}
		pos += i + len(k)
	}
}

func data(r response) map[string]any {
	m, _ := r.body["data"].(map[string]any)
	return m
}

func list(v any) []any {
	l, _ := v.([]any)
	return l
}

func obj(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
