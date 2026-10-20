package memberportal

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// denyingGuard records the grants each staff route asks for and denies.
type denyingGuard struct{ calls [][]iam.Grant }

func (g *denyingGuard) RequireAnyGrant(_ *http.Request, grants ...iam.Grant) (*auth.User, int, error) {
	g.calls = append(g.calls, grants)
	return nil, -1, httpx.Forbidden("")
}

type routesOnly []module.Route

func (routesOnly) Name() string             { return Name }
func (r routesOnly) Routes() []module.Route { return r }

func TestReferralStaffRouteGrants(t *testing.T) {
	want := map[string]string{
		"GET /api/gym/referrals/settings":    "read gym.referrals",
		"PUT /api/gym/referrals/settings":    "update gym.referrals",
		"GET /api/gym/referrals":             "read gym.referrals",
		"GET /api/gym/referrals/leaderboard": "read gym.referrals",
	}
	seen := 0
	for _, route := range (&Handler{}).referralRoutes() {
		method, path, _ := strings.Cut(route.Pattern, " ")
		if !strings.HasPrefix(path, "/api/gym/") {
			continue
		}
		seen++
		guard := &denyingGuard{}
		mux := testutil.Mux(routesOnly((&Handler{guard: guard}).referralRoutes()))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader("{}")))
		if rec.Code != http.StatusForbidden || len(guard.calls) != 1 || len(guard.calls[0]) != 1 {
			t.Errorf("%s: status %d after %d guard calls", route.Pattern, rec.Code, len(guard.calls))
			continue
		}
		g := guard.calls[0][0]
		if got := g.Action + " " + strings.Join(g.Prefixes, ","); got != want[route.Pattern] {
			t.Errorf("%s asks %q, want %q", route.Pattern, got, want[route.Pattern])
		}
	}
	if seen != len(want) {
		t.Errorf("checked %d staff routes, want %d", seen, len(want))
	}
}
