package resort

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Each route opens only to the sub-modules whose dashboard pages call it.
func TestSubModuleGuards(t *testing.T) {
	deps := testutil.Deps(t, nil)
	mux := testutil.Mux(New(deps, fixedVenue{newUUID(t), newUUID(t)}))
	role := func(code string) testutil.Staff {
		return testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{code: {"read", "create", "update", "delete"}}})
	}
	frontOffice, reservations, rooms := role("resort.front-office"), role("resort.reservations"), role("resort.rooms")
	status := func(method, path string, s testutil.Staff) int {
		rec, _ := testutil.Do(t, mux, testutil.AsStaff(testutil.Request(method, path, map[string]any{}), s))
		return rec.Code
	}
	cases := []struct {
		method, path string
		allowed      []testutil.Staff
		denied       []testutil.Staff
	}{
		{"GET", "/api/resort/front-office?date=2026-10-05", []testutil.Staff{frontOffice}, []testutil.Staff{reservations, rooms}},
		{"GET", "/api/resort/reservations", []testutil.Staff{reservations}, []testutil.Staff{frontOffice, rooms}},
		{"POST", "/api/resort/reservations", []testutil.Staff{reservations}, []testutil.Staff{frontOffice, rooms}},
		{"GET", "/api/resort/room-types", []testutil.Staff{rooms}, []testutil.Staff{frontOffice, reservations}},
		{"GET", "/api/resort/rooms", []testutil.Staff{rooms, reservations, frontOffice}, nil},
		{"POST", "/api/resort/rooms", []testutil.Staff{rooms}, []testutil.Staff{frontOffice, reservations}},
	}
	for _, c := range cases {
		for _, s := range c.allowed {
			if got := status(c.method, c.path, s); got == http.StatusUnauthorized || got == http.StatusForbidden {
				t.Errorf("%s %s: allowed role got %d", c.method, c.path, got)
			}
		}
		for _, s := range c.denied {
			if got := status(c.method, c.path, s); got != http.StatusForbidden {
				t.Errorf("%s %s: sibling role got %d, want 403", c.method, c.path, got)
			}
		}
	}
}
