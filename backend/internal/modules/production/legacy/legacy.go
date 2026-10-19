// Package legacy serves the production routes ported from the TS app with
// their contract kept byte for byte: production orders and their one-shot
// actions, the recipe lists and WIP stock under /api/purchasing/production,
// and the product and raw material BOM lines under /api/purchasing. It
// writes the manufacturing tables only; item masters, stock and the POS
// catalog are reached through Ports.
package legacy

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	ps "nuhabit/backend/internal/platform/scope"
)

// Ports are the other contexts these routes reach; internal/app wires them.
// Every call runs on the caller's Querier.
type Ports struct {
	Items Items
	Stock Stock
	Pos   PosOutput
}

// Items reads item masters and stock levels. Rows come back the way the TS
// routes read them: numeric columns as text, embeds as JSON objects.
type Items interface {
	// Product is id, kode, nama, satuan_id, company_id and branch_id of a
	// product (active only when activeOnly), nil when there is none.
	Product(ctx context.Context, q database.Querier, id string, activeOnly bool) (*kit.Row, error)
	// ActiveRawMaterial is id, kode, nama, source_product_id, company_id and
	// branch_id of an active, undeleted raw material, nil when there is none.
	ActiveRawMaterial(ctx context.Context, q database.Querier, id string) (*kit.Row, error)
	// Stock is the v_raw_materials_stock row of each material: qty_onhand,
	// qty_on_order, avg_cost, material_type, source_product_id, unit ids and
	// names, konversi_factor.
	Stock(ctx context.Context, q database.Querier, ids []string) (map[string]*kit.Row, error)
	// RecipeFactors converts recipe units into stock units: the i-th factor
	// is for materialIDs[i] in unitIDs[i] ("" = the stock unit).
	RecipeFactors(ctx context.Context, q database.Querier, materialIDs, unitIDs []string) ([]float64, error)
	// Units is the item.units row of each id.
	Units(ctx context.Context, q database.Querier, ids []string) (map[string]*kit.Row, error)
	// MaterialEmbeds and UnitEmbeds are row_to_json of the given columns
	// (every column when none) of raw material and unit rows by id: the
	// shim's `alias:table(cols)` embed.
	MaterialEmbeds(ctx context.Context, q database.Querier, ids []string, cols ...string) (map[string]json.RawMessage, error)
	UnitEmbeds(ctx context.Context, q database.Querier, ids []string, cols ...string) (map[string]json.RawMessage, error)
	// RecipeItems lists up to 200 active, undeleted rows in scope by name:
	// v_products_cogs for "product", v_raw_materials_stock otherwise.
	RecipeItems(ctx context.Context, q database.Querier, kind string, scope *ps.Scope) (kit.Rows, error)
	// WipMaterials lists the WIP raw materials in scope from the stock view
	// of the request's active stall, by name, plus the products they mirror
	// (id, kode, nama, kategori, harga_jual).
	WipMaterials(ctx context.Context, q database.Querier, r *http.Request, userID string, scope *ps.Scope) (kit.Rows, map[string]*kit.Row, error)
}

// Consumption takes a material out of stock for an order's one-shot
// completion.
type Consumption struct {
	RawMaterialID string
	Qty           float64
	UnitCost      float64 // the order line's cost, kept on the movement
	OrderID       string
	OrderNumber   string
	UserID        string
}

// ShortageError is a balance without enough stock.
type ShortageError struct{ Available float64 }

func (e *ShortageError) Error() string { return "insufficient stock" }

// ErrNoStock is a material without an active balance.
var ErrNoStock = errors.New("no stock balance")

// MaterialReceipt is a produced raw material coming into stock, once per
// (ReferenceType, ReferenceID).
type MaterialReceipt struct {
	RawMaterialID   string
	Qty             float64
	UnitCost        float64
	ReferenceID     string
	ReferenceNumber string
	ReferenceType   string // "" = production_wip
	UserID          string
}

// PostedVariant is a SKU whose stock a completion raised.
type PostedVariant struct {
	SkuID         string
	Before, After float64
}

// GoodsReceipt is produced finished goods coming into stock.
type GoodsReceipt struct {
	ProductID       string
	Qty             float64
	UnitCost        float64
	TotalCost       float64
	ReferenceID     string
	ReferenceNumber string
	Alasan          string
	UserID          string
	Variants        []PostedVariant
}

