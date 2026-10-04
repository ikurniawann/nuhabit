// Package kittest sets up inventory integration tests: a staff session with
// IAM menus, one rolled-back transaction that every handler and fixture
// shares, and fixture builders for the org tree and item masters.
package kittest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/stall"
	"nuhabit/backend/internal/platform/testutil"
)

// T is one test's environment.
type T struct {
	*testing.T
	Ctx   context.Context
	Tx    pgx.Tx
	Deps  module.Deps
	Env   kit.Env
	Staff testutil.Staff
	Mux   *http.ServeMux
	// Cookies are added to every request (e.g. the active stall cookie).
	Cookies []*http.Cookie
}

// Menus grants the IAM inventory and items prefixes most routes need.
var Menus = map[string][]string{
	"items":                        {"read", "create", "update", "delete"},
	"items.raw-material.inventory": nil,
	"items.product.inventory":      nil,
}

// Setup opens the transaction and a staff session (role "admin" unless
// role is given). now may be nil.
func Setup(t *testing.T, menus map[string][]string, now func() time.Time, role ...string) *T {
	t.Helper()
	deps := testutil.Deps(t, now)
	opts := testutil.StaffOptions{Menus: menus, Role: "admin"}
	if len(role) > 0 {
		opts.Role = role[0]
	}
	staff := testutil.CreateStaff(t, opts)
	ctx := context.Background()
	tx, err := deps.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	return &T{T: t, Ctx: ctx, Tx: tx, Deps: deps, Env: kit.NewEnv(deps, tx), Staff: staff}
}

// Mount serves routes for the following calls.
func (e *T) Mount(routes []module.Route) {
	e.Mux = http.NewServeMux()
	for _, r := range routes {
		e.Mux.Handle(r.Pattern, r.Handler)
	}
}

// Exec runs sql on the test transaction.
func (e *T) Exec(sql string, args ...any) {
	e.Helper()
	if _, err := e.Tx.Exec(e.Ctx, sql, args...); err != nil {
		e.Fatalf("exec %q: %v", sql, err)
	}
}

// Scalar scans one value.
func (e *T) Scalar(dst any, sql string, args ...any) {
	e.Helper()
	if err := e.Tx.QueryRow(e.Ctx, sql, args...).Scan(dst); err != nil {
		e.Fatalf("query %q: %v", sql, err)
	}
}

// ID inserts and returns the id (sql must RETURNING id::text).
func (e *T) ID(sql string, args ...any) string {
	e.Helper()
	var id string
	e.Scalar(&id, sql, args...)
	return id
}

// Do serves a staff request and returns the recorder. Each request runs
// under a savepoint that is rolled back when it fails (status >= 400), so a
// failed statement does not abort the shared test transaction; in
// production every request has its own pool connection.
func (e *T) Do(method, path string, body any) *httptest.ResponseRecorder {
	e.Helper()
	r := testutil.AsStaff(testutil.Request(method, path, body), e.Staff)
	for _, c := range e.Cookies {
		r.AddCookie(c)
	}
	e.Exec(`SAVEPOINT kittest_request`)
	rec := httptest.NewRecorder()
	e.Mux.ServeHTTP(rec, r)
	if rec.Code >= 400 {
		e.Exec(`ROLLBACK TO SAVEPOINT kittest_request`)
	}
	e.Exec(`RELEASE SAVEPOINT kittest_request`)
	return rec
}

