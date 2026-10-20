package gymscheduling

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// asGrants serves a request as staffID holding only the given menu actions.
func (f *fixture) asGrants(staffID string, grants map[string][]string, method, target string, body any) response {
	f.t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(method, target, strings.NewReader(string(raw)))
	req.Header.Set("X-Test-Staff", staffID)
	grantJSON, _ := json.Marshal(grants)
	req.Header.Set("X-Test-Grants", string(grantJSON))
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
	return out
}

// A walk-in after the booking window closed: staff override books the seat,
// the desk search finds the booking for today, and check-in charges it.
func TestWalkInOverridesBookingWindow(t *testing.T) {
	f := newFixture(t)
	classTypeID, _ := f.classType(1)
	sessionID := f.session(classTypeID, time.Now().Add(-5*time.Minute), 5)
	member := f.member(3)

	book := map[string]any{"session_id": sessionID, "customer_id": member}
	expectError(t, f.asStaff("POST", "/api/gym/bookings", book), 409, "Booking kelas ini sudah ditutup")
	book["override_window"] = true
	res := f.asStaff("POST", "/api/gym/bookings", book)
	if res.Status != 200 || res.data()["status"] != "confirmed" {
		t.Fatalf("walk-in booking: %s", res.Raw)
	}
	bookingID := res.data()["bookingId"].(string)

	phone := f.scalar(`SELECT phone FROM pos.pos_customers WHERE id = $1`, member)
	hits := f.asStaff("GET", "/api/gym/checkin/members?q="+strings.TrimPrefix(phone, "+"), nil).list()
	if len(hits) != 1 {
		t.Fatalf("desk search: %v", hits)
	}
	today := hits[0].(map[string]any)["bookings"].([]any)
	if len(today) != 1 || today[0].(map[string]any)["id"] != bookingID {
		t.Fatalf("today's bookings: %v", today)
	}

	if res := f.asStaff("POST", "/api/gym/bookings/"+bookingID, map[string]any{"action": "check_in"}); res.Status != 200 || res.data()["decision"] != "allowed" {
		t.Fatalf("check-in: %s", res.Raw)
	}
	if got := f.balance(member); got != 2 {
		t.Fatalf("balance after check-in = %d, want 2", got)
	}
}

// A coach holding read_own sees only the sessions they coach.
func TestCoachSeesOwnSessions(t *testing.T) {
	// Created before the fixture: cleanups run last first, so the user row is
	// deleted after the transaction that references it rolls back.
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	f := newFixture(t)
	coach := f.asStaff("POST", "/api/gym/coaches", map[string]any{"name": "Go Coach " + testutil.RandomHex(3), "user_id": staff.UserID})
	coachID, _ := coach.data()["id"].(string)
	if coachID == "" {
		t.Fatalf("create coach: %s", coach.Raw)
	}
	classTypeID, _ := f.classType(1)
	start := time.Now().Add(2 * time.Hour)
	mine := f.session(classTypeID, start, 5)
	other := f.session(classTypeID, start.Add(time.Hour), 5)
	f.exec(`UPDATE gym.class_sessions SET coach_id = $2 WHERE id = $1`, mine, coachID)

	grants := map[string][]string{"gym.sessions": {"read_own"}, "gym.checkin": {"read", "create"}}
	listed := f.asGrants(staff.UserID, grants, "GET", "/api/gym/sessions", nil).list()
	if len(listed) != 1 || listed[0].(map[string]any)["id"] != mine {
		t.Fatalf("coach sessions: %v", listed)
	}
	if res := f.asGrants(staff.UserID, grants, "GET", "/api/gym/sessions/"+mine, nil); res.Status != 200 {
		t.Fatalf("own session: %s", res.Raw)
	}
	expectError(t, f.asGrants(staff.UserID, grants, "GET", "/api/gym/sessions/"+other, nil), 404, "Sesi tidak ditemukan")

	member := f.member(3)
	booking := f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": other, "customer_id": member}).data()["bookingId"].(string)
	expectError(t, f.asGrants(staff.UserID, grants, "POST", "/api/gym/bookings/"+booking, map[string]any{"action": "no_show"}), 404,
		"Booking tidak ditemukan")
	if res := f.asGrants(staff.UserID, grants, "POST", "/api/gym/sessions", map[string]any{}); res.Status != 403 {
		t.Fatalf("coach creating a session: %s", res.Raw)
	}

	if got := f.asStaff("GET", "/api/gym/coaches", nil).list(); !hasRow(got, "id", coachID, "user_name", staff.FullName) {
		t.Fatalf("coach list lacks the linked user: %v", got)
	}
	if res := f.asStaff("PATCH", "/api/gym/coaches/"+coachID, map[string]any{"user_id": nil}); res.Status != 200 {
		t.Fatalf("unlink: %s", res.Raw)
	}
	if got := f.scalar(`SELECT COALESCE(user_id::text, '') FROM gym.coaches WHERE id = $1`, coachID); got != "" {
		t.Fatalf("user_id after unlink = %q", got)
	}
}

func hasRow(rows []any, kv ...string) bool {
	for _, raw := range rows {
		row := raw.(map[string]any)
		match := true
		for i := 0; i+1 < len(kv); i += 2 {
			match = match && row[kv[i]] == kv[i+1]
		}
		if match {
			return true
		}
	}
	return false
}
