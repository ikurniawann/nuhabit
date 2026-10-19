package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/modules/production/legacy"
	"nuhabit/backend/internal/platform/database"
	ps "nuhabit/backend/internal/platform/scope"
)

// The production order and BOM routes ported from TS (package legacy) read
// item masters and stock and move stock through these adapters. The reads
// keep the TS shapes: numeric text and row_to_json embeds.

// LegacyProductionPorts are the ports of the legacy production routes.
func LegacyProductionPorts(now func() time.Time) legacy.Ports {
	return legacy.Ports{
		Items: productionItems{},
		Stock: legacyProductionStock{now: now},
		Pos:   productionPosOutput{catalog: inventoryPosCatalog{now: now}},
	}
}

/* ── item masters and stock ──────────────────────────────────────────── */

type productionItems struct{}

var _ legacy.Items = productionItems{}

func (productionItems) Product(ctx context.Context, q database.Querier, id string, activeOnly bool) (*kit.Row, error) {
	sql := `SELECT id, kode, nama, satuan_id::text, company_id::text, branch_id::text FROM item.products WHERE id = $1`
	if activeOnly {
		sql += ` AND is_active = true`
	}
	return kit.QueryOne(ctx, q, sql, id)
}

func (productionItems) ActiveRawMaterial(ctx context.Context, q database.Querier, id string) (*kit.Row, error) {
	return kit.QueryOne(ctx, q, `SELECT id, kode, nama, source_product_id::text, company_id::text, branch_id::text
		FROM item.raw_materials WHERE id = $1 AND is_active = true AND deleted_at IS NULL`, id)
}

// byID keys rows by their id column.
func byID(rows kit.Rows, err error) (map[string]*kit.Row, error) {
	out := map[string]*kit.Row{}
	for _, r := range rows {
		out[r.Str("id")] = r
	}
	return out, err
}

func (productionItems) Stock(ctx context.Context, q database.Querier, ids []string) (map[string]*kit.Row, error) {
	if len(ids) == 0 {
		return map[string]*kit.Row{}, nil
	}
	return byID(kit.Query(ctx, q, `SELECT id, qty_onhand, qty_on_order, avg_cost, material_type, source_product_id, konversi_factor,
		satuan_kecil_id, satuan_besar_id, satuan_kecil_nama, satuan_besar_nama
		FROM v_raw_materials_stock WHERE id = ANY($1::uuid[])`, ids))
}

func (productionItems) RecipeFactors(ctx context.Context, q database.Querier, materialIDs, unitIDs []string) ([]float64, error) {
	return recipeFactors(ctx, q, materialIDs, unitIDs)
}

func (productionItems) Units(ctx context.Context, q database.Querier, ids []string) (map[string]*kit.Row, error) {
	if len(ids) == 0 {
		return map[string]*kit.Row{}, nil
	}
	return byID(kit.Query(ctx, q, `SELECT * FROM item.units WHERE id = ANY($1::uuid[])`, ids))
}

// embeds is row_to_json of cols (every column when none) of table rows by id.
func embeds(ctx context.Context, q database.Querier, table string, ids []string, cols []string) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	if len(ids) == 0 {
		return out, nil
	}
	list := "*"
	if len(cols) > 0 {
		quoted := make([]string, len(cols))
		for i, c := range cols {
			quoted[i] = `"` + strings.ReplaceAll(c, `"`, `""`) + `"`
		}
		list = strings.Join(quoted, ", ")
	}
	rows, err := kit.Query(ctx, q, `SELECT t.id::text AS id, (SELECT row_to_json(e) FROM (SELECT `+list+` FROM `+table+
		` WHERE id = t.id) e) AS embed FROM `+table+` t WHERE t.id = ANY($1::uuid[])`, ids)
	for _, r := range rows {
		if e, ok := r.Get("embed").(json.RawMessage); ok {
			out[r.Str("id")] = e
		}
	}
	return out, err
}

func (productionItems) MaterialEmbeds(ctx context.Context, q database.Querier, ids []string, cols ...string) (map[string]json.RawMessage, error) {
	return embeds(ctx, q, `"item"."raw_materials"`, ids, cols)
}

func (productionItems) UnitEmbeds(ctx context.Context, q database.Querier, ids []string, cols ...string) (map[string]json.RawMessage, error) {
	return embeds(ctx, q, `"item"."units"`, ids, cols)
}

