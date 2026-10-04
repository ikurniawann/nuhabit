package crm

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Every area mounts on one ServeMux without conflicting patterns: 128 of
// the 132 TS handlers; the four left in TS are not registered.
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
	if len(seen) != 128 {
		t.Fatalf("%d routes mounted, want 128", len(seen))
	}
	for _, p := range []string{
		"POST /api/crm/avatars/upload", "POST /api/crm/engagement/announcements/image",
		"GET /api/crm/report-builder/{id}/export", "GET /api/crm/reports/conversations",
	} {
		if seen[p] {
			t.Errorf("%s must stay in TS", p)
		}
	}
}
