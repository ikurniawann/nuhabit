package access

import (
	"encoding/json"
	"testing"

	"nuhabit/backend/internal/platform/validate"
)

func TestFilters(t *testing.T) {
	desc := "Kasir shift malam"
	roles := []roleItem{
		{Code: "pos", Name: "POS", IsActive: true, Description: &desc},
		{Code: "hrd", Name: "HRD", IsActive: false},
	}
	get := func(q map[string]string) func(string) string { return func(k string) string { return q[k] } }
	if got := filterRoles(roles, newListFilter(get(map[string]string{"search": " MALAM "}))); len(got) != 1 || got[0].Code != "pos" {
		t.Fatalf("search by description = %v", got)
	}
	if got := filterRoles(roles, newListFilter(get(map[string]string{"status": "Inactive"}))); len(got) != 1 || got[0].Code != "hrd" {
		t.Fatalf("status = %v", got)
	}
	if got := filterRoles(nil, newListFilter(get(nil))); got == nil || len(got) != 0 {
		t.Fatal("an empty result must render as []")
	}
	route, module := "/dashboard/pos", "POS"
	menus := []menuItem{{Code: "pos.sell", MenuName: "Jual", MenuType: "sidebar", IsActive: true, RoutePath: &route, Module: &module}, {Code: "grp", MenuName: "Grup", MenuType: "group"}}
	if got := filterMenus(menus, newListFilter(get(map[string]string{"menuType": "SIDEBAR", "search": "dashboard"}))); len(got) != 1 {
		t.Fatalf("menu filter = %v", got)
	}
}

func TestAvailableActions(t *testing.T) {
	for raw, want := range map[string]string{
		`{"actions":["read","approve"]}`: `["read","approve"]`,
		`{"actions":[]}`:                 `["read"]`,
		`{}`:                             `["read"]`,
		`{"actions":"x"}`:                `"x"`,
	} {
		got, _ := json.Marshal(availableActions([]byte(raw)))
		if string(got) != want {
			t.Errorf("availableActions(%s) = %s, want %s", raw, got, want)
		}
	}
}

func TestParsePermissions(t *testing.T) {
	var body any
	_ = json.Unmarshal([]byte(`{"permissions":[{"menuId":"a","grantedActions":["read","create"]},{"menuId":"b","isGranted":false},{"isGranted":true},{"menuId":"c","grantedActions":[]},{"menuId":"d"}]}`), &body)
	f := validate.New(body, true)
	got, _ := json.Marshal(parsePermissions(f))
	if !f.Valid() || string(got) != `[{"MenuID":"a","Actions":["read","create"]},{"MenuID":"c","Actions":["read"]},{"MenuID":"d","Actions":["read"]}]` {
		t.Fatalf("grants = %s (%v)", got, f.Issues())
	}
	f = validate.New(map[string]any{}, true)
	if got := parsePermissions(f); !f.Valid() || len(got) != 0 {
		t.Fatal("permissions defaults to []")
	}
}
