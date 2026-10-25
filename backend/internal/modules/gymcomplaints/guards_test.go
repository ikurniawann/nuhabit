package gymcomplaints

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
type recordingGuard struct {
	calls  [][]iam.Grant
	member int
}

func (g *recordingGuard) RequireAnyGrant(_ *http.Request, grants ...iam.Grant) (*auth.User, int, error) {
	g.calls = append(g.calls, grants)
	return nil, -1, httpx.Forbidden("Insufficient permissions")
}

func (g *recordingGuard) RequireMember(*http.Request) (string, error) {
	g.member++
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
		read    = "read gym.complaints"
		update  = "update gym.complaints"
		manage  = "delete gym.complaints"
		readNew = "read gym.complaints | create gym.complaints"
		anyID   = "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"
	)
	want := map[string]string{
		"GET /api/gym/complaints":                                        read,
		"POST /api/gym/complaints":                                       "create gym.complaints",
		"GET /api/gym/complaints/options":                                readNew,
		"GET /api/gym/complaints/member-classes":                         readNew,
		"GET /api/gym/complaints/report":                                 read,
		"GET /api/gym/complaints/settings":                               read,
		"PUT /api/gym/complaints/settings":                               manage,
		"GET /api/gym/complaints/categories":                             read,
		"PUT /api/gym/complaints/categories":                             manage,
		"GET /api/gym/complaints/conversations/{conversationId}/ticket":  readNew,
		"POST /api/gym/complaints/conversations/{conversationId}/ticket": "create gym.complaints",
		"GET /api/gym/complaints/{id}":                                   read,
		"PATCH /api/gym/complaints/{id}":                                 update,
		"DELETE /api/gym/complaints/{id}":                                manage,
		"POST /api/gym/complaints/{id}/status":                           update,
		"POST /api/gym/complaints/{id}/assign":                           update,
		"POST /api/gym/complaints/{id}/notes":                            update,
		"GET /api/gym/my-classes/complaints":                             "read gym.my-classes",
	}
	h := &handler{}
	staff, members := 0, 0
	for _, route := range h.Routes() {
		method, path, _ := strings.Cut(route.Pattern, " ")
		guard := &recordingGuard{}
		h.guard = guard
		target := strings.NewReplacer("{id}", anyID, "{conversationId}", anyID).Replace(path)
		rec := httptest.NewRecorder()
		testutil.Mux(mod{h: h}).ServeHTTP(rec, httptest.NewRequest(method, target, nil))
		if strings.HasPrefix(path, "/api/member-portal/") {
			members++
			if rec.Code != http.StatusUnauthorized || guard.member != 1 || len(guard.calls) != 0 {
				t.Errorf("%s: status %d, %d member checks, %d staff checks", route.Pattern, rec.Code, guard.member, len(guard.calls))
			}
			continue
		}
		staff++
		expected, listed := want[route.Pattern]
		if !listed {
			t.Errorf("%s has no expected grant in this test", route.Pattern)
			continue
		}
		if rec.Code != http.StatusForbidden || len(guard.calls) != 1 {
			t.Errorf("%s: status %d after %d guard calls, want one denied call", route.Pattern, rec.Code, len(guard.calls))
			continue
		}
		if got := describe(guard.calls[0]); got != expected {
			t.Errorf("%s requires %q, want %q", route.Pattern, got, expected)
		}
	}
	if staff != len(want) || members != 6 {
		t.Errorf("%d staff routes (want %d), %d member routes (want 6)", staff, len(want), members)
	}
}
