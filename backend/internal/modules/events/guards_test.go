package events

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

func describe(grants []iam.Grant) string {
	parts := make([]string, len(grants))
	for i, g := range grants {
		parts[i] = g.Action + " " + strings.Join(g.Prefixes, ",")
	}
	return strings.Join(parts, " | ")
}

func TestStaffRouteGrants(t *testing.T) {
	const (
		view   = "read events.calendar,crm.engagement,site.events"
		manage = "update crm.engagement,site.events | create crm.engagement,site.events"
		anyID  = "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"
	)
	want := map[string]string{
		"GET /api/events/calendar":             view,
		"GET /api/events/options":              view,
		"GET /api/events/export.csv":           view,
		"GET /api/events/overrides":            view,
		"GET /api/events/link/candidates":      view,
		"POST /api/events/link":                manage,
		"POST /api/events/link/publish":        manage,
		"DELETE /api/events/link/{crmEventId}": manage,
		"GET /api/events/tasks":                view,
		"POST /api/events/tasks":               manage,
		"PATCH /api/events/tasks/{id}":         manage,
		"DELETE /api/events/tasks/{id}":        manage,
		"GET /api/events/feeds":                view,
		"POST /api/events/feeds":               view,
		"DELETE /api/events/feeds/{id}":        view,
	}
	guard := &recordingGuard{}
	h := &handler{svc: NewService(nil, Ports{}, nil, nil), guard: guard}
	mux := testutil.Mux(mod{h: h})
	for _, rt := range h.Routes() {
		method, pattern, _ := strings.Cut(rt.Pattern, " ")
		expected, ok := want[rt.Pattern]
		if !ok {
			if strings.HasPrefix(pattern, "/api/public/") {
				continue
			}
			t.Errorf("%s: route not covered by the guard table", rt.Pattern)
			continue
		}
		guard.calls = nil
		path := strings.NewReplacer("{crmEventId}", anyID, "{id}", anyID).Replace(pattern)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
		if rec.Code != http.StatusForbidden || len(guard.calls) != 1 {
			t.Errorf("%s: status %d, guard calls %d", rt.Pattern, rec.Code, len(guard.calls))
			continue
		}
		if got := describe(guard.calls[0]); got != expected {
			t.Errorf("%s: grants %q, want %q", rt.Pattern, got, expected)
		}
	}
	for pattern := range want {
		found := false
		for _, rt := range h.Routes() {
			found = found || rt.Pattern == pattern
		}
		if !found {
			t.Errorf("%s: expected route is not mounted", pattern)
		}
	}
}

func TestPublicFeedNeedsAToken(t *testing.T) {
	h := &handler{svc: NewService(nil, Ports{}, nil, nil), guard: &recordingGuard{}}
	mux := testutil.Mux(mod{h: h})
	for _, path := range []string{FeedPath, FeedPath + "?token=short"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404 without touching the database", path, rec.Code)
		}
	}
}