// Call serves a staff request, checks the status and decodes the body.
func (e *T) Call(method, path string, body any, status int) map[string]any {
	e.Helper()
	rec := e.Do(method, path, body)
	if rec.Code != status {
		e.Fatalf("%s %s: status %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return out
}

// Fail checks an error envelope.
func (e *T) Fail(method, path string, body any, status int, msg string) map[string]any {
	e.Helper()
	out := e.Call(method, path, body, status)
	if out["success"] != false || out["error"] != msg {
		e.Fatalf("%s %s: %v, want error %q", method, path, out, msg)
	}
	return out
}

// Org is a holding → company → branch with a MAIN storage and two stalls.
type Org struct {
	HoldingID, CompanyID, BranchID string
	MainID, Stall1ID, Stall2ID     string
}

// NewOrg creates the org tree inside the transaction.
func (e *T) NewOrg() Org {
	e.Helper()
	sfx := testutil.RandomHex(4)
	var o Org
	o.HoldingID = e.ID(`INSERT INTO configuration.holdings (name, code) VALUES ('H '||$1, 'H'||$1) RETURNING id::text`, sfx)
	o.CompanyID = e.ID(`INSERT INTO configuration.companies (holding_id, name, code) VALUES ($1, 'C '||$2, 'C'||$2) RETURNING id::text`, o.HoldingID, sfx)
	o.BranchID = e.ID(`INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, 'B '||$2, 'B'||$2) RETURNING id::text`, o.CompanyID, sfx)
	// trg_branch_default_warehouse creates the MAIN storage.
	o.MainID = e.ID(`SELECT id::text FROM configuration.warehouses WHERE branch_id = $1 AND code = 'MAIN'`, o.BranchID)
	o.Stall1ID = e.ID(`INSERT INTO configuration.warehouses (branch_id, name, code) VALUES ($1, 'Stall 1', 'STALL-01') RETURNING id::text`, o.BranchID)
	o.Stall2ID = e.ID(`INSERT INTO configuration.warehouses (branch_id, name, code) VALUES ($1, 'Stall 2', 'STALL-02') RETURNING id::text`, o.BranchID)
	return o
}

// ScopeStaff sets the staff profile's business scope inside the
// transaction (level "" clears it, making the user unscoped).
func (e *T) ScopeStaff(level string, o Org) {
	e.Helper()
	var lvl any
	if level != "" {
		lvl = level
	}
	e.Exec(`UPDATE configuration.users SET business_scope = $2, holding_id = $3, company_id = $4, branch_id = $5 WHERE id = $1`,
		e.Staff.UserID, lvl, o.HoldingID, o.CompanyID, o.BranchID)
}

// ActiveStall sets the sidebar stall cookie for the following requests.
func (e *T) ActiveStall(warehouseID string) {
	e.Cookies = append(e.Cookies, &http.Cookie{Name: stall.CookieName, Value: warehouseID})
}

// Unit creates an item.units row.
func (e *T) Unit(kode, nama string) string {
	e.Helper()
	return e.ID(`INSERT INTO item.units (kode, nama, tipe) VALUES ($1, $2, 'BESAR') RETURNING id::text`, kode+testutil.RandomHex(2), nama)
}

// RawMaterial creates an item.raw_materials row in the org's branch.
func (e *T) RawMaterial(o Org, kode, nama string, bigUnit, smallUnit string, factor float64) string {
	e.Helper()
	var small any
	if smallUnit != "" {
		small = smallUnit
	}
	return e.ID(`INSERT INTO item.raw_materials (kode, nama, kategori, satuan_besar_id, satuan_kecil_id, konversi_factor,
		stok_minimum, company_id, branch_id, harga_beli)
		VALUES ($1, $2, 'Bahan', $3, $4, $5, 5, $6, $7, 1000) RETURNING id::text`,
		kode, nama, bigUnit, small, factor, o.CompanyID, o.BranchID)
}

// Stock creates an inventory.inventory row.
func (e *T) Stock(o Org, rawMaterialID, warehouseID string, qty, unitCost float64) string {
	e.Helper()
	return e.ID(`INSERT INTO inventory.inventory (raw_material_id, qty_available, unit_cost, branch_id, warehouse_id)
		VALUES ($1, $2, $3, $4, $5) RETURNING id::text`, rawMaterialID, qty, unitCost, o.BranchID, warehouseID)
}

// Product creates an item.products row on a stall.
func (e *T) Product(o Org, warehouseID, kode, nama string, hargaModal float64) string {
	e.Helper()
	return e.ID(`INSERT INTO item.products (kode, nama, harga_jual, harga_modal, company_id, branch_id, warehouse_id)
		VALUES ($1, $2, 15000, $3, $4, $5, $6) RETURNING id::text`, kode, nama, hargaModal, o.CompanyID, o.BranchID, warehouseID)
}

// Ptr returns &v.
func Ptr[V any](v V) *V { return &v }
