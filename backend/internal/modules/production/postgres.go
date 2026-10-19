package production

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/production/domain"
	"nuhabit/backend/internal/platform/database"
)

// Postgres is the Repository over the manufacturing tables and the
// v_production_orders read model. It touches no inventory or item table.
type Postgres struct{}

var _ Repository = Postgres{}

const orderCols = `po.id::text, po.nomor_produksi, po.status, po.production_context, po.output_type,
	po.product_id::text, po.output_raw_material_id::text, COALESCE(v.item_kode, ''), COALESCE(v.item_nama, ''),
	po.planned_qty::float8, po.actual_qty::float8, po.planned_material_cost::float8, po.actual_material_cost::float8,
	po.overhead_cost::float8, po.labor_cost::float8, po.packaging_cost::float8, po.waste_cost::float8,
	po.hpp_per_unit::float8, po.company_id::text, po.branch_id::text, po.started_at, po.completed_at, po.created_at,
	po.parent_order_id::text, (SELECT p.nomor_produksi FROM manufacturing.production_orders p WHERE p.id = po.parent_order_id)`

func (Postgres) Order(ctx context.Context, q database.Querier, id string, lock bool) (*Order, error) {
	if lock {
		if _, err := q.Exec(ctx, `SELECT 1 FROM manufacturing.production_orders WHERE id = $1 FOR UPDATE`, id); err != nil {
			return nil, err
		}
	}
	var o Order
	err := q.QueryRow(ctx, `SELECT `+orderCols+` FROM manufacturing.production_orders po
		JOIN v_production_orders v ON v.id = po.id WHERE po.id = $1`, id).Scan(
		&o.ID, &o.Number, &o.Status, &o.Context, &o.OutputType, &o.ProductID, &o.OutputRawMaterialID, &o.ItemKode, &o.ItemNama,
		&o.PlannedQty, &o.ActualQty, &o.PlannedMaterialCost, &o.ActualMaterialCost,
		&o.Overhead, &o.Labor, &o.Packaging, &o.Waste, &o.HppPerUnit, &o.CompanyID, &o.BranchID,
		&o.StartedAt, &o.CompletedAt, &o.CreatedAt, &o.ParentOrderID, &o.ParentNumber)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &o, err
}

func (Postgres) Lines(ctx context.Context, q database.Querier, orderID string) ([]MaterialLine, error) {
	rows, err := q.Query(ctx, `SELECT id::text, raw_material_id::text, qty_planned::float8, unit_cost::float8,
		qty_issued::float8, issued_cost::float8, qty_returned::float8, returned_cost::float8,
		recipe_qty::float8, recipe_satuan_id::text, unit_factor::float8
		FROM manufacturing.production_order_materials WHERE production_order_id = $1 ORDER BY created_at, id`, orderID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (MaterialLine, error) {
		var l MaterialLine
		err := r.Scan(&l.ID, &l.RawMaterialID, &l.QtyPlanned, &l.UnitCost, &l.QtyIssued, &l.IssuedCost, &l.QtyReturned, &l.ReturnedCost,
			&l.RecipeQty, &l.RecipeUnitID, &l.UnitFactor)
		return l, err
	})
}

func (Postgres) Issues(ctx context.Context, q database.Querier, orderID string) ([]Issue, error) {
	return documents(ctx, q, orderID, "production_issues", "nomor_issue", "production_issue_lines", "issue_id")
}

func (Postgres) Returns(ctx context.Context, q database.Querier, orderID string) ([]Return, error) {
	docs, err := documents(ctx, q, orderID, "production_returns", "nomor_return", "production_return_lines", "return_id")
	out := make([]Return, len(docs))
	for i, d := range docs {
		out[i] = Return(d)
	}
	return out, err
}

