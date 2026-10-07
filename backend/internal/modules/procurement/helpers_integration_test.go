package procurement_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/procurement"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run every write in one transaction that is rolled back;
// staff sessions are committed by testutil and removed on cleanup.

type env struct {
	t   *testing.T
	ctx context.Context
	tx  pgx.Tx
	mux *http.ServeMux
}

func newEnv(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, nil)
	tx := testutil.Tx(t)
	ports := app.ProcurementPorts(procurement.Location(deps.Config.TimeZone), deps.Now)
	return &env{t: t, ctx: context.Background(), tx: tx, mux: testutil.Mux(procurement.NewOn(deps, tx, ports))}
}

// staff creates a user holding the given menu grants.
func (e *env) staff(menus map[string][]string, opts ...func(*testutil.StaffOptions)) testutil.Staff {
	o := testutil.StaffOptions{Role: "purchasing_staff", Menus: menus}
	for _, f := range opts {
		f(&o)
	}
	s := testutil.CreateStaff(e.t, o)
	// Cleanups run last-in first-out: roll the fixtures back before the
	// staff rows they reference are deleted, or the delete waits on the tx.
	e.t.Cleanup(func() { _ = e.tx.Rollback(context.Background()) })
	return s
}

type resp struct {
	Status int
	Body   map[string]any
	Raw    string
}

func (r resp) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }
func (r resp) list() []any          { l, _ := r.Body["data"].([]any); return l }

func (e *env) do(s *testutil.Staff, method, target string, body any) resp {
	e.t.Helper()
	req := testutil.Request(method, target, body)
	if s != nil {
		req = testutil.AsStaff(req, *s)
	}
	// A failed statement aborts the shared test transaction; each request
	// runs in a savepoint that is rolled back when the request failed.
	e.exec(`SAVEPOINT request`)
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	if rec.Code >= 400 {
		e.exec(`ROLLBACK TO SAVEPOINT request`)
	}
	e.exec(`RELEASE SAVEPOINT request`)
	var parsed map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
	return resp{Status: rec.Code, Body: parsed, Raw: rec.Body.String()}
}

func (e *env) expect(r resp, status int, msg string) {
	e.t.Helper()
	if r.Status != status {
		e.t.Fatalf("status = %d, want %d: %s", r.Status, status, r.Raw)
	}
	if msg != "" && r.Body["error"] != msg {
		e.t.Fatalf("error = %v, want %q", r.Body["error"], msg)
	}
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.tx.Exec(e.ctx, sql, args...); err != nil {
		e.t.Fatalf("exec %s: %v", sql, err)
	}
}

func (e *env) id(sql string, args ...any) string {
	e.t.Helper()
	var id string
	if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(&id); err != nil {
		e.t.Fatalf("query %s: %v", sql, err)
	}
	return id
}

func (e *env) scalar(sql string, args ...any) any {
	e.t.Helper()
	var v any
	if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(&v); err != nil {
		e.t.Fatalf("query %s: %v", sql, err)
	}
	return v
}

func suffix() string { return strings.ToUpper(testutil.RandomHex(3)) }

// fixtures is the master data a purchasing flow needs.
type fixtures struct {
	Department, Unit, BigUnit, Material, Supplier, Vendor string
}

func (e *env) fixtures() fixtures {
	s := suffix()
	f := fixtures{}
	f.Department = e.id(`INSERT INTO hris.departments (name, code) VALUES ('Dept '||$1, 'GT'||$1) RETURNING id::text`, s)
	f.Unit = e.id(`INSERT INTO item.units (kode, nama, tipe) VALUES ('GTU'||$1, 'gram '||$1, 'KECIL') RETURNING id::text`, s)
	f.BigUnit = e.id(`INSERT INTO item.units (kode, nama, tipe) VALUES ('GTK'||$1, 'kg '||$1, 'BESAR') RETURNING id::text`, s)
	f.Material = e.id(`INSERT INTO item.raw_materials (kode, nama, kategori, satuan_besar_id, satuan_kecil_id, konversi_factor, harga_beli)
		VALUES ('GTRM'||$1, 'Gula '||$1, 'bahan', $2, $3, 1000, 15000) RETURNING id::text`, s, f.BigUnit, f.Unit)
	f.Supplier = e.id(`INSERT INTO purchasing.suppliers (kode, nama_supplier) VALUES ('GTS'||$1, 'Supplier '||$1) RETURNING id::text`, s)
	f.Vendor = e.id(`INSERT INTO purchasing.vendors (code, name, contact_person, phone, email, address, category)
		VALUES ('GTV'||$1, 'Vendor '||$1, 'Budi', '0812', 'v@test.local', 'Jl', 'other') RETURNING id::text`, s)
	return f
}

var itemsAll = map[string][]string{
	"items":                            {"read", "create", "update", "delete"},
	"items.raw-material.purchasing.pr": {"read", "create", "update"},
	"items.raw-material.approval.pr":   {"read", "update"},
	"items.raw-material.approval":      {"read", "update"},
}

func today() string { return time.Now().In(procurement.Location("")).Format("20060102") }