// RecipeItems is listScopedItems in lib/purchasing/production-recipes.ts.
func (productionItems) RecipeItems(ctx context.Context, q database.Querier, kind string, scope *ps.Scope) (kit.Rows, error) {
	view := "v_raw_materials_stock"
	if kind == "product" {
		view = "v_products_cogs"
	}
	a := &kit.Args{}
	where := kit.ScopeFilters(scope, "", a, []string{`"deleted_at" IS NULL`, `"is_active" = ` + a.Add(true)})
	return kit.Query(ctx, q, `SELECT * FROM `+view+` WHERE `+strings.Join(where, " AND ")+` ORDER BY "nama" ASC LIMIT `+a.Add(200), a.Values...)
}

// WipMaterials is the stock half of lib/purchasing/production-wip.ts.
func (productionItems) WipMaterials(ctx context.Context, q database.Querier, r *http.Request, userID string, scope *ps.Scope) (kit.Rows, map[string]*kit.Row, error) {
	src, err := kit.RawMaterialStockSource(ctx, q, r, userID)
	if err != nil {
		return nil, nil, err
	}
	a := &kit.Args{}
	where := []string{`"material_type" = ` + a.Add("WIP"), `"deleted_at" IS NULL`}
	if src.WarehouseID != "" {
		where = append(where, `"warehouse_id" = `+a.Add(src.WarehouseID))
	}
	where = kit.ScopeFilters(scope, "", a, where)
	rows, err := kit.Query(ctx, q, `SELECT * FROM `+src.View+` WHERE `+strings.Join(where, " AND ")+` ORDER BY "nama" ASC`, a.Values...)
	if err != nil {
		return nil, nil, err
	}
	var sources []string
	seen := map[string]bool{}
	for _, row := range rows {
		if s := row.Str("source_product_id"); s != "" && !seen[s] {
			seen[s] = true
			sources = append(sources, s)
		}
	}
	products := map[string]*kit.Row{}
	if len(sources) > 0 {
		if products, err = byID(kit.Query(ctx, q, `SELECT id, kode, nama, kategori, harga_jual FROM item.products
			WHERE id = ANY($1::uuid[])`, sources)); err != nil {
			return nil, nil, err
		}
	}
	return rows, products, nil
}

/* ── stock ───────────────────────────────────────────────────────────── */

type legacyProductionStock struct{ now func() time.Time }

var _ legacy.Stock = legacyProductionStock{}

func (s legacyProductionStock) Consume(ctx context.Context, q database.Querier, in legacy.Consumption) (string, error) {
	id, err := ledger.ConsumeForOrder(ctx, q, ledger.OrderConsumption{RawMaterialID: in.RawMaterialID, Qty: in.Qty,
		UnitCost: in.UnitCost, OrderID: in.OrderID, OrderNumber: in.OrderNumber, UserID: in.UserID}, s.now())
	var short *ledger.ShortageError
	switch {
	case errors.As(err, &short):
		return "", &legacy.ShortageError{Available: short.Available}
	case errors.Is(err, ledger.ErrNoBalance):
		return "", legacy.ErrNoStock
	}
	return id, err
}

func (s legacyProductionStock) ReceiveMaterial(ctx context.Context, q database.Querier, in legacy.MaterialReceipt) error {
	return ledger.AddFromProduction(ctx, q, ledger.ProductionOutput{RawMaterialID: in.RawMaterialID, Qty: in.Qty, UnitCost: in.UnitCost,
		OrderID: in.ReferenceID, ProductionNumber: in.ReferenceNumber, UserID: in.UserID, ReferenceType: in.ReferenceType}, s.now())
}

func (s legacyProductionStock) ReceiveGoods(ctx context.Context, q database.Querier, in legacy.GoodsReceipt) error {
	variants := make([]ledger.VariantMovement, len(in.Variants))
	for i, v := range in.Variants {
		variants[i] = ledger.VariantMovement{SkuID: v.SkuID, Before: v.Before, After: v.After}
	}
	return ledger.AddFinishedGoodsFromProduction(ctx, q, ledger.FinishedGoodsReceipt{
		ProductID: in.ProductID, Qty: in.Qty, UnitCost: in.UnitCost, TotalCost: in.TotalCost,
		ReferenceID: in.ReferenceID, ReferenceNumber: in.ReferenceNumber, Alasan: in.Alasan, UserID: in.UserID, Variants: variants,
	}, s.now())
}

func (legacyProductionStock) WipMaterial(ctx context.Context, q database.Querier, productID, userID string) (string, error) {
	return wipMaterial(ctx, q, productID, userID)
}