// Stock moves inventory for the one-shot completion.
type Stock interface {
	// Consume returns the movement written, *ShortageError or ErrNoStock.
	Consume(ctx context.Context, q database.Querier, in Consumption) (string, error)
	ReceiveMaterial(ctx context.Context, q database.Querier, in MaterialReceipt) error
	ReceiveGoods(ctx context.Context, q database.Querier, in GoodsReceipt) error
	// WipMaterial is the raw material mirroring a product as WIP, created on
	// first use.
	WipMaterial(ctx context.Context, q database.Querier, productID, userID string) (string, error)
}

// Sku is an active SKU of a merchandise POS product.
type Sku struct {
	ID            string
	Sku           string
	Name          string
	Options       []byte  // raw json, nil when NULL
	StockQuantity *string // numeric text, as node-postgres returns it
}

// PosOutput is what production needs from the POS catalog: the merchandise
// variants of a product, raising SKU stock in the completion transaction,
// SKU labels for the batch details, and the HPP sync after completion.
type PosOutput interface {
	// MerchandiseSkus is resolveVariantContext: the merchandise POS product
	// linked to productID ("" when none) and its active SKUs by name.
	MerchandiseSkus(ctx context.Context, q database.Querier, productID string) (string, []Sku, error)
	// AddSkuStock adds qty to a SKU of posProductID and returns the new stock
	// (false when the SKU is not that product's).
	AddSkuStock(ctx context.Context, q database.Querier, skuID, posProductID string, qty float64) (float64, bool, error)
	// SkuLabels maps SKU id → sku, name and options.
	SkuLabels(ctx context.Context, q database.Querier, skuIDs []string) (map[string]Sku, error)
	// SyncHpp is syncProductionHppToPos: refresh the POS product PUR-<kode>
	// with the production HPP as cost and return the sync result.
	SyncHpp(ctx context.Context, q database.Querier, productID string, hppPerUnit float64) (*kit.Row, error)
}

type handler struct {
	env   kit.Env
	ports Ports
}

// Routes mounts the order, recipe, WIP stock and BOM routes.
func Routes(env kit.Env, ports Ports) []module.Route {
	h := &handler{env: env, ports: ports}
	return []module.Route{
		kit.Route("GET /api/purchasing/production/orders", h.listOrders),
		kit.Route("POST /api/purchasing/production/orders", h.createOrder),
		kit.Route("GET /api/purchasing/production/orders/{id}", h.getOrder),
		kit.Route("PATCH /api/purchasing/production/orders/{id}", h.updateOrder),
		kit.Route("GET /api/purchasing/production/product-recipes", h.productRecipes),
		kit.Route("GET /api/purchasing/production/raw-material-recipes", h.rawMaterialRecipes),
		kit.Route("GET /api/purchasing/production/wip", h.wip),

		kit.Route("GET /api/purchasing/products/{id}/bom", h.listProductBom),
		kit.Route("POST /api/purchasing/products/{id}/bom", h.addProductBom),
		kit.Route("PUT /api/purchasing/bom/{id}", h.updateProductBom),
		kit.Route("DELETE /api/purchasing/bom/{id}", h.deleteProductBom),
		kit.Route("GET /api/purchasing/raw-materials/{id}/bom", h.listRawMaterialBom),
		kit.Route("POST /api/purchasing/raw-materials/{id}/bom", h.addRawMaterialBom),
		kit.Route("PUT /api/purchasing/raw-material-bom/{id}", h.updateRawMaterialBom),
		kit.Route("DELETE /api/purchasing/raw-material-bom/{id}", h.deleteRawMaterialBom),
	}
}

// itemsStaff is requireIamMenuPrefix(IAM.items).
func (h *handler) itemsStaff(r *http.Request) (*auth.User, error) {
	return h.env.Auth.RequireMenuPrefix(r, iam.Items...)
}

// catalogStaff is requireIamMenuPrefix(IAM.itemsCatalog) (items or pos.catalog).
func (h *handler) catalogStaff(r *http.Request) (*auth.User, error) {
	return h.env.Auth.RequireMenuPrefix(r, iam.ItemsCatalog...)
}
