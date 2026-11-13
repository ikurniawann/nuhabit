package app

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/config"
	"nuhabit/backend/internal/platform/metrics"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

func TestModuleSelection(t *testing.T) {
	cfg := config.Config{Modules: "gym-credits, identity"}
	if !cfg.ModuleEnabled("identity") || !cfg.ModuleEnabled("gym-credits") || cfg.ModuleEnabled("pos") {
		t.Fatal("comma list selection")
	}
	if !(config.Config{Modules: "all"}).ModuleEnabled("pos") || !(config.Config{}).ModuleEnabled("pos") {
		t.Fatal("all/empty mounts everything")
	}
}

func TestHandlerMountsOnlySelectedModules(t *testing.T) {
	deps := testutil.Deps(t, nil)
	deps.Config.Modules = "identity"
	reg := metrics.NewRegistry()
	h, mounted := Handler(deps, time.Now(), reg)
	if strings.Join(mounted, ",") != "identity" {
		t.Fatalf("mounted = %v", mounted)
	}
	for path, status := range map[string]int{"/health": 200, "/ready": 200, "/api/auth/me": 401} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != status {
			t.Errorf("%s = %d (%s), want %d", path, rec.Code, rec.Body.String(), status)
		}
		if rec.Header().Get("X-Request-Id") == "" {
			t.Errorf("%s: missing request id", path)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/ready", nil))
	if !strings.HasPrefix(rec.Body.String(), `{"status":"ready","database":"ok","latency_ms":`) {
		t.Errorf("ready body %s", rec.Body.String())
	}
	var out strings.Builder
	_ = reg.WriteText(&out)
	// The gate's 401 is counted under the module's pattern.
	for _, line := range []string{
		`http_requests_total{route="/ready",method="GET",status="2xx"} 2`,
		`http_requests_total{route="/api/auth/me",method="GET",status="4xx"} 1`,
	} {
		if !strings.Contains(out.String(), line) {
			t.Errorf("missing %s in\n%s", line, out.String())
		}
	}
}

func TestRegisterRejectsDuplicates(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	ctor := func(module.Deps) module.Module { return nil }
	Register("dup-test", ctor)
	defer delete(registry, "dup-test")
	Register("dup-test", ctor)
}

// TestIdempotencyKeyThroughHandler sends one create twice through the full
// chain: the second answer is the stored 201, not a duplicate-code 409.
func TestIdempotencyKeyThroughHandler(t *testing.T) {
	deps := testutil.Deps(t, nil)
	deps.Redis = testutil.Redis(t)
	h, _ := Handler(deps, time.Now(), metrics.NewRegistry())
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"settings.roles": {"read", "create"}}})
	code := "idem_" + testutil.RandomHex(4)
	t.Cleanup(func() { _, _ = deps.DB.Exec(context.Background(), `DELETE FROM iam.roles WHERE code = $1`, code) })
	key := testutil.RandomHex(8)
	send := func() *httptest.ResponseRecorder {
		r := testutil.AsStaff(testutil.Request("POST", "/api/settings/iam/roles", map[string]any{"code": code, "name": "Idem"}), staff)
		r.Header.Set("Idempotency-Key", key)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}
	first, again := send(), send()
	if first.Code != 201 || again.Code != 201 || again.Body.String() != first.Body.String() {
		t.Fatalf("first %d %s, again %d %s", first.Code, first.Body, again.Code, again.Body)
	}
	if again.Header().Get("Idempotent-Replayed") != "true" {
		t.Fatal("second answer was not a replay")
	}
	var n int
	if err := deps.DB.QueryRow(context.Background(), `SELECT count(*) FROM iam.roles WHERE code = $1`, code).Scan(&n); err != nil || n != 1 {
		t.Fatalf("roles with code %s: %d (%v), want 1", code, n, err)
	}
}