// documents reads the issues or returns of an order with their lines.
func documents(ctx context.Context, q database.Querier, orderID, table, numberCol, lineTable, docCol string) ([]Issue, error) {
	rows, err := q.Query(ctx, `SELECT id::text, `+numberCol+`, total_cost::float8, catatan, created_at
		FROM manufacturing.`+table+` WHERE production_order_id = $1 ORDER BY created_at, `+numberCol, orderID)
	if err != nil {
		return nil, err
	}
	issues, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Issue, error) {
		var i Issue
		err := r.Scan(&i.ID, &i.Number, &i.TotalCost, &i.Catatan, &i.CreatedAt)
		i.Lines = []IssueLine{}
		return i, err
	})
	if err != nil || len(issues) == 0 {
		return issues, err
	}
	rows, err = q.Query(ctx, `SELECT l.`+docCol+`::text, l.production_order_material_id::text, l.raw_material_id::text,
		l.qty::float8, l.unit_cost::float8, l.total_cost::float8, l.inventory_movement_id::text, l.warehouse_id::text
		FROM manufacturing.`+lineTable+` l
		JOIN manufacturing.`+table+` i ON i.id = l.`+docCol+`
		WHERE i.production_order_id = $1 ORDER BY l.created_at, l.id`, orderID)
	if err != nil {
		return nil, err
	}
	byID := map[string]int{}
	for i, is := range issues {
		byID[is.ID] = i
	}
	var issueID string
	var l IssueLine
	_, err = pgx.ForEachRow(rows, []any{&issueID, &l.MaterialLineID, &l.RawMaterialID, &l.Qty, &l.UnitCost, &l.TotalCost,
		&l.MovementID, &l.WarehouseID}, func() error {
		if i, ok := byID[issueID]; ok {
			issues[i].Lines = append(issues[i].Lines, l)
		}
		return nil
	})
	return issues, err
}

const batchCols = `b.id::text, b.production_order_id::text, b.batch_number, b.output_type, b.wip_raw_material_id::text,
	b.qty_produced::float8, b.qty_scrap::float8, b.qty_scrap_abnormal::float8, b.hpp_per_unit::float8, b.total_cost::float8,
	b.material_cost::float8, b.conversion_cost::float8, b.scrap_cost::float8, b.abnormal_material_cost::float8,
	b.abnormal_conversion_cost::float8, b.scrap_tolerance_pct::float8, b.is_final, b.catatan, b.created_at`

func scanBatch(r pgx.Row, b *Batch, extra ...any) error {
	return r.Scan(append([]any{&b.ID, &b.OrderID, &b.Number, &b.OutputType, &b.WipRawMaterialID, &b.QtyGood, &b.QtyScrap, &b.QtyAbnormal,
		&b.HppPerUnit, &b.TotalCost, &b.MaterialCost, &b.ConversionCost, &b.ScrapCost, &b.AbnormalMaterial, &b.AbnormalConversion,
		&b.ScrapTolerancePct, &b.IsFinal, &b.Catatan, &b.CreatedAt}, extra...)...)
}

func (Postgres) Batches(ctx context.Context, q database.Querier, orderID string) ([]Batch, error) {
	rows, err := q.Query(ctx, `SELECT `+batchCols+` FROM manufacturing.production_batches b
		WHERE b.production_order_id = $1 ORDER BY b.created_at, b.batch_number`, orderID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Batch, error) {
		var b Batch
		err := scanBatch(r, &b)
		return b, err
	})
}

func (Postgres) InsertIssue(ctx context.Context, q database.Querier, orderID, number string, catatan *string, userID string) (Issue, error) {
	i := Issue{Number: number, Catatan: catatan, Lines: []IssueLine{}}
	err := q.QueryRow(ctx, `INSERT INTO manufacturing.production_issues (production_order_id, nomor_issue, catatan, created_by)
		VALUES ($1, $2, $3, $4) RETURNING id::text, created_at`, orderID, number, catatan, null(userID)).Scan(&i.ID, &i.CreatedAt)
	return i, err
}

