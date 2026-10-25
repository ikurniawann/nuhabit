package payroll

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

func describeGrants(grants []iam.Grant) string {
	parts := make([]string, len(grants))
	for i, g := range grants {
		parts[i] = g.Action + " " + strings.Join(g.Prefixes, ",")
	}
	return strings.Join(parts, " | ")
}

// Every IAM-guarded task route asks the guard exactly once, for the grants
// listed here; a new route fails until it is added.
func TestTaskRouteGrants(t *testing.T) {
	const (
		read  = "read tasks | read tasks.team"
		write = "update tasks | update tasks.team"
		anyID = "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"
	)
	want := map[string]string{
		"GET /api/hris/dept-tasks/meta":                                    "read tasks | read tasks.team | read tasks.kpi",
		"GET /api/hris/dept-tasks/items":                                   read,
		"GET /api/hris/dept-tasks/monitor":                                 read,
		"GET /api/hris/dept-tasks/kpi":                                     "read tasks | read tasks.team | read tasks.kpi",
		"GET /api/hris/dept-tasks/kpi/contributions":                       "read tasks | read tasks.kpi | read hris.performance",
		"GET /api/hris/dept-tasks/occurrences/{id}":                        read,
		"POST /api/hris/dept-tasks/occurrences/{id}/attachments":           write,
		"GET /api/hris/dept-tasks/occurrences/{id}/attachments/{attId}":    read,
		"DELETE /api/hris/dept-tasks/occurrences/{id}/attachments/{attId}": write,
	}
	h := &handler{}
	seen := 0
	for _, route := range h.taskRoutes() {
		method, path, _ := strings.Cut(route.Pattern, " ")
		seen++
		expected, listed := want[route.Pattern]
		if !listed {
			t.Errorf("%s has no expected grant in this test", route.Pattern)
			continue
		}
		guard := &recordingGuard{}
		h.guard = guard
		target := strings.NewReplacer("{id}", anyID, "{attId}", anyID).Replace(path)
		rec := httptest.NewRecorder()
		testutil.Mux(payrollModule{routes: h.taskRoutes()}).ServeHTTP(rec, httptest.NewRequest(method, target, nil))
		if rec.Code != http.StatusForbidden || len(guard.calls) != 1 {
			t.Errorf("%s: status %d after %d guard calls, want one denied call", route.Pattern, rec.Code, len(guard.calls))
			continue
		}
		if got := describeGrants(guard.calls[0]); got != expected {
			t.Errorf("%s requires %q, want %q", route.Pattern, got, expected)
		}
	}
	if seen != len(want) {
		t.Errorf("%d task routes, %d expected", seen, len(want))
	}
}
