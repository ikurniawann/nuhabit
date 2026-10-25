package gymautomation

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/testutil"
)

// denyGuard records the grants a route asks for and denies them.
type denyGuard struct{ calls [][]iam.Grant }

func (g *denyGuard) RequireAnyGrant(_ *http.Request, grants ...iam.Grant) (*auth.User, int, error) {
	g.calls = append(g.calls, grants)
	return nil, -1, httpx.Forbidden("Insufficient permissions")
}

func TestStaffRouteGrants(t *testing.T) {
	want := map[string]string{
		"GET /api/gym/automation/jobs":                       "read gym.automation",
		"PATCH /api/gym/automation/jobs/{name}":              "update gym.automation",
		"POST /api/gym/automation/jobs/{name}/run":           "update gym.automation",
		"GET /api/gym/automation/members":                    "read gym.automation",
		"GET /api/gym/automation/members/{id}/notifications": "read gym.automation",
	}
	routes := (&handler{}).Routes()
	if len(routes) != len(want) {
		t.Fatalf("%d routes, %d expected", len(routes), len(want))
	}
	for _, route := range routes {
		method, path, _ := strings.Cut(route.Pattern, " ")
		path = strings.NewReplacer("{name}", "gym-credits.expiry", "{id}", "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b").Replace(path)
		guard := &denyGuard{}
		rec := httptest.NewRecorder()
		testutil.Mux(mod{h: &handler{guard: guard}}).ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader("{}")))
		if rec.Code != http.StatusForbidden || len(guard.calls) != 1 {
			t.Errorf("%s: status %d after %d guard calls", route.Pattern, rec.Code, len(guard.calls))
			continue
		}
		g := guard.calls[0]
		if got := g[0].Action + " " + strings.Join(g[0].Prefixes, ","); len(g) != 1 || got != want[route.Pattern] {
			t.Errorf("%s requires %v, want %q", route.Pattern, g, want[route.Pattern])
		}
	}
}
