package app

import (
	"context"
	"errors"
	"time"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/ledger"
	invproduction "nuhabit/backend/internal/modules/inventory/production"
	"nuhabit/backend/internal/modules/production"
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
		Pos:     productionPos{out: inventoryPosOutput{catalog: inventoryPosCatalog{now: now}}},
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
		COALESCE(satuan_kecil_nama, satuan_besar_nama, ''), qty_onhand::float8, avg_cost::float8,
		COALESCE(source_product_id::text, '')
		FROM v_raw_materials_stock WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m production.Material
		if err := rows.Scan(&m.ID, &m.Kode, &m.Nama, &m.Unit, &m.QtyOnHand, &m.AvgCost, &m.SourceProductID); err != nil {
			return nil, err
		}
		out[m.ID] = m
	}
	return out, rows.Err()
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
	product, err := kit.QueryOne(ctx, q, `SELECT id::text, kode, nama, satuan_id::text FROM item.products WHERE id = $1`, productID)
	if err != nil {
		return "", err
	}
	if product == nil {
		return "", httpx.NotFound("Produk tidak ditemukan")
	}
	return invproduction.EnsureWip(ctx, q, product, userID)
}

/* ── POS ─────────────────────────────────────────────────────────────── */

type productionPos struct{ out inventoryPosOutput }

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
