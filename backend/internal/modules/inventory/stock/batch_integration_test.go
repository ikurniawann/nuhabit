package stock_test

import (
	"net/http"
	"strings"
	"testing"
)

// A usage with several items checks each one against its own stock row, in
// request order: the first short item is the one reported, an item without
// a stock row counts as 0 and an upper-case id still finds its row.
func TestSupplyUsageChecksEveryItem(t *testing.T) {
	e := setup(t)
	e.ScopeStaff("branch", e.org)
	supply := func(code string) string {
		return e.ID(`INSERT INTO item.supply_items (kode, nama, stockable, satuan_id, company_id, branch_id, stok_minimum)
			VALUES ($1||'-'||$2, $1, true, $3, $4, $5, 0) RETURNING id::text`, code, e.org.BranchID[:4], e.unitKg, e.org.CompanyID, e.org.BranchID)
	}
	tisu, sabun, lap := supply("TISU"), supply("SABUN"), supply("LAP")
	for item, qty := range map[string]float64{tisu: 12, sabun: 3.5} {
		e.Call("POST", "/api/purchasing/inventory/supply-adjustment", map[string]any{"supply_item_id": item, "warehouse_id": e.org.MainID, "qty_actual": qty}, http.StatusOK)
	}
	usage := func(lines ...any) map[string]any {
		return map[string]any{"warehouse_id": e.org.MainID, "items": lines}
	}
	line := func(item string, qty float64) map[string]any {
		return map[string]any{"supply_item_id": item, "qty": qty}
	}

	e.Fail("POST", "/api/purchasing/inventory/supply-usage", usage(line(tisu, 5), line(sabun, 4), line(lap, 1)),
		http.StatusBadRequest, "Stok tidak cukup untuk salah satu barang (tersedia 3.5, diminta 4)")
	e.Fail("POST", "/api/purchasing/inventory/supply-usage", usage(line(tisu, 5), line(lap, 1), line(sabun, 4)),
		http.StatusBadRequest, "Stok tidak cukup untuk salah satu barang (tersedia 0, diminta 1)")
	// Another warehouse holds none of the items.
	e.Fail("POST", "/api/purchasing/inventory/supply-usage", map[string]any{"warehouse_id": e.org.Stall1ID, "items": []any{line(tisu, 1)}},
		http.StatusBadRequest, "Stok tidak cukup untuk salah satu barang (tersedia 0, diminta 1)")

	e.Call("POST", "/api/purchasing/inventory/supply-usage", usage(line(strings.ToUpper(tisu), 5), line(sabun, 3.5)), http.StatusOK)
	var left string
	e.Scalar(&left, `SELECT string_agg(qty_available::float8::text, ',' ORDER BY qty_available DESC) FROM inventory.supply_inventory
		WHERE supply_item_id = ANY($1::uuid[])`, []string{tisu, sabun})
	if left != "7,0" {
		t.Fatalf("stock left %s", left)
	}
}
