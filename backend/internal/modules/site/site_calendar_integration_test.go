package site_test

import (
	"net/http"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// Site events run the same calendar check as CRM events: a class in the
// room blocks the save until a staff member with update on site.events
// overrides it with a reason.
func TestSiteEventCalendarGuard(t *testing.T) {
	// The override row references the editor, so create them before the
	// transaction their cleanup must follow.
	editor := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"site.events": {"read", "create", "update"}}})
	e := setup(t)
	org := testutil.CreateOrg(t, e.tx)
	start, end := time.Date(2026, 11, 2, 3, 0, 0, 0, time.UTC), time.Date(2026, 11, 2, 4, 0, 0, 0, time.UTC)
	var classType string
	if err := e.tx.QueryRow(e.ctx, `INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ($1, 60, 1, 12) RETURNING id::text`, "Kelas "+testutil.RandomHex(3)).Scan(&classType); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO gym.class_sessions (class_type_id, branch_id, area, starts_at, ends_at, capacity, credit_cost,
	        booking_opens_at, booking_closes_at, status)
	      VALUES ($1, $2, 'Arena', $3, $4, 12, 1, $3, $3, 'published')`, classType, org.BranchID, start, end); err != nil {
		t.Fatal(err)
	}
	const path = "/api/site/events"
	body := map[string]any{"title": "Open House", "slug": "go-open-house-" + testutil.RandomHex(3), "starts_at": "2026-11-02T03:30:00Z",
		"branch_id": org.BranchID, "area": "arena", "status": "published"}

	out := e.call(&e.editor, "POST", path, body, http.StatusConflict)
	if out["code"] != "event_conflict" {
		t.Fatalf("room clash: %v", out)
	}
	body["override_reason"] = "Kelas digeser ke lapangan"
	e.call(&e.editor, "POST", path, body, http.StatusForbidden)
	created := e.call(&editor, "POST", path, body, http.StatusCreated)["data"].(map[string]any)
	if created["branch_name"] == nil || created["area"] != "arena" {
		t.Fatalf("created %v", created)
	}
	var n int
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*) FROM events.conflict_overrides WHERE site_event_id = $1 AND user_id = $2`,
		created["id"], editor.UserID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("override rows %d %v", n, err)
	}

	// Moving the event out of the room clears the clash; a two-hour default
	// end still overlaps the class, so the class warns.
	patched := e.call(&e.editor, "PATCH", path+"/"+created["id"].(string), map[string]any{"area": "Lobby"}, http.StatusOK)["data"].(map[string]any)
	if warnings := patched["warnings"].([]any); len(warnings) != 1 {
		t.Fatalf("branch warning on patch: %v", patched)
	}
	e.call(&e.editor, "PATCH", path+"/"+created["id"].(string), map[string]any{"area": "Arena"}, http.StatusConflict)
}