// InsertIssueLine writes the line and adds it to its order line's running
// qty_issued and issued_cost.
func (Postgres) InsertIssueLine(ctx context.Context, q database.Querier, issueID string, l IssueLine) error {
	if _, err := q.Exec(ctx, `INSERT INTO manufacturing.production_issue_lines (issue_id, production_order_material_id,
		raw_material_id, qty, unit_cost, total_cost, inventory_movement_id, warehouse_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, issueID, l.MaterialLineID, l.RawMaterialID, l.Qty, l.UnitCost, l.TotalCost,
		l.MovementID, l.WarehouseID); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `UPDATE manufacturing.production_order_materials
		SET qty_issued = qty_issued + $2, issued_cost = issued_cost + $3, updated_at = now() WHERE id = $1`,
		l.MaterialLineID, l.Qty, l.TotalCost)
	return err
}

func (Postgres) InsertReturn(ctx context.Context, q database.Querier, orderID, number string, catatan *string, userID string) (Return, error) {
	r := Return{Number: number, Catatan: catatan, Lines: []IssueLine{}}
	err := q.QueryRow(ctx, `INSERT INTO manufacturing.production_returns (production_order_id, nomor_return, catatan, created_by)
		VALUES ($1, $2, $3, $4) RETURNING id::text, created_at`, orderID, number, catatan, null(userID)).Scan(&r.ID, &r.CreatedAt)
	return r, err
}

// InsertReturnLine writes the line and adds it to its order line's running
// qty_returned and returned_cost.
func (Postgres) InsertReturnLine(ctx context.Context, q database.Querier, returnID string, l IssueLine) error {
	if _, err := q.Exec(ctx, `INSERT INTO manufacturing.production_return_lines (return_id, production_order_material_id,
		raw_material_id, qty, unit_cost, total_cost, inventory_movement_id, warehouse_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, returnID, l.MaterialLineID, l.RawMaterialID, l.Qty, l.UnitCost, l.TotalCost,
		l.MovementID, l.WarehouseID); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `UPDATE manufacturing.production_order_materials
		SET qty_returned = qty_returned + $2, returned_cost = returned_cost + $3, updated_at = now() WHERE id = $1`,
		l.MaterialLineID, l.Qty, l.TotalCost)
	return err
}

func (Postgres) SetReturnTotal(ctx context.Context, q database.Querier, returnID string, total float64) error {
	_, err := q.Exec(ctx, `UPDATE manufacturing.production_returns SET total_cost = $2 WHERE id = $1`, returnID, total)
	return err
}

func (Postgres) SetIssueTotal(ctx context.Context, q database.Querier, issueID string, total float64) error {
	_, err := q.Exec(ctx, `UPDATE manufacturing.production_issues SET total_cost = $2 WHERE id = $1`, issueID, total)
	return err
}

// MarkIssued refreshes the actual material cost from the issued totals net
// of returns and starts a released order.
func (Postgres) MarkIssued(ctx context.Context, q database.Querier, orderID, userID string, start bool, now time.Time) error {
	_, err := q.Exec(ctx, `UPDATE manufacturing.production_orders SET
		actual_material_cost = (SELECT COALESCE(sum(issued_cost - returned_cost), 0) FROM manufacturing.production_order_materials
			WHERE production_order_id = $1),
		status = CASE WHEN $2 THEN 'IN_PROGRESS' ELSE status END,
		started_at = CASE WHEN $2 THEN COALESCE(started_at, $3) ELSE started_at END,
		updated_by = $4, updated_at = $3
		WHERE id = $1`, orderID, start, now, null(userID))
	return err
}

func (Postgres) InsertBatch(ctx context.Context, q database.Querier, o *Order, b Batch, userID string) (Batch, error) {
	err := q.QueryRow(ctx, `INSERT INTO manufacturing.production_batches (production_order_id, product_id,
		output_raw_material_id, batch_number, output_type, wip_raw_material_id, qty_produced, qty_scrap, hpp_per_unit,
		total_cost, material_cost, conversion_cost, scrap_cost, is_final, catatan, created_by, qty_scrap_abnormal,
		abnormal_material_cost, abnormal_conversion_cost, scrap_tolerance_pct)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
		RETURNING id::text, created_at`,
		o.ID, o.ProductID, o.OutputRawMaterialID, b.Number, b.OutputType, b.WipRawMaterialID, b.QtyGood, b.QtyScrap,
		b.HppPerUnit, b.TotalCost, b.MaterialCost, b.ConversionCost, b.ScrapCost, b.IsFinal, b.Catatan, null(userID),
		b.QtyAbnormal, b.AbnormalMaterial, b.AbnormalConversion, b.ScrapTolerancePct).
		Scan(&b.ID, &b.CreatedAt)
	b.OrderID = o.ID
	return b, err
}

func (Postgres) InsertVariants(ctx context.Context, q database.Querier, orderID, batchID, userID string, rows []domain.Variant) error {
	for _, v := range rows {
		if _, err := q.Exec(ctx, `INSERT INTO manufacturing.production_output_variants
			(production_order_id, production_batch_id, pos_sku_id, qty, created_by) VALUES ($1, $2, $3, $4, $5)`,
			orderID, batchID, v.SkuID, v.Qty, null(userID)); err != nil {
			return err
		}
	}
	return nil
}

