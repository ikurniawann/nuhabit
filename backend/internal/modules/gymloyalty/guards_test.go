package gymloyalty

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

// recordingGuard notes the grants each guard call asks for and denies them.
type recordingGuard struct{ calls [][]iam.Grant }

func (g *recordingGuard) RequireAnyGrant(_ *http.Request, grants ...iam.Grant) (*auth.User, int, error) {
	g.calls = append(g.calls, grants)
	return nil, -1, httpx.Forbidden("Insufficient permissions")
}

func (g *recordingGuard) RequireMember(*http.Request) (string, error) {
	return "", httpx.Unauthorized("Unauthorized")
}

func TestStaffRouteGrants(t *testing.T) {
	want := map[string]string{
		"GET /api/gym/loyalty/tiers":         "read gym.loyalty",
		"POST /api/gym/loyalty/tiers":        "create gym.loyalty",
		"PATCH /api/gym/loyalty/tiers/{id}":  "update gym.loyalty",
		"DELETE /api/gym/loyalty/tiers/{id}": "delete gym.loyalty",
		"PUT /api/gym/loyalty/settings":      "update gym.loyalty",
		"POST /api/gym/loyalty/recompute":    "update gym.loyalty",
		"GET /api/gym/loyalty/members":       "read gym.loyalty",
		"GET /api/gym/loyalty/leaderboard":   "read gym.loyalty",
		"GET /api/gym/members/{id}/loyalty":  "read gym.members | read gym.loyalty",
		"PUT /api/gym/members/{id}/status":   "update gym.loyalty",
	}
	seen := 0
	for _, route := range (&handler{}).Routes() {
		method, path, _ := strings.Cut(route.Pattern, " ")
		guard := &recordingGuard{}
		mux := testutil.Mux(mod{h: &handler{guard: guard}})
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, strings.ReplaceAll(path, "{id}", "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"), nil))
		if strings.HasPrefix(path, "/api/member-portal/") {
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s: member route answered %d without a session", route.Pattern, rec.Code)
			}
			continue
		}
		seen++
		parts := []string{}
		for _, calls := range guard.calls {
			for _, g := range calls {
				parts = append(parts, g.Action+" "+strings.Join(g.Prefixes, ","))
			}
		}
		if rec.Code != http.StatusForbidden || strings.Join(parts, " | ") != want[route.Pattern] {
			t.Errorf("%s: %d asks %q, want %q", route.Pattern, rec.Code, strings.Join(parts, " | "), want[route.Pattern])
		}
	}
	if seen != len(want) {
		t.Errorf("checked %d staff routes, want %d", seen, len(want))
	}
}
