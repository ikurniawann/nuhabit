// Package stock serves stock levels, movements, batches and expiry, scrap,
// stock opnames (raw material and product), transfers, adjustments and
// supply stock under /api/inventory and /api/purchasing/inventory, the
// stock card and inventory valuation reports, and applies the stock effects
// procurement publishes.
package stock

import (
	"context"
	"net/http"
	ps "nuhabit/backend/internal/platform/scope"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

// Ports are the other contexts stock reaches; internal/app wires them.
type Ports struct {
	// Procurement reads the last purchase per material (low stock report).
	Procurement Procurement
	// PosSkus reads and sets merchandise SKU stock in the POS catalog.
	PosSkus PosSkus
	// Journals posts the accounting journal for a stock variance or
	// transfer and returns the note the response shows.
	Journals Journals
}

// LastPurchase is the latest purchase order line of a material.
type LastPurchase struct {
	SupplierID   *string
	SupplierName *string
	TanggalPO    *string // YYYY-MM-DD
}

// Procurement is what stock reads from purchasing.purchase_orders.
type Procurement interface {
	// LastPurchases maps raw material id → its newest PO with a supplier
	// (by tanggal_po, then created_at).
	LastPurchases(ctx context.Context, q database.Querier, rawMaterialIDs []string) (map[string]LastPurchase, error)
}

// Sku is an active merchandise SKU of a master product.
type Sku struct {
	ID            string
	Sku           string
	Name          string
	Options       []byte // raw json, nil when NULL
	StockQuantity float64
}

// PosSkus is the slice of the POS catalog (pos.pos_products,
// pos.pos_product_skus) stock reads and, during a product opname, sets in
// the same transaction.
type PosSkus interface {
	// ActiveSkus maps item.products id → active SKUs of its linked
	// merchandise POS product, ordered by sku code.
	ActiveSkus(ctx context.Context, q database.Querier, productIDs []string) (map[string][]Sku, error)
	// LockSkuStock locks a SKU row and returns its stock (false when missing).
	LockSkuStock(ctx context.Context, q database.Querier, skuID string) (float64, bool, error)
	// SetSkuStock sets a SKU's absolute stock.
	SetSkuStock(ctx context.Context, q database.Querier, skuID string, qty float64) error
	// SkuLabels maps SKU id → its code and name (any status).
	SkuLabels(ctx context.Context, q database.Querier, skuIDs []string) (map[string]Sku, error)
}

type handler struct {
	env   kit.Env
	ports Ports
}

// Routes mounts the stock routes.
func Routes(env kit.Env, ports Ports) []module.Route {
	h := &handler{env: env, ports: ports}
	return []module.Route{
		kit.Route("GET /api/inventory", h.listInventory),
		// {id}/movements shares its shape with stock-opnames/{id}; Next prefers
		// the static segment, as the more specific Go patterns do.
		kit.Route("GET /api/inventory/{id}/{sub}", movementsOnly(h.inventoryMovements)),
		kit.Route("GET /api/inventory/batches", h.batches),
		kit.Route("GET /api/inventory/expiry", h.expiry),
		kit.Route("GET /api/inventory/materials", h.materials),
		kit.Route("GET /api/inventory/low-stock", h.lowStock),
		kit.Route("GET /api/inventory/movements", h.movements),
		kit.Route("GET /api/inventory/raw-materials", h.rawMaterialStock),
		kit.Route("GET /api/inventory/finished-goods", h.finishedGoods),
		kit.Route("POST /api/inventory/finished-goods/adjustment", h.adjustFinishedGoods),
		kit.Route("GET /api/inventory/scrap", h.scrapHistory),
		kit.Route("POST /api/inventory/scrap", h.scrap),

		kit.Route("GET /api/inventory/stock-opnames", h.listStockOpnames),
		kit.Route("POST /api/inventory/stock-opnames", h.createStockOpname),
		kit.Route("GET /api/inventory/stock-opnames/preview", h.stockOpnamePreview),
		kit.Route("GET /api/inventory/stock-opnames/{id}", h.getStockOpname),
		kit.Route("PATCH /api/inventory/stock-opnames/{id}", h.patchStockOpname),
		kit.Route("POST /api/inventory/stock-opnames/{id}/complete", h.completeStockOpname),

		kit.Route("GET /api/inventory/product-stock-opnames", h.listProductOpnames),
		kit.Route("POST /api/inventory/product-stock-opnames", h.createProductOpname),
		kit.Route("GET /api/inventory/product-stock-opnames/preview", h.productOpnamePreview),
		kit.Route("GET /api/inventory/product-stock-opnames/{id}", h.getProductOpname),
		kit.Route("PATCH /api/inventory/product-stock-opnames/{id}", h.patchProductOpname),
		kit.Route("POST /api/inventory/product-stock-opnames/{id}/complete", h.completeProductOpname),

		kit.Route("GET /api/purchasing/inventory", h.purchasingStock),
		kit.Route("GET /api/purchasing/inventory/{id}", h.purchasingStockDetail),
		kit.Route("GET /api/purchasing/inventory/{id}/{sub}", movementsOnly(h.purchasingMaterialMovements)),
		kit.Route("GET /api/purchasing/inventory/movements", h.purchasingMovements),
		kit.Route("POST /api/purchasing/inventory/adjustment", h.adjustRawMaterial),
		kit.Route("GET /api/purchasing/inventory/transfer", h.listTransfers),
		kit.Route("POST /api/purchasing/inventory/transfer", h.transfer),
		kit.Route("GET /api/purchasing/inventory/transfer/preview", h.transferPreview),
		kit.Route("GET /api/purchasing/inventory/supply", h.supplyStock),
		kit.Route("GET /api/purchasing/inventory/supply/form-data", h.supplyFormData),
		kit.Route("GET /api/purchasing/inventory/supply/{id}", h.supplyStockDetail),
		kit.Route("POST /api/purchasing/inventory/supply-adjustment", h.adjustSupply),
		kit.Route("GET /api/purchasing/inventory/supply-usage", h.listSupplyUsages),
		kit.Route("GET /api/purchasing/reports/stock-card", h.stockCard),
		kit.Route("GET /api/purchasing/reports/inventory-valuation", h.inventoryValuation),
		kit.Route("POST /api/purchasing/inventory/supply-usage", h.createSupplyUsage),
	}
}

// movementsOnly serves {id}/movements and 404s any other second segment.
func movementsOnly(h httpx.HandlerFunc) httpx.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		if r.PathValue("sub") != "movements" {
			http.NotFound(w, r)
			return nil
		}
		return h(w, r)
	}
}

// inventoryStaff is requireIamMenuPrefix(IAM.itemsInventory).
func (h *handler) inventoryStaff(r *http.Request) (*auth.User, error) {
	return h.env.Auth.RequireMenuPrefix(r, iam.ItemsInventory...)
}

// itemsStaff is requireIamMenuPrefix(IAM.items).
func (h *handler) itemsStaff(r *http.Request) (*auth.User, error) {
	return h.env.Auth.RequireMenuPrefix(r, iam.Items...)
}

// staffScope guards with prefixes and loads the caller's business scope.
func (h *handler) staffScope(r *http.Request, guard func(*http.Request) (*auth.User, error)) (*auth.User, *ps.Scope, error) {
	u, err := guard(r)
	if err != nil {
		return nil, nil, err
	}
	s, err := h.env.Scope(r.Context(), u)
	return u, s, err
}
