package gymcredits

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
	h := &Handler{guard: guard}
	rec := httptest.NewRecorder()
	testutil.Mux(creditsModule{routes: h.Routes()}).ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	return rec.Code
}

func TestStaffRouteGrants(t *testing.T) {
	want := map[string]string{
		"GET /api/gym/packages":                            "read gym.packages,gym.credits",
		"POST /api/gym/packages":                           "create gym.packages | update gym.packages",
		"PATCH /api/gym/packages/{id}":                     "update gym.packages",
		"DELETE /api/gym/packages/{id}":                    "delete gym.packages",
		"GET /api/gym/credits":                             "read gym.credits",
		"GET /api/gym/credits/{customerId}":                "read gym.credits",
		"POST /api/gym/credits/{customerId}/adjust":        "update gym.credits",
		"POST /api/gym/credits/{customerId}/sell":          "create gym.credits",
		"POST /api/gym/credits/reverse":                    "update gym.credits",
		"POST /api/gym/credits/purchases/{id}/refund":      "update gym.credits",
		"GET /api/gym/credits/purchases/{id}/refund-quote": "update gym.credits",
		"POST /api/gym/passes/{id}/freeze":                 "update gym.credits",
		"POST /api/gym/passes/{id}/unfreeze":               "update gym.credits",
		"POST /api/gym/passes/{id}/extend":                 "update gym.credits",
		"PUT /api/gym/passes/{id}/auto-renew":              "update gym.credits",
		"GET /api/gym/rules":                               "read gym.rules",
		"PUT /api/gym/rules":                               "update gym.rules",
	}
	seen := 0
	for _, route := range (&Handler{}).Routes() {
		method, path, _ := strings.Cut(route.Pattern, " ")
		if !strings.HasPrefix(path, "/api/gym/") {
			continue
		}
		seen++
		guard := &recordingGuard{}
		target := strings.NewReplacer("{id}", anyID, "{customerId}", anyID).Replace(path)
		if code := serve(guard, method, target, "{}"); code != http.StatusForbidden || len(guard.calls) != 1 {
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

func TestSavePackageNeedsTheActionItPerforms(t *testing.T) {
	body := `{"name":"10 Visit","credits":10,"price_idr":800000,"validity_days":60%s}`
	for idField, want := range map[string]string{"": "create gym.packages", `,"id":"` + anyID + `"`: "update gym.packages"} {
		guard := &recordingGuard{allow: 1}
		if code := serve(guard, "POST", "/api/gym/packages", strings.Replace(body, "%s", idField, 1)); code != http.StatusForbidden || len(guard.calls) != 2 {
			t.Fatalf("id %q: status %d after %d guard calls", idField, code, len(guard.calls))
		}
		if got := describe(guard.calls[1]); got != want {
			t.Errorf("id %q requires %q, want %q", idField, got, want)
		}
	}
}
