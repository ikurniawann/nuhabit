package gymsop

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

type recordingGuard struct{ calls [][]iam.Grant }

func (g *recordingGuard) RequireAnyGrant(_ *http.Request, grants ...iam.Grant) (*auth.User, int, error) {
	g.calls = append(g.calls, grants)
	return nil, -1, httpx.Forbidden("Insufficient permissions")
}

func describe(grants []iam.Grant) string {
	parts := make([]string, len(grants))
	for i, g := range grants {
		parts[i] = g.Action + " " + strings.Join(g.Prefixes, ",")
	}
	return strings.Join(parts, " | ")
}

func TestRouteGrants(t *testing.T) {
	const (
		readers = "read gym.sop | read_own gym.sop | read gym.my-classes | read_own gym.sessions"
		anyID   = "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"
	)
	want := map[string]string{
		"GET /api/gym/sop":                             "read gym.sop",
		"POST /api/gym/sop":                            "create gym.sop",
		"GET /api/gym/sop/roles":                       "create gym.sop | update gym.sop",
		"GET /api/gym/sop/{id}":                        "read gym.sop",
		"PATCH /api/gym/sop/{id}":                      "update gym.sop",
		"POST /api/gym/sop/{id}/versions":              "update gym.sop",
		"POST /api/gym/sop/{id}/remind":                "update gym.sop",
		"GET /api/gym/sop/versions/{versionId}/file":   readers,
		"GET /api/gym/my-classes/sop":                  readers,
		"POST /api/gym/my-classes/sop/{versionId}/ack": readers,
	}
	h := &handler{}
	routes := h.Routes()
	if len(routes) != len(want) {
		t.Errorf("%d routes, %d expected", len(routes), len(want))
	}
	for _, route := range routes {
		method, path, _ := strings.Cut(route.Pattern, " ")
		expected, listed := want[route.Pattern]
		if !listed {
			t.Errorf("%s has no expected grant in this test", route.Pattern)
			continue
		}
		guard := &recordingGuard{}
		h.guard = guard
		mux := testutil.Mux(mod{h: h})
		rec := httptest.NewRecorder()
		target := strings.NewReplacer("{id}", anyID, "{versionId}", anyID).Replace(path)
		mux.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
		if rec.Code != http.StatusForbidden || len(guard.calls) != 1 {
			t.Errorf("%s: status %d after %d guard calls, want one denied call", route.Pattern, rec.Code, len(guard.calls))
			continue
		}
		if got := describe(guard.calls[0]); got != expected {
			t.Errorf("%s requires %q, want %q", route.Pattern, got, expected)
		}
	}
}
