package app

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/modules/production"
	"nuhabit/backend/internal/modules/production/legacy"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Production reaches inventory (item masters, stock ledgers) and the POS
// catalog through these adapters. Every call runs on the caller's Querier,
// inside the issue or receipt transaction.

// ProductionPorts are the production module's adapters; its integration
// tests use them too.
func ProductionPorts(now func() time.Time) production.Ports {
	return production.Ports{
		Catalog: productionCatalog{},
		Stock:   productionStock{now: now},
		Pos:     productionPos{out: productionPosOutput{catalog: inventoryPosCatalog{now: now}}},
		Legacy:  LegacyProductionPorts(now),
	}
}

/* ── catalog ─────────────────────────────────────────────────────────── */

type productionCatalog struct{}

var _ production.Catalog = productionCatalog{}

func (productionCatalog) Materials(ctx context.Context, q database.Querier, ids []string) (map[string]production.Material, error) {
	out := map[string]production.Material{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, COALESCE(kode, ''), COALESCE(nama, ''),
		COALESCE(satuan_kecil_nama, satuan_besar_nama, ''), COALESCE(satuan_kecil_id, satuan_besar_id)::text,
		qty_onhand::float8, avg_cost::float8, COALESCE(source_product_id::text, '')
		FROM v_raw_materials_stock WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m production.Material
		var unitID *string
		if err := rows.Scan(&m.ID, &m.Kode, &m.Nama, &m.Unit, &unitID, &m.QtyOnHand, &m.AvgCost, &m.SourceProductID); err != nil {
			return nil, err
		}
		if unitID != nil {
			m.UnitID = *unitID
		}
		out[m.ID] = m
	}
	return out, rows.Err()
}

// RecipeFactors converts recipe units with ledger's recipe unit resolver
// (domain.RecipeFactor, the conversion of v_products_cogs).
func (productionCatalog) RecipeFactors(ctx context.Context, q database.Querier, materialIDs, unitIDs []string) ([]float64, error) {
	return recipeFactors(ctx, q, materialIDs, unitIDs)
}

func recipeFactors(ctx context.Context, q database.Querier, materialIDs, unitIDs []string) ([]float64, error) {
	resolve, err := ledger.NewRecipeUnitResolver(ctx, q, materialIDs)
	if err != nil {
		return nil, err
	}
	out := make([]float64, len(materialIDs))
	for i, id := range materialIDs {
		unit := unitIDs[i]
		out[i] = resolve(id, &unit)
	}
	return out, nil
}

func (productionCatalog) UnitNames(ctx context.Context, q database.Querier, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, COALESCE(nama, '') FROM item.units WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	var id, name string
	_, err = pgx.ForEachRow(rows, []any{&id, &name}, func() error {
		out[id] = name
		return nil
	})
	return out, err
}

func (productionCatalog) Product(ctx context.Context, q database.Querier, id string) (*production.Product, error) {
	var p production.Product
	err := q.QueryRow(ctx, `SELECT p.id::text, COALESCE(p.kode, ''), COALESCE(p.nama, ''), COALESCE(u.nama, '')
		FROM item.products p LEFT JOIN item.units u ON u.id = p.satuan_id WHERE p.id = $1`, id).
		Scan(&p.ID, &p.Kode, &p.Nama, &p.Unit)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &p, err
}

/* ── stock ───────────────────────────────────────────────────────────── */

type productionStock struct{ now func() time.Time }

var _ production.Stock = productionStock{}

func (s productionStock) Issue(ctx context.Context, q database.Querier, in production.StockIssue) (production.IssuedStock, error) {
	got, err := ledger.IssueToProduction(ctx, q, ledger.ProductionIssue{
		RawMaterialID: in.RawMaterialID, Qty: in.Qty, WarehouseID: in.WarehouseID, BranchID: in.BranchID,
		IssueID: in.IssueID, IssueNumber: in.IssueNumber, UserID: in.UserID,
	}, s.now())
	var short *ledger.ShortageError
	switch {
	case errors.As(err, &short):
		return production.IssuedStock{}, &production.ShortageError{Available: short.Available}
	case errors.Is(err, ledger.ErrNoBalance):
		return production.IssuedStock{}, production.ErrNoStock
	case err != nil:
		return production.IssuedStock{}, err
	}
	return production.IssuedStock{MovementID: got.MovementID, UnitCost: got.UnitCost, WarehouseID: got.WarehouseID}, nil
}

// ReceiveMaterial keys the movement by the batch, so a batch posts once.
func (s productionStock) ReceiveMaterial(ctx context.Context, q database.Querier, in production.MaterialReceipt) error {
	return ledger.AddFromProduction(ctx, q, ledger.ProductionOutput{
		RawMaterialID: in.RawMaterialID, Qty: in.Qty, UnitCost: in.UnitCost, OrderID: in.BatchID,
		ProductionNumber: in.BatchNumber, UserID: in.UserID,
	}, s.now())
}

