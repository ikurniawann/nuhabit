package gymtraining

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/testutil"
)

// recordingGuard notes the grants each guard call asks for. It lets the
// first allow calls through and denies the rest.
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

func describe(grants []iam.Grant) string {
	parts := make([]string, len(grants))
	for i, g := range grants {
		parts[i] = g.Action + " " + strings.Join(g.Prefixes, ",")
	}
	return strings.Join(parts, " | ")
}

const anyID = "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"

func serve(guard *recordingGuard, method, path, body string) int {
	rec := httptest.NewRecorder()
	testutil.Mux(mod{handlers{guard: guard}}).ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	return rec.Code
}

func TestStaffRouteGrants(t *testing.T) {
	upsert := func(menu string) string { return "create " + menu + " | update " + menu }
	want := map[string]string{
		"GET /api/gym/exercises":                  "read gym.exercises",
		"POST /api/gym/exercises":                 upsert("gym.exercises"),
		"DELETE /api/gym/exercises":               "delete gym.exercises",
		"POST /api/gym/exercises/substitutions":   "create gym.exercises",
		"DELETE /api/gym/exercises/substitutions": "delete gym.exercises",
		"GET /api/gym/races":                      "read gym.races",
		"POST /api/gym/races":                     upsert("gym.races"),
		"DELETE /api/gym/races":                   "delete gym.races",
		"GET /api/gym/races/{id}/entrants":        "read gym.races",
		"GET /api/gym/incentives/schemes":         "read gym.incentives",
		"POST /api/gym/incentives/schemes":        upsert("gym.incentives"),
		"DELETE /api/gym/incentives/schemes":      "delete gym.incentives",
		"GET /api/gym/incentives/statements":      "read gym.incentives",
		"GET /api/gym/incentives/payouts":         "read gym.incentives",
		"POST /api/gym/incentives/payouts":        "create gym.incentives",
		"GET /api/gym/incentives/payouts/{id}":    "read gym.incentives",
		"POST /api/gym/incentives/payouts/{id}":   "update gym.incentives",
		"GET /api/gym/my-classes/incentives":      "read gym.my-classes",
	}
	seen := 0
	for _, route := range (handlers{}).Routes() {
		method, path, _ := strings.Cut(route.Pattern, " ")
		if !strings.HasPrefix(path, "/api/gym/") {
			continue
		}
		seen++
		guard := &recordingGuard{}
		if code := serve(guard, method, strings.ReplaceAll(path, "{id}", anyID), "{}"); code != http.StatusForbidden || len(guard.calls) != 1 {
			t.Errorf("%s: status %d after %d guard calls, want one denied call", route.Pattern, code, len(guard.calls))
			continue
		}
		if got := describe(guard.calls[0]); got != want[route.Pattern] {
			t.Errorf("%s requires %q, want %q", route.Pattern, got, want[route.Pattern])
		}
	}
	if seen != len(want) {
		t.Errorf("%d staff routes, %d expected", seen, len(want))
	}
}

// An upsert with an id edits, so it needs update; without one it creates.
func TestUpsertNeedsTheActionItPerforms(t *testing.T) {
	race := `{"name":"HYROX Jakarta","country":"Indonesia","region":"` + domain.RaceRegions[0] + `","city":"Jakarta",` +
		`"starts_at":"2026-12-01T08:00:00+07:00","ends_at":"2026-12-01T18:00:00+07:00","status":"` + domain.RaceStatuses[0] + `"%s}`
	for idField, want := range map[string]string{"": "create gym.races", `,"id":"` + anyID + `"`: "update gym.races"} {
		guard := &recordingGuard{allow: 1}
		code := serve(guard, "POST", "/api/gym/races", strings.Replace(race, "%s", idField, 1))
		if len(guard.calls) != 2 {
			t.Fatalf("id %q: status %d after %d guard calls", idField, code, len(guard.calls))
		}
		if got := describe(guard.calls[1]); got != want {
			t.Errorf("id %q requires %q, want %q", idField, got, want)
		}
	}
}
