package gymcare

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

// Every care route asks for the manager grant first: the matched index is
// what tells the handler the caller may read medical detail.
func TestStaffRouteGrants(t *testing.T) {
	const (
		manager = "read_medical gym.member-flags"
		portal  = "read gym.my-classes | read_own gym.sessions | read_own gym.pt"
		desk    = "read gym.member-flags | read gym.members | read gym.checkin,gym.sessions | read gym.sessions,gym.bookings | read gym.pt"
		anyID   = "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"
	)
	want := map[string]string{
		"GET /api/gym/member-flag-types":                manager + " | " + desk + " | " + portal,
		"POST /api/gym/member-flag-types":               manager + " | create gym.member-flags",
		"PATCH /api/gym/member-flag-types/{id}":         manager + " | update gym.member-flags",
		"GET /api/gym/member-flags":                     manager + " | read gym.member-flags",
		"GET /api/gym/member-flags/members":             manager + " | " + desk + " | " + portal,
		"POST /api/gym/member-flags":                    manager + " | create gym.member-flags | " + portal,
		"PATCH /api/gym/member-flags/{id}":              manager + " | update gym.member-flags | " + portal,
		"DELETE /api/gym/member-flags/{id}":             manager + " | delete gym.member-flags | " + portal,
		"POST /api/gym/member-flags/{id}/review":        manager + " | update gym.member-flags | " + portal,
		"GET /api/gym/health-declarations/{customerId}": manager + " | " + portal,
		"GET /api/gym/coach-notes":                      manager + " | " + portal,
		"GET /api/gym/coach-notes/members/{id}":         manager + " | " + portal,
		"POST /api/gym/coach-notes":                     manager + " | " + portal,
		"POST /api/gym/coach-notes/{id}/release":        manager + " | " + portal,
		"DELETE /api/gym/coach-notes/{id}":              manager + " | " + portal,
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
		mux := testutil.Mux(mod{h: h})
		rec := httptest.NewRecorder()
		target := strings.NewReplacer("{id}", anyID, "{customerId}", anyID).Replace(path)
		mux.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
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

func TestMemberRoutesNeedSession(t *testing.T) {
	mux := testutil.Mux(mod{h: &handler{guard: &recordingGuard{}}})
	for _, method := range []string{"GET", "POST"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, "/api/member-portal/gym/health", nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status %d", method, rec.Code)
		}
	}
}
