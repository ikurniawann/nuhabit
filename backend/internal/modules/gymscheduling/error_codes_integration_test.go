package gymscheduling

import (
	"testing"
)

// expectCode checks a failure's stable code and params; the Indonesian text
// stays the "error" field.
func expectCode(t *testing.T, res response, status int, code string, params map[string]any) {
	t.Helper()
	if res.Status != status || res.Body["success"] != false || res.Body["code"] != code || res.Body["error"] == "" {
		t.Fatalf("want %d %s, got %d %s", status, code, res.Status, res.Raw)
	}
	got, _ := res.Body["params"].(map[string]any)
	for k, v := range params {
		if got[k] != v {
			t.Fatalf("%s: param %s = %v, want %v (%s)", code, k, got[k], v, res.Raw)
		}
	}
}

func TestBookingDenialCodes(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(2)
	first := f.session(typeID, wibDayAt(2, 10), 5)
	second := f.session(typeID, wibDayAt(3, 10), 5)
	m := f.member(3)

	if res := f.book(m, first); res.data()["status"] != "confirmed" {
		t.Fatalf("first booking: %s", res.Raw)
	}
	res := f.book(m, second)
	expectError(t, res, 409, "Kredit tidak cukup untuk kelas ini: tersedia 1, butuh 2 (2 kredit sudah terpakai untuk booking lain)")
	expectCode(t, res, 409, "BOOKING_INSUFFICIENT_CREDITS", map[string]any{"available": 1.0, "needed": 2.0, "reserved": 2.0})
	expectCode(t, f.book(m, first), 409, "BOOKING_ALREADY_BOOKED", nil)

	f.setRules(map[string]any{"maxBookingsPerDay": 1})
	evening := f.session(typeID, wibDayAt(2, 18), 5)
	expectCode(t, f.book(m, evening), 409, "BOOKING_DAILY_LIMIT", map[string]any{"max": 1.0})

	// Staff booking shares the codes.
	expectCode(t, f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": evening, "customer_id": m}), 409,
		"BOOKING_DAILY_LIMIT", map[string]any{"max": 1.0})

	expectCode(t, f.asMember(m, "DELETE", "/api/member-portal/gym/bookings/6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11", nil), 404,
		"BOOKING_NOT_FOUND", nil)
}