func (Postgres) Variants(ctx context.Context, q database.Querier, batchID string) ([]domain.Variant, error) {
	rows, err := q.Query(ctx, `SELECT pos_sku_id::text, qty::float8 FROM manufacturing.production_output_variants
		WHERE production_batch_id = $1 ORDER BY created_at, id`, batchID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Variant, error) {
		var v domain.Variant
		err := r.Scan(&v.SkuID, &v.Qty)
		return v, err
	})
}

func (Postgres) SaveOutcome(ctx context.Context, q database.Querier, orderID string, o Outcome) error {
	_, err := q.Exec(ctx, `UPDATE manufacturing.production_orders SET
		actual_qty = $2, hpp_per_unit = $3, overhead_cost = $4, labor_cost = $5, packaging_cost = $6, waste_cost = $7,
		status = CASE WHEN $8 THEN 'COMPLETED' ELSE status END,
		completed_at = CASE WHEN $8 THEN $9 ELSE completed_at END,
		updated_by = $10, updated_at = $9
		WHERE id = $1`, orderID, o.ActualQty, o.HppPerUnit, o.Overhead, o.Labor, o.Packaging, o.Waste, o.Complete, o.Now, null(o.UserID))
	return err
}

func recipes(ctx context.Context, q database.Querier, sql string, ids []string) (map[string][]domain.Component, error) {
	out := map[string][]domain.Component{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, sql, ids)
	if err != nil {
		return nil, err
	}
	var owner string
	var c domain.Component
	_, err = pgx.ForEachRow(rows, []any{&owner, &c.RawMaterialID, &c.QtyPer, &c.WasteFactor, &c.SatuanID}, func() error {
		out[owner] = append(out[owner], c)
		return nil
	})
	return out, err
}

func (Postgres) ProductRecipes(ctx context.Context, q database.Querier, productIDs []string) (map[string][]domain.Component, error) {
	return recipes(ctx, q, `SELECT product_id::text, raw_material_id::text, qty_required::float8, COALESCE(waste_factor, 0)::float8,
		COALESCE(satuan_id::text, '')
		FROM manufacturing.bom_items WHERE product_id = ANY($1::uuid[]) AND is_active = true AND raw_material_id IS NOT NULL
		ORDER BY created_at, id`, productIDs)
}

func (Postgres) MaterialRecipes(ctx context.Context, q database.Querier, ids []string) (map[string][]domain.Component, error) {
	return recipes(ctx, q, `SELECT output_raw_material_id::text, component_raw_material_id::text, qty_required::float8,
		COALESCE(waste_factor, 0)::float8, COALESCE(satuan_id::text, '')
		FROM manufacturing.raw_material_bom_items WHERE output_raw_material_id = ANY($1::uuid[]) AND is_active = true
		ORDER BY created_at, id`, ids)
}

// column is the recipe_settings column and id of a recipe owner.
func (o RecipeOwner) column() (string, *string) {
	if o.RawMaterialID != nil {
		return "raw_material_id", o.RawMaterialID
	}
	return "product_id", o.ProductID
}

func (Postgres) RecipeSettings(ctx context.Context, q database.Querier, owner RecipeOwner) (*RecipeSettings, error) {
	col, id := owner.column()
	if id == nil {
		return nil, nil
	}
	var r RecipeSettings
	err := q.QueryRow(ctx, `SELECT scrap_tolerance_pct::float8, batch_size::float8 FROM manufacturing.recipe_settings WHERE `+col+` = $1`, *id).
		Scan(&r.ScrapTolerancePct, &r.BatchSize)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &r, err
}

func (Postgres) SaveRecipeSettings(ctx context.Context, q database.Querier, owner RecipeOwner, r RecipeSettings, userID string) error {
	col, id := owner.column()
	_, err := q.Exec(ctx, `INSERT INTO manufacturing.recipe_settings (`+col+`, scrap_tolerance_pct, batch_size, updated_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (`+col+`) DO UPDATE SET scrap_tolerance_pct = EXCLUDED.scrap_tolerance_pct, batch_size = EXCLUDED.batch_size,
		updated_by = EXCLUDED.updated_by, updated_at = now()`, id, r.ScrapTolerancePct, r.BatchSize, null(userID))
	return err
}

