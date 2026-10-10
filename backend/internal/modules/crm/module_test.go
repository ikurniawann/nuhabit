package crm

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Every area mounts on one ServeMux without conflicting patterns: all 132
// TS handlers, including the upload and xlsx routes, plus the two public
// form routes.
func TestRoutesMountTogether(t *testing.T) {
	m := New(testutil.Deps(t, nil), Ports{})
	mux := http.NewServeMux()
	seen := map[string]bool{}
	for _, r := range m.Routes() {
		if seen[r.Pattern] {
			t.Fatalf("duplicate pattern %s", r.Pattern)
		}
		seen[r.Pattern] = true
		mux.Handle(r.Pattern, r.Handler)
	}
	if len(seen) != 136 {
		t.Fatalf("%d routes mounted, want 136", len(seen))
	}
	for _, p := range []string{
		"POST /api/crm/avatars/upload", "POST /api/crm/engagement/announcements/image",
		"GET /api/crm/report-builder/{id}/export", "GET /api/crm/reports/conversations",
	} {
		if !seen[p] {
			t.Errorf("%s is not registered", p)
		}
	}
}
