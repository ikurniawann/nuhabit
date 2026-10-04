package app

import (
	"context"
	"strconv"

	"nuhabit/backend/internal/modules/procurement"
	"nuhabit/backend/internal/platform/database"
)

// procurementStock reads inventory's raw material stock views for the
// purchasing dashboard (rawMaterialStockSource: the per-warehouse view when
// a stall is active, else the aggregate one).
type procurementStock struct{ rr procurement.RowReader }

var _ procurement.StockAlerts = procurementStock{}

// lowStockWhere is `.in("status_stok", ["MENIPIS", "HABIS"])` plus the
// stall filter.
func lowStockWhere(warehouseID string) (string, []any) {
	if warehouseID == "" {
		return `"v_raw_materials_stock" WHERE "status_stok" IN ($1, $2)`, []any{"MENIPIS", "HABIS"}
	}
	return `"v_raw_materials_stock_by_warehouse" WHERE "status_stok" IN ($1, $2) AND "warehouse_id" = $3`,
		[]any{"MENIPIS", "HABIS", warehouseID}
}

func (procurementStock) LowStockCount(ctx context.Context, q database.Querier, warehouseID string) (int, error) {
	from, args := lowStockWhere(warehouseID)
	var n int
	err := q.QueryRow(ctx, `SELECT count(*)::int FROM `+from, args...).Scan(&n)
	return n, err
}

func (s procurementStock) LowStockItems(ctx context.Context, q database.Querier, warehouseID string) ([]*procurement.Row, error) {
	from, args := lowStockWhere(warehouseID)
	return s.rr.Query(ctx, q, `SELECT "id", "nama", "kategori", "qty_onhand", "min_stock", "satuan" FROM `+from+
		` ORDER BY "qty_onhand" ASC LIMIT $`+strconv.Itoa(len(args)+1), append(args, 10)...)
}
