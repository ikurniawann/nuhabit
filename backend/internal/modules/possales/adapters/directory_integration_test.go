package adapters

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/testutil"
)

// newUser inserts auth.users + configuration.users inside tx.
func newUser(t *testing.T, tx pgx.Tx, name, role string) string {
	t.Helper()
	id := mustID(t, tx, `INSERT INTO auth.users (email, password_hash) VALUES ($1, 'x') RETURNING id::text`, "dir-"+testutil.RandomHex(5)+"@test.local")
	mustExec(t, tx, `INSERT INTO configuration.users (id, full_name, role) VALUES ($1, $2, $3)`, id, name, role)
	return id
}

func TestDirectory(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	d := Directory{}
	venue := testutil.CreateOrg(t, tx)
	mustExec(t, tx, `INSERT INTO crm.crm_settings (key, value) VALUES ('default_company_id', to_jsonb($1::text)), ('default_branch_id', to_jsonb($2::text))
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, venue.CompanyID, venue.BranchID)

	if c, b := d.Venue(ctx, tx); c != venue.CompanyID || b != venue.BranchID {
		t.Fatalf("venue = %q %q", c, b)
	}
	mustExec(t, tx, `UPDATE crm.crm_settings SET value = '42'::jsonb WHERE key = 'default_branch_id'`)
	if c, b := d.Venue(ctx, tx); c != venue.CompanyID || b != "" {
		t.Fatalf("non-string venue = %q %q", c, b)
	}

	user := newUser(t, tx, "Kasir Satu", "pos")

	sfx := testutil.RandomHex(3)
	wa := mustID(t, tx, `INSERT INTO configuration.warehouses (branch_id, name, code, is_default) VALUES ($1, 'B Stall', $2, false) RETURNING id::text`, venue.BranchID, "WA"+sfx)
	wb := mustID(t, tx, `INSERT INTO configuration.warehouses (branch_id, name, code, is_default) VALUES ($1, 'A Stall', $2, false) RETURNING id::text`, venue.BranchID, "WB"+sfx)
	wDefault := mustID(t, tx, `INSERT INTO configuration.warehouses (branch_id, name, code, is_default) VALUES ($1, 'Z Stall', $2, true) RETURNING id::text`, venue.BranchID, "WC"+sfx)
	wOff := mustID(t, tx, `INSERT INTO configuration.warehouses (branch_id, name, code, is_active) VALUES ($1, 'Off', $2, false) RETURNING id::text`, venue.BranchID, "WD"+sfx)
	for _, w := range []string{wa, wb, wDefault, wOff} {
		mustExec(t, tx, `INSERT INTO configuration.user_warehouses (user_id, warehouse_id) VALUES ($1, $2)`, user, w)
	}
	assigned, err := d.AssignedWarehouses(ctx, tx, user)
	if err != nil || len(assigned) != 3 || assigned[0].ID != wDefault || !assigned[0].IsDefault || assigned[1].ID != wb || assigned[2].Name != "B Stall" || assigned[2].Code != "WA"+sfx {
		t.Fatalf("assigned = %+v %v", assigned, err)
	}
	branch, err := d.BranchWarehouses(ctx, tx, venue.BranchID)
	if err != nil || !hasWarehouse(branch, wa) || hasWarehouse(branch, wOff) {
		t.Fatalf("branch warehouses = %+v %v", branch, err)
	}
	if all, _ := d.BranchWarehouses(ctx, tx, ""); !hasWarehouse(all, wb) {
		t.Fatal("all warehouses")
	}
	if w, err := d.ActiveWarehouse(ctx, tx, wa); err != nil || w == nil || w.BranchID != venue.BranchID {
		t.Fatalf("active = %+v %v", w, err)
	}
	for _, id := range []string{wOff, "not-a-uuid", "00000000-0000-4000-8000-000000000001"} {
		if w, err := d.ActiveWarehouse(ctx, tx, id); w != nil || err != nil {
			t.Fatalf("active %s = %+v %v", id, w, err)
		}
	}

	if f, err := d.Flags(ctx, tx, user); err != nil || f.CanCentralCheckout || f.CanSwitchStall || f.DefaultWarehouseID != "" {
		t.Fatalf("flags = %+v %v", f, err)
	}
	mustExec(t, tx, `UPDATE configuration.users SET can_central_checkout = true, can_switch_stall = true, default_warehouse_id = $2 WHERE id = $1`, user, wa)
	if f, err := d.Flags(ctx, tx, user); err != nil || !f.CanCentralCheckout || !f.CanSwitchStall || f.DefaultWarehouseID != wa {
		t.Fatalf("flags = %+v %v", f, err)
	}
	if f, err := d.Flags(ctx, tx, "00000000-0000-4000-8000-000000000001"); err != nil || f.CanSwitchStall {
		t.Fatalf("unknown flags = %+v %v", f, err)
	}

	if id, _ := d.EmployeeID(ctx, tx, user); id != "" {
		t.Fatalf("employee before insert = %q", id)
	}
	emp := mustID(t, tx, `INSERT INTO hris.employees (full_name, nip, email, phone, join_date, user_id) VALUES ('Siti Kasir', $1, $2, '0811', current_date, $3) RETURNING id::text`,
		"NIP"+sfx, "emp-"+sfx+"@test.local", user)
	if id, err := d.EmployeeID(ctx, tx, user); id != emp || err != nil {
		t.Fatalf("employee id = %q %v", id, err)
	}
	if id, err := d.EmployeeID(ctx, tx, "bad"); id != "" || err != nil {
		t.Fatal("bad user id must be swallowed")
	}
	if n, _ := d.EmployeeName(ctx, tx, emp); n == nil || *n != "Siti Kasir" {
		t.Fatalf("employee name = %v", n)
	}
	if n, _ := d.UserName(ctx, tx, user); n == nil || *n != "Kasir Satu" {
		t.Fatalf("user name = %v", n)
	}
	if n, err := d.UserName(ctx, tx, "bad"); n != nil || err != nil {
		t.Fatal("bad id name")
	}

	sup := newUser(t, tx, "Pak Supervisor", "pos_supervisor")
	mustExec(t, tx, `UPDATE configuration.users SET pos_pin = 'hash', business_scope = 'company', company_id = $2 WHERE id = $1`, sup, venue.CompanyID)
	noPin := newUser(t, tx, "Tanpa PIN", "pos_supervisor")
	sups, err := d.ActiveSupervisors(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, s := range sups {
		if s.ID == noPin {
			t.Fatal("supervisor without PIN listed")
		}
		if s.ID == sup {
			found = s.PosPin == "hash" && s.FullName != nil && *s.FullName == "Pak Supervisor" && s.Scope != nil && s.Scope.CompanyID != nil && *s.Scope.CompanyID == venue.CompanyID
		}
	}
	if !found {
		t.Fatalf("supervisors = %+v", sups)
	}
}

func hasWarehouse(list []ports.Warehouse, id string) bool {
	for _, w := range list {
		if w.ID == id {
			return true
		}
	}
	return false
}

func TestDirectoryHasCentralMenu(t *testing.T) {
	db := testutil.DB(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	d := Directory{Auth: auth.NewService(db, log, time.Now, auth.Options{})}
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos.cashier.central": {"read"}}})
	if !d.HasCentralMenu(context.Background(), staff.UserID, staff.Role) {
		t.Fatal("granted central menu not seen")
	}
	if (Directory{}).HasCentralMenu(context.Background(), staff.UserID, staff.Role) {
		t.Fatal("no auth service must answer false")
	}
}
