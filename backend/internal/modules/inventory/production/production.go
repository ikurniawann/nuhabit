// Package production serves production orders, recipes, WIP and COGS
// estimates (/api/purchasing/production, /api/purchasing/cogs).
package production

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

// Ports are the other contexts production reaches; internal/app wires them.
type Ports struct {
	Pos      PosOutput
	Receipts Receipts
}

// DocRef names a purchase document an additional cost points at: Type is
// "PO" or "GRN".
type DocRef struct{ Type, ID string }

// Receipts is what COGS reads from procurement.
type Receipts interface {
	// ReceivedValues lists the active GRN lines of the raw materials, valued
	// at quantity received × PO unit price, and the received value of every
	// GRN and PO those lines belong to (all lines), keyed by domain.DocKey.
	ReceivedValues(ctx context.Context, q database.Querier, rawMaterialIDs []string) ([]domain.ReceiptLine, map[string]float64, error)
	// DocumentNumbers maps the documents that exist among refs, keyed by
	// domain.DocKey, to their number (nomor_po / nomor_grn).
	DocumentNumbers(ctx context.Context, q database.Querier, refs []DocRef) (map[string]string, error)
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

// Routes mounts the production and COGS routes.
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
		kit.Route("GET /api/purchasing/cogs/additional-cost", h.listAdditionalCosts),
		kit.Route("POST /api/purchasing/cogs/additional-cost", h.createAdditionalCost),
		kit.Route("DELETE /api/purchasing/cogs/additional-cost/{id}", h.deleteAdditionalCost),
		kit.Route("GET /api/purchasing/cogs/product/{produk_id}", h.productCogs),
		kit.Route("GET /api/purchasing/cogs/raw-material/{id}", h.rawMaterialCogs),
	}
}

// itemsStaff is requireIamMenuPrefix(IAM.items).
func (h *handler) itemsStaff(r *http.Request) (*auth.User, error) {
	return h.env.Auth.RequireMenuPrefix(r, iam.Items...)
}
