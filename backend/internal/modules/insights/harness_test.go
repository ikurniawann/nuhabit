package insights

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run against TEST_DATABASE_URL. Dashboard tests run in
// one rolled-back transaction with a savepoint per request; assistant and
// executive tests run on the pool (their fail-safe reads would abort a
// transaction, and the TS runs them concurrently) and clean up after
// themselves.

// clock pins "now" to a fixed instant shared by data and requests.
var clock = time.Date(2026, 10, 7, 5, 0, 0, 0, time.UTC) // Wednesday 12:00 WIB

type harness struct {
	t    *testing.T
	tx   pgx.Tx
	svc  *Service
	mux  http.Handler
	deps module.Deps
}

type fakePorts struct {
	overviewGagal []string
	announcements []string
	notes         []string
	fail          error
}

func (f *fakePorts) Build(context.Context) (json.RawMessage, []string, error) {
	gagal := append([]string{}, f.overviewGagal...)
	raw, _ := json.Marshal(map[string]any{"dibuatPada": "x", "gagal": gagal})
	return raw, gagal, nil
}

func (f *fakePorts) CreateDraft(_ context.Context, _ database.Querier, title, body string, tags []string) (string, string, error) {
	if f.fail != nil {
		return "", "", f.fail
	}
	f.announcements = append(f.announcements, title+"|"+body)
	return "11111111-1111-1111-1111-111111111111", title, nil
}

func (f *fakePorts) Add(_ context.Context, _ database.Querier, candidateID, content, userID, userName string) (string, error) {
	f.notes = append(f.notes, candidateID+"|"+content+"|"+userName)
	return "22222222-2222-2222-2222-222222222222", nil
}

func ports(f *fakePorts) Ports { return Ports{Overview: f, Announcements: f, CandidateNotes: f} }

// newTxHarness serves the module on a rolled-back transaction.
func newTxHarness(t *testing.T) *harness {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return clock })
	h := &harness{t: t, deps: deps}
	h.tx = testutil.Tx(t)
	h.svc = newService(deps, h.tx, ports(&fakePorts{}))
	h.mux = testutil.Mux(mod{s: h.svc})
	return h
}

// newPoolHarness serves the module on the pool.
func newPoolHarness(t *testing.T, f *fakePorts) *harness {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return clock })
	h := &harness{t: t, deps: deps}
	h.svc = newService(deps, deps.DB, ports(f))
	h.svc.memoryDir = t.TempDir()
	h.mux = testutil.Mux(mod{s: h.svc})
	return h
}

type call struct {
	status int
	raw    string
	header http.Header
}

func (c call) json(t *testing.T) any {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(c.raw), &v); err != nil {
		t.Fatalf("body %q: %v", c.raw, err)
	}
	return v
}

func (c call) obj(t *testing.T) map[string]any {
	m, _ := c.json(t).(map[string]any)
	return m
}

// do serves r; on a transaction harness it runs inside a savepoint released
// unless a statement failed, as each TS query autocommits.
func (h *harness) do(r *http.Request) call {
	h.t.Helper()
	ctx := context.Background()
	if h.tx != nil {
		sp, err := h.tx.Begin(ctx)
		if err != nil {
			h.t.Fatal(err)
		}
		h.svc.db = sp
		defer func() {
			h.svc.db = h.tx
			if _, err := sp.Exec(ctx, "SELECT 1"); err != nil {
				_ = sp.Rollback(ctx)
			} else if err := sp.Commit(ctx); err != nil {
				h.t.Fatal(err)
			}
		}()
	}
	rec := httptest.NewRecorder()
	h.mux.ServeHTTP(rec, r)
	return call{status: rec.Code, raw: rec.Body.String(), header: rec.Header()}
}

func (h *harness) get(target string, s testutil.Staff) call {
	return h.do(testutil.AsStaff(testutil.Request(http.MethodGet, target, nil), s))
}

func (h *harness) exec(sql string, args ...any) {
	h.t.Helper()
	if _, err := h.tx.Exec(context.Background(), sql, args...); err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) scalar(sql string, args ...any) string {
	h.t.Helper()
	var out string
	if err := h.tx.QueryRow(context.Background(), sql, args...).Scan(&out); err != nil {
		h.t.Fatal(err)
	}
	return out
}
