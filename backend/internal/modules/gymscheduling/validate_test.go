package gymscheduling

import (
	"testing"
	"time"
)

// Body validation follows zod v4 as platform/validate implements it.
func TestValidationMatchesZod(t *testing.T) {
	f := newFixture(t)
	// String.prototype.trim strips a BOM (U+FEFF), so the name is too short.
	expectError(t, f.asStaff("POST", "/api/gym/class-types", map[string]any{
		"name": "\xef\xbb\xbfab", "default_duration_min": 60, "default_credit_cost": 1, "default_capacity": 5,
	}), 400, "Data tidak valid: name")

	typeID, _ := f.classType(1)
	session := f.session(typeID, time.Now().Add(48*time.Hour), 5)
	firstIssue := func(res response) map[string]any {
		issues, _ := res.Body["details"].([]any)
		if len(issues) == 0 {
			t.Fatalf("no issues: %s", res.Raw)
		}
		return issues[0].(map[string]any)
	}
	// A missing z.enum value is invalid_value with the options.
	res := f.asStaff("POST", "/api/gym/sessions/"+session, map[string]any{})
	if issue := firstIssue(res); res.Body["error"] != "Data tidak valid: action" || issue["code"] != "invalid_value" ||
		issue["message"] != `Invalid option: expected one of "publish"|"cancel"|"complete"` {
		t.Fatalf("missing action: %s", res.Raw)
	}
	// Integers beyond 2^53 are not safe integers.
	res = f.asStaff("PATCH", "/api/gym/sessions/"+session, map[string]any{"capacity": 1e300})
	if issue := firstIssue(res); res.Body["error"] != "Data tidak valid: capacity" || issue["message"] != "Invalid input: expected int, received number" {
		t.Fatalf("huge capacity: %s", res.Raw)
	}
}
