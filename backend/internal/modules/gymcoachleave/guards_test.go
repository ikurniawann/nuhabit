package gymcoachleave

import (
	"context"
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

func (g *recordingGuard) GrantedMenuCodes(context.Context, string, string) ([]string, error) {
	return nil, nil
}

func TestStaffRouteGrants(t *testing.T) {
	const (
		read    = "read gym.coach-leave"
		update  = "update gym.coach-leave"
		mine    = "read gym.my-classes"
		mineUpd = "update gym.my-classes"
		anyID   = "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"
	)
	want := map[string]string{
		"GET /api/gym/coach-leave/queue":                       read,
		"GET /api/gym/coach-leave/covers/{id}/candidates":      update,
		"POST /api/gym/coach-leave/covers/{id}/assign":         update,
		"POST /api/gym/coach-leave/covers/{id}/cancel-session": update,
		"GET /api/gym/coach-leave/settings":                    read,
		"PUT /api/gym/coach-leave/settings":                    update,
		"GET /api/gym/coach-leave/blackouts":                   read,
		"POST /api/gym/coach-leave/blackouts":                  update,
		"DELETE /api/gym/coach-leave/blackouts/{id}":           update,
		"GET /api/gym/coach-leave/incidents":                   read,
		"POST /api/gym/coach-leave/incidents":                  update,
		"POST /api/gym/coach-leave/incidents/{id}/void":        update,
		"GET /api/gym/coach-leave/warnings":                    read,
		"POST /api/gym/coach-leave/warnings/{id}":              update,
		"GET /api/gym/coach-leave/changes":                     read,
		"GET /api/gym/my-classes/landing":                      mine,
		"GET /api/gym/my-classes/leave":                        mine,
		"GET /api/gym/my-classes/leave/impact":                 mine,
		"GET /api/gym/my-classes/leave/covers/{id}/candidates": mine,
		"POST /api/gym/my-classes/leave/covers/{id}/request":   mineUpd,
		"POST /api/gym/my-classes/leave/covers/{id}/respond":   mineUpd,
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
		rec := httptest.NewRecorder()
		testutil.Mux(mod{h: h}).ServeHTTP(rec, httptest.NewRequest(method, strings.ReplaceAll(path, "{id}", anyID), nil))
		if rec.Code != http.StatusForbidden || len(guard.calls) != 1 {
			t.Errorf("%s: status %d after %d guard calls, want one denied call", route.Pattern, rec.Code, len(guard.calls))
			continue
		}
		parts := make([]string, len(guard.calls[0]))
		for i, g := range guard.calls[0] {
			parts[i] = g.Action + " " + strings.Join(g.Prefixes, ",")
		}
		if got := strings.Join(parts, " | "); got != expected {
			t.Errorf("%s requires %q, want %q", route.Pattern, got, expected)
		}
	}
}

func TestCoachOnly(t *testing.T) {
	coachMenus := []string{"gym", "gym.my-classes", "gym.sessions", "gym.checkin", "ess", "ess.attendance"}
	if !CoachOnly(true, coachMenus) {
		t.Fatal("a coach with coach menus and the employee area lands on Kelas Saya")
	}
	if CoachOnly(true, append(coachMenus, "gym.members")) {
		t.Fatal("a coach who also works the members page keeps the default landing")
	}
	if CoachOnly(false, coachMenus) {
		t.Fatal("an account without a coach profile is not a coach")
	}
}