func (Postgres) ChildOrders(ctx context.Context, q database.Querier, parentID string) ([]ChildOrder, error) {
	rows, err := q.Query(ctx, `SELECT po.id::text, po.nomor_produksi, po.status, po.production_context, po.output_type,
		po.product_id::text, po.output_raw_material_id::text, COALESCE(v.item_kode, ''), COALESCE(v.item_nama, ''),
		po.planned_qty::float8, po.created_at
		FROM manufacturing.production_orders po JOIN v_production_orders v ON v.id = po.id
		WHERE po.parent_order_id = $1 ORDER BY po.created_at, po.nomor_produksi`, parentID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ChildOrder, error) {
		var c ChildOrder
		err := r.Scan(&c.ID, &c.Number, &c.Status, &c.Context, &c.OutputType, &c.ProductID, &c.OutputRawMaterialID,
			&c.ItemKode, &c.ItemNama, &c.PlannedQty, &c.CreatedAt)
		return c, err
	})
}

// LastOrderNumber is the month's highest order number with prefix.
func (Postgres) LastOrderNumber(ctx context.Context, q database.Querier, prefix string) (string, error) {
	var last string
	err := q.QueryRow(ctx, `SELECT nomor_produksi FROM manufacturing.production_orders WHERE nomor_produksi ILIKE $1
		ORDER BY nomor_produksi DESC LIMIT 1`, prefix+"-%").Scan(&last)
	if database.IsNoRows(err) {
		return "", nil
	}
	return last, err
}