func (s productionStock) ReceiveGoods(ctx context.Context, q database.Querier, in production.GoodsReceipt) error {
	variants := make([]ledger.VariantMovement, len(in.Variants))
	for i, v := range in.Variants {
		variants[i] = ledger.VariantMovement{SkuID: v.SkuID, Before: v.Before, After: v.After}
	}
	return ledger.AddFinishedGoodsFromProduction(ctx, q, ledger.FinishedGoodsReceipt{
		ProductID: in.ProductID, Qty: in.Qty, UnitCost: in.UnitCost, TotalCost: in.TotalCost,
		ReferenceID: in.OrderID, ReferenceNumber: in.BatchNumber, Alasan: "Hasil produksi batch " + in.BatchNumber,
		UserID: in.UserID, Variants: variants,
	}, s.now())
}

func (productionStock) WipMaterial(ctx context.Context, q database.Querier, productID, userID string) (string, error) {
	return wipMaterial(ctx, q, productID, userID)
}

func wipMaterial(ctx context.Context, q database.Querier, productID, userID string) (string, error) {
	id, err := ledger.EnsureWipMaterial(ctx, q, productID, userID)
	if errors.Is(err, ledger.ErrNoProduct) {
		return "", httpx.NotFound("Produk tidak ditemukan")
	}
	return id, err
}

/* ── POS ─────────────────────────────────────────────────────────────── */

type productionPos struct{ out productionPosOutput }

var _ production.Pos = productionPos{}

func (p productionPos) Variants(ctx context.Context, q database.Querier, productID string) (string, []production.Sku, error) {
	posID, skus, err := p.out.MerchandiseSkus(ctx, q, productID)
	out := make([]production.Sku, len(skus))
	for i, s := range skus {
		out[i] = production.Sku{ID: s.ID, Sku: s.Sku, Name: s.Name}
	}
	return posID, out, err
}

func (p productionPos) AddSkuStock(ctx context.Context, q database.Querier, skuID, posProductID string, qty float64) (float64, bool, error) {
	return p.out.AddSkuStock(ctx, q, skuID, posProductID, qty)
}

func (p productionPos) SyncHpp(ctx context.Context, q database.Querier, productID string, hpp float64) (*float64, error) {
	row, err := p.out.SyncHpp(ctx, q, productID, hpp)
	if err != nil || row == nil {
		return nil, err
	}
	m := row.Num("margin_percentage")
	return &m, nil
}

/* ── POS merchandise output (production completion) ──────────────────── */

type productionPosOutput struct{ catalog inventoryPosCatalog }

var _ legacy.PosOutput = productionPosOutput{}

// MerchandiseSkus is resolveVariantContext in lib/purchasing/production-orders.ts.
func (productionPosOutput) MerchandiseSkus(ctx context.Context, q database.Querier, productID string) (string, []legacy.Sku, error) {
	var posID string
	err := q.QueryRow(ctx, `SELECT id::text FROM pos.pos_products WHERE source_product_id = $1 AND product_kind = 'merchandise' LIMIT 1`,
		productID).Scan(&posID)
	if database.IsNoRows(err) {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	rows, err := q.Query(ctx, `SELECT id::text, sku, name, options, stock_quantity::text FROM pos.pos_product_skus
		WHERE product_id = $1 AND is_active = true ORDER BY name ASC`, posID)
	if err != nil {
		return "", nil, err
	}
	defer rows.Close()
	var skus []legacy.Sku
	for rows.Next() {
		var s legacy.Sku
		if err := rows.Scan(&s.ID, &s.Sku, &s.Name, &s.Options, &s.StockQuantity); err != nil {
			return "", nil, err
		}
		skus = append(skus, s)
	}
	return posID, skus, rows.Err()
}

// AddSkuStock is postVariantStock's UPDATE … RETURNING stock_quantity.
func (productionPosOutput) AddSkuStock(ctx context.Context, q database.Querier, skuID, posProductID string, qty float64) (float64, bool, error) {
	var after float64
	err := q.QueryRow(ctx, `UPDATE pos.pos_product_skus SET stock_quantity = stock_quantity + $1, updated_at = now()
		WHERE id = $2 AND product_id = $3 RETURNING stock_quantity::float8`, kit.N(qty), skuID, posProductID).Scan(&after)
	if database.IsNoRows(err) {
		return 0, false, nil
	}
	return after, err == nil, err
}

// SkuLabels reads sku, name and options of SKUs.
func (productionPosOutput) SkuLabels(ctx context.Context, q database.Querier, skuIDs []string) (map[string]legacy.Sku, error) {
	rows, err := q.Query(ctx, `SELECT id::text, sku, name, options FROM pos.pos_product_skus WHERE id = ANY($1::uuid[])`, skuIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]legacy.Sku{}
	for rows.Next() {
		var s legacy.Sku
		if err := rows.Scan(&s.ID, &s.Sku, &s.Name, &s.Options); err != nil {
			return nil, err
		}
		out[s.ID] = s
	}
	return out, rows.Err()
}

// SyncHpp is syncProductionHppToPos.
func (a productionPosOutput) SyncHpp(ctx context.Context, q database.Querier, productID string, hppPerUnit float64) (*kit.Row, error) {
	return a.catalog.SyncProduct(ctx, q, productID, "", &hppPerUnit)
}
