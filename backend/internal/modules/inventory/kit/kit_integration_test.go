package kit_test

import (
	ps "nuhabit/backend/internal/platform/scope"
	"testing"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/kit/kittest"
)

func TestScopeAndStall(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	o := e.NewOrg()
	e.ScopeStaff("branch", o)
	s, err := ps.Load(e.Ctx, e.Tx, e.Staff.UserID)
	if err != nil || s.Unscoped || kit.Deref(s.BranchID) != o.BranchID || kit.Deref(ps.BranchFilter(s)) != o.BranchID {
		t.Fatalf("scope %+v %v", s, err)
	}
	branch, werr, err := kit.ValidateWarehouse(e.Ctx, e.Tx, o.Stall1ID, s, nil)
	if err != nil || werr != "" || branch != o.BranchID {
		t.Fatalf("validate %q %q %v", branch, werr, err)
	}
	pw, msg, err := kit.ValidateProductWarehouse(e.Ctx, e.Tx, o.Stall2ID, s)
	if err != nil || msg != "" || pw.CompanyID != o.CompanyID {
		t.Fatalf("product warehouse %+v %q %v", pw, msg, err)
	}
	// Admin can switch stalls: no cookie and no placement means "all".
	r := e.Do // keep the helper referenced
	_ = r
	rm := e.RawMaterial(o, "RM-1", "Gula", e.Unit("KG", "Kilogram"), "", 1)
	e.Stock(o, rm, o.MainID, 10, 1500)
	rows, err := kit.Query(e.Ctx, e.Tx, `SELECT qty_available, unit_cost, created_at, 5::int4 AS n, 7::int8 AS b FROM inventory.inventory WHERE raw_material_id = $1`, rm)
	if err != nil || len(rows) != 1 {
		t.Fatal(err)
	}
	b, _ := rows[0].MarshalJSON()
	got := string(b)
	if rows[0].Str("qty_available") != "10.000" || rows[0].Str("unit_cost") != "1500.00" || rows[0].Str("b") != "7" {
		t.Fatalf("row %s", got)
	}
}
