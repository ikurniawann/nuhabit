package promo

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

type fakeGymPackages []GymPackage

func (f fakeGymPackages) List(context.Context, database.Querier) ([]GymPackage, error) { return f, nil }

// The campaign form lists gym packages through the promo module: reading
// the campaigns is enough, a gym menu is not needed, and a role without
// read on promo is turned away.
func TestGymPackagesRoute(t *testing.T) {
	e := setup(t)
	e.expect("GET", "/api/promo/gym-packages", nil, 200, `{"success":true,"data":[]}`)

	e.svc.ports.GymPackages = fakeGymPackages{
		{ID: "11111111-1111-1111-1111-111111111111", Name: "10 Visit", Kind: "credits", Status: "active"},
		{ID: "22222222-2222-2222-2222-222222222222", Name: "Pass Bulanan", Kind: "pass", Status: "archived"},
	}
	e.expect("GET", "/api/promo/gym-packages", nil, 200,
		`{"success":true,"data":[{"id":"11111111-1111-1111-1111-111111111111","name":"10 Visit","kind":"credits","status":"active"},`+
			`{"id":"22222222-2222-2222-2222-222222222222","name":"Pass Bulanan","kind":"pass","status":"archived"}]}`)

	reader := e.staff
	e.staff = testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm.promo": {"update"}}})
	e.call("GET", "/api/promo/gym-packages", nil, 403)
	e.staff = testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"gym.packages": {"read"}}})
	e.call("GET", "/api/promo/gym-packages", nil, 403)
	e.staff = reader
}
