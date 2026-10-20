package gymscheduling

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

// recordingGuard notes the grants each guard call asks for. It lets the
// first allow calls through (as staff, on the first grant) and denies the rest.
type recordingGuard struct {
	allow int
	calls [][]iam.Grant
}

func (g *recordingGuard) RequireAnyGrant(_ *http.Request, grants ...iam.Grant) (*auth.User, int, error) {
	g.calls = append(g.calls, grants)
	if len(g.calls) <= g.allow {
		return &auth.User{ID: "6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11"}, 0, nil
	}
	return nil, -1, httpx.Forbidden("Insufficient permissions")
}

func (g *recordingGuard) RequireMember(*http.Request) (string, error) {
	return "", httpx.Unauthorized("Unauthorized")
}

// describe renders grants as "read gym.schedule,gym.sessions | read_own gym.sessions".
func describe(grants []iam.Grant) string {
	parts := make([]string, len(grants))
	for i, g := range grants {
		parts[i] = g.Action + " " + strings.Join(g.Prefixes, ",")
	}
	return strings.Join(parts, " | ")
}

const (
	sched     = "gym.schedule,gym.sessions"
	deskMenus = "gym.bookings,gym.checkin,gym.sessions"
	ownAccess = "read_own gym.sessions"
	anyID     = "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"
)

func TestStaffRouteGrants(t *testing.T) {
	want := map[string]string{
		"GET /api/gym/branches":                 "read gym",
		"GET /api/gym/class-types":              "read gym.class-types," + sched + " | " + ownAccess,
		"POST /api/gym/class-types":             "create gym.class-types",
		"PATCH /api/gym/class-types/{id}":       "update gym.class-types",
		"DELETE /api/gym/class-types/{id}":      "delete gym.class-types",
		"GET /api/gym/coaches":                  "read gym.coaches," + sched,
		"GET /api/gym/coaches/staff":            "create gym.coaches | update gym.coaches",
		"POST /api/gym/coaches":                 "create gym.coaches",
		"PATCH /api/gym/coaches/{id}":           "update gym.coaches",
		"GET /api/gym/sessions":                 "read " + sched + " | " + ownAccess,
		"POST /api/gym/sessions":                "create " + sched,
		"POST /api/gym/sessions/duplicate-week": "create gym.schedule",
		"GET /api/gym/sessions/{id}":            "read " + sched + " | " + ownAccess,
		"PATCH /api/gym/sessions/{id}":          "update " + sched,
		"POST /api/gym/sessions/{id}":           "update " + sched,
		"DELETE /api/gym/sessions/{id}":         "delete " + sched,
		"GET /api/gym/bookings":                 "read gym.bookings,gym.sessions",
		"POST /api/gym/bookings":                "create " + deskMenus,
		"GET /api/gym/bookings/members":         "read " + deskMenus,
		"POST /api/gym/bookings/{id}":           "read " + deskMenus + " | " + ownAccess,
		"GET /api/gym/checkin":                  "read gym.checkin,gym.sessions",
		"POST /api/gym/checkin":                 "create gym.checkin,gym.sessions",
		"GET /api/gym/checkin/members":          "read " + deskMenus,
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
		mux.ServeHTTP(rec, httptest.NewRequest(method, strings.ReplaceAll(path, "{id}", anyID), nil))
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

func TestBookingActionGrants(t *testing.T) {
	want := map[string]string{
		"cancel":   "update gym.bookings,gym.sessions",
		"no_show":  "update gym.bookings,gym.sessions | " + ownAccess,
		"check_in": "create gym.checkin,gym.sessions | update gym.bookings | " + ownAccess,
	}
	for action, expected := range want {
		guard := &recordingGuard{allow: 1}
		mux := testutil.Mux(mod{h: &handler{guard: guard}})
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/gym/bookings/"+anyID, strings.NewReader(`{"action":"`+action+`"}`)))
		if rec.Code != http.StatusForbidden || len(guard.calls) != 2 {
			t.Errorf("%s: status %d after %d guard calls", action, rec.Code, len(guard.calls))
			continue
		}
		if got := describe(guard.calls[1]); got != expected {
			t.Errorf("%s requires %q, want %q", action, got, expected)
		}
	}
}
