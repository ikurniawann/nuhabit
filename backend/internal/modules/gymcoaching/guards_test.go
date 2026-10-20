package gymcoaching

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

func describe(grants []iam.Grant) string {
	parts := make([]string, len(grants))
	for i, g := range grants {
		parts[i] = g.Action + " " + strings.Join(g.Prefixes, ",")
	}
	return strings.Join(parts, " | ")
}

func TestStaffRouteGrants(t *testing.T) {
	const (
		anyPT  = "read gym.pt | read_own gym.pt | create gym.pt"
		view   = "read gym.pt | read_own gym.pt"
		update = "update gym.pt"
		anyID  = "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"
	)
	want := map[string]string{
		"GET /api/gym/pt/class-types":                        anyPT,
		"GET /api/gym/pt/class-type-flags":                   "update gym.class-types",
		"PATCH /api/gym/pt/class-type-flags/{id}":            "update gym.class-types",
		"GET /api/gym/pt/coaches":                            anyPT,
		"GET /api/gym/pt/members":                            anyPT + " | read gym.assessments | create gym.assessments",
		"GET /api/gym/pt/availability/{coachId}":             anyPT,
		"PUT /api/gym/pt/availability/{coachId}":             update,
		"POST /api/gym/pt/availability/{coachId}/exceptions": update,
		"DELETE /api/gym/pt/availability/exceptions/{id}":    update,
		"GET /api/gym/pt/slots":                              anyPT,
		"GET /api/gym/pt/appointments":                       view,
		"POST /api/gym/pt/appointments":                      "create gym.pt | update gym.pt",
		"GET /api/gym/pt/appointments/{id}":                  view,
		"POST /api/gym/pt/appointments/{id}":                 update,
		"POST /api/gym/pt/participants/{id}":                 update,
		"GET /api/gym/assessments":                           "read gym.assessments",
		"POST /api/gym/assessments":                          "create gym.assessments",
		"GET /api/gym/assessments/{id}":                      "read gym.assessments",
		"PUT /api/gym/assessments/{id}":                      "update gym.assessments",
		"DELETE /api/gym/assessments/{id}":                   "delete gym.assessments",
	}
	h := &handler{}
	seen := 0
	for _, route := range h.Routes() {
		method, path, _ := strings.Cut(route.Pattern, " ")
		if !strings.HasPrefix(path, "/api/gym/") {
			continue
		}
		seen++
		expected, listed := want[route.Pattern]
		if !listed {
			t.Errorf("%s has no expected grant in this test", route.Pattern)
			continue
		}
		guard := &recordingGuard{}
		h.guard = guard
		target := strings.NewReplacer("{id}", anyID, "{coachId}", anyID).Replace(path)
		rec := httptest.NewRecorder()
		testutil.Mux(mod{h: h}).ServeHTTP(rec, httptest.NewRequest(method, target, nil))
		if rec.Code != http.StatusForbidden || len(guard.calls) != 1 {
			t.Errorf("%s: status %d after %d guard calls, want one denied call", route.Pattern, rec.Code, len(guard.calls))
			continue
		}
		if got := describe(guard.calls[0]); got != expected {
			t.Errorf("%s requires %q, want %q", route.Pattern, got, expected)
		}
	}
	if seen != len(want) {
		t.Errorf("%d staff routes, %d expected", seen, len(want))
	}
}