// InsertOrder writes a DRAFT order and its planned lines.
func (Postgres) InsertOrder(ctx context.Context, q database.Querier, o NewOrder) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO manufacturing.production_orders (nomor_produksi, product_id, output_raw_material_id,
		production_context, output_type, planned_qty, actual_qty, status, planned_material_cost, hpp_per_unit, company_id, branch_id,
		catatan, created_by, parent_order_id)
		VALUES ($1, $2, $3, $4, $5, $6, 0, 'DRAFT', $7, $8, $9, $10, $11, $12, $13) RETURNING id::text`,
		o.Number, o.ProductID, o.OutputRawMaterialID, o.Context, o.OutputType, o.PlannedQty, o.PlannedCost, o.Hpp,
		o.CompanyID, o.BranchID, o.Catatan, null(o.UserID), o.ParentOrderID).Scan(&id)
	if err != nil {
		return "", err
	}
	for _, m := range o.Materials {
		if _, err := q.Exec(ctx, `INSERT INTO manufacturing.production_order_materials (production_order_id, raw_material_id,
			satuan_id, qty_planned, qty_actual, waste_qty, unit_cost, total_cost, recipe_qty, recipe_satuan_id, unit_factor)
			VALUES ($1, $2, $3, $4, $4, 0, $5, $6, $7, $8, $9)`, id, m.RawMaterialID, m.SatuanID, m.QtyPlanned, m.UnitCost, m.Cost,
			m.RecipeQty, m.RecipeSatuanID, m.UnitFactor); err != nil {
			return "", err
		}
	}
	return id, nil
}

// where builds the shared list filter on the v_production_orders alias v.
func (f ListFilter) where(args *[]any, searchCols ...string) string {
	add := func(v any) string {
		*args = append(*args, v)
		return "$" + strconv.Itoa(len(*args))
	}
	var w []string
	if f.CompanyID != nil {
		w = append(w, `v.company_id = `+add(*f.CompanyID))
	}
	if f.BranchID != nil {
		w = append(w, `v.branch_id = `+add(*f.BranchID))
	}
	if f.Context != "" {
		w = append(w, `v.production_context = `+add(f.Context))
	}
	if f.OrderID != "" {
		w = append(w, `v.id = `+add(f.OrderID))
	}
	if s := strings.TrimSpace(f.Search); s != "" {
		p := add("%" + s + "%")
		var or []string
		for _, c := range searchCols {
			or = append(or, c+` ILIKE `+p)
		}
		w = append(w, "("+strings.Join(or, " OR ")+")")
	}
	if len(w) == 0 {
		return ""
	}
	return " AND " + strings.Join(w, " AND ")
}

func (Postgres) WipOrders(ctx context.Context, q database.Querier, f ListFilter) ([]WipRow, error) {
	var args []any
	where := f.where(&args, "v.nomor_produksi", "v.item_nama", "v.item_kode")
	rows, err := q.Query(ctx, `SELECT v.id::text, v.nomor_produksi, v.status, v.production_context, v.output_type,
		COALESCE(v.item_kode, ''), COALESCE(v.item_nama, ''), v.planned_qty::float8, v.started_at,
		iss.issued::float8, COALESCE(ret.returned, 0)::float8, iss.last_issue_at,
		COALESCE(b.material, 0)::float8, COALESCE(b.scrap, 0)::float8, COALESCE(b.abnormal, 0)::float8, COALESCE(b.conversion, 0)::float8,
		COALESCE(b.good, 0)::float8, COALESCE(b.qty_scrap, 0)::float8, COALESCE(b.batches, 0)::int, b.last_receipt_at,
		(v.overhead_cost + v.labor_cost + v.packaging_cost + v.waste_cost)::float8
		FROM v_production_orders v
		JOIN (SELECT production_order_id, sum(total_cost) AS issued, max(created_at) AS last_issue_at
		        FROM manufacturing.production_issues GROUP BY production_order_id) iss ON iss.production_order_id = v.id
		LEFT JOIN (SELECT production_order_id, sum(total_cost) AS returned
		        FROM manufacturing.production_returns GROUP BY production_order_id) ret ON ret.production_order_id = v.id
		LEFT JOIN (SELECT production_order_id, sum(material_cost) AS material, sum(scrap_cost) AS scrap,
		        sum(abnormal_material_cost) AS abnormal, sum(conversion_cost + abnormal_conversion_cost) AS conversion, sum(qty_produced) AS good, sum(qty_scrap) AS qty_scrap,
		        count(*) AS batches, max(created_at) AS last_receipt_at
		        FROM manufacturing.production_batches GROUP BY production_order_id) b ON b.production_order_id = v.id
		WHERE v.status = 'IN_PROGRESS'`+where+` ORDER BY iss.last_issue_at DESC LIMIT 200`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (WipRow, error) {
		var w WipRow
		err := r.Scan(&w.ID, &w.Number, &w.Status, &w.Context, &w.OutputType, &w.ItemKode, &w.ItemNama, &w.PlannedQty,
			&w.StartedAt, &w.IssuedCost, &w.ReturnedCost, &w.LastIssueAt, &w.ReceivedMaterialCost, &w.ScrapCost, &w.AbnormalMaterialCost, &w.ConversionApplied,
			&w.QtyGood, &w.QtyScrap, &w.Batches, &w.LastReceiptAt, &w.ConversionCost)
		return w, err
	})
}

const batchListFrom = ` FROM manufacturing.production_batches b JOIN v_production_orders v ON v.id = b.production_order_id`

const batchListCols = `, v.nomor_produksi, v.production_context, v.status, COALESCE(v.item_kode, ''), COALESCE(v.item_nama, ''),
	v.planned_qty::float8, v.company_id::text, v.branch_id::text, v.product_id::text`

func scanBatchRow(r pgx.Row) (BatchRow, error) {
	var b BatchRow
	err := scanBatch(r, &b.Batch, &b.OrderNumber, &b.Context, &b.OrderStatus, &b.ItemKode, &b.ItemNama, &b.PlannedQty,
		&b.CompanyID, &b.BranchID, &b.ProductID)
	return b, err
}

func (Postgres) ListBatches(ctx context.Context, q database.Querier, f ListFilter) ([]BatchRow, error) {
	var args []any
	where := f.where(&args, "b.batch_number", "v.nomor_produksi", "v.item_nama", "v.item_kode")
	args = append(args, f.Limit)
	rows, err := q.Query(ctx, `SELECT `+batchCols+batchListCols+batchListFrom+` WHERE true`+where+
		` ORDER BY b.created_at DESC, b.batch_number DESC LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (BatchRow, error) { return scanBatchRow(r) })
}

func (Postgres) Batch(ctx context.Context, q database.Querier, id string) (*BatchRow, error) {
	b, err := scanBatchRow(q.QueryRow(ctx, `SELECT `+batchCols+batchListCols+batchListFrom+` WHERE b.id = $1`, id))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &b, err
}

// null maps "" to SQL NULL.
func null(s string) any {
	if s == "" {
		return nil
	}
	return s
}
