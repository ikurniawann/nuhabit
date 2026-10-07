// Package catalog serves the item masters under /api/purchasing: units,
// warehouses, item lookups, raw materials (and the legacy /materials
// alias), supply items, products, and product and raw material BOMs.
package catalog

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	ps "nuhabit/backend/internal/platform/scope"
)

// Ports are the other contexts the catalog reaches; internal/app wires them.
type Ports struct {
	// Pos syncs finished goods to the POS catalog and counts their variants.
	Pos PosCatalog
	// Procurement says which GRNs came from a supplier (purchase prices).
	Procurement Procurement
}

// PosCatalog is what the product master needs from pos.pos_products.
type PosCatalog interface {
	// SyncProduct is syncPurchasingProductToPos: create or refresh the POS
	// product PUR-<kode> from v_products_cogs and return the sync result
	// object the product routes answer with as pos_sync. station is the
	// explicit station ("" = none); costOverride replaces the estimated COGS.
	SyncProduct(ctx context.Context, q database.Querier, productID, station string, costOverride *float64) (*kit.Row, error)
	// VariantCounts counts active SKUs of the merchandise POS products
	// linked to each master product.
	VariantCounts(ctx context.Context, q database.Querier, productIDs []string) (map[string]int, error)
}

// Procurement is what purchase price suggestions read from purchasing.grn.
type Procurement interface {
	// SupplierGrnIDs keeps the GRN ids received from supplierID.
	SupplierGrnIDs(ctx context.Context, q database.Querier, grnIDs []string, supplierID string) (map[string]bool, error)
}

type handler struct {
	env   kit.Env
	ports Ports
}

// Routes mounts the catalog routes.
func Routes(env kit.Env, ports Ports) []module.Route {
	h := &handler{env: env, ports: ports}
	return []module.Route{
		kit.Route("GET /api/purchasing/units", h.listUnits),
		kit.Route("POST /api/purchasing/units", h.createUnit),
		kit.Route("GET /api/purchasing/units/{id}", h.getUnit),
		kit.Route("PUT /api/purchasing/units/{id}", h.updateUnit),
		kit.Route("DELETE /api/purchasing/units/{id}", h.deleteUnit),

		kit.Route("GET /api/purchasing/warehouses", h.listWarehouses),

		kit.Route("GET /api/purchasing/items/{lookup}", h.listLookup),
		kit.Route("POST /api/purchasing/items/{lookup}", h.createLookup),
		kit.Route("PUT /api/purchasing/items/{lookup}/{id}", h.updateLookup),
		kit.Route("DELETE /api/purchasing/items/{lookup}/{id}", h.deleteLookup),

		kit.Route("GET /api/purchasing/raw-materials", h.listRawMaterials),
		kit.Route("POST /api/purchasing/raw-materials", h.createRawMaterial),
		kit.Route("GET /api/purchasing/raw-materials/{id}", h.getRawMaterial),
		kit.Route("PUT /api/purchasing/raw-materials/{id}", h.updateRawMaterial),
		kit.Route("PATCH /api/purchasing/raw-materials/{id}", h.updateRawMaterial),
		kit.Route("DELETE /api/purchasing/raw-materials/{id}", h.deleteRawMaterial),
		kit.Route("GET /api/purchasing/raw-materials/{id}/price-history", h.priceHistory),
		kit.Route("GET /api/purchasing/raw-materials/{id}/purchase-price", h.purchasePrice),
		kit.Route("GET /api/purchasing/raw-materials/{id}/bom", h.listRawMaterialBom),
		kit.Route("POST /api/purchasing/raw-materials/{id}/bom", h.addRawMaterialBom),
		kit.Route("PUT /api/purchasing/raw-material-bom/{id}", h.updateRawMaterialBom),
		kit.Route("DELETE /api/purchasing/raw-material-bom/{id}", h.deleteRawMaterialBom),

		kit.Route("GET /api/purchasing/materials", h.listLegacyMaterials),
		kit.Route("POST /api/purchasing/materials", h.createLegacyMaterial),
		kit.Route("GET /api/purchasing/materials/{id}", h.getLegacyMaterial),
		kit.Route("PUT /api/purchasing/materials/{id}", h.updateLegacyMaterial),
		kit.Route("DELETE /api/purchasing/materials/{id}", h.deleteLegacyMaterial),

		kit.Route("GET /api/purchasing/supply-items", h.listSupplyItems),
		kit.Route("POST /api/purchasing/supply-items", h.createSupplyItem),
		kit.Route("GET /api/purchasing/supply-items/{id}", h.getSupplyItem),
		kit.Route("PATCH /api/purchasing/supply-items/{id}", h.updateSupplyItem),
		kit.Route("DELETE /api/purchasing/supply-items/{id}", h.deleteSupplyItem),

		kit.Route("GET /api/purchasing/products", h.listProducts),
		kit.Route("POST /api/purchasing/products", h.createProduct),
		kit.Route("GET /api/purchasing/products/{id}", h.getProduct),
		kit.Route("PUT /api/purchasing/products/{id}", h.updateProduct),
		kit.Route("DELETE /api/purchasing/products/{id}", h.deleteProduct),
		kit.Route("POST /api/purchasing/products/{id}/apply-recipe-hpp", h.applyRecipeHpp),
		kit.Route("GET /api/purchasing/products/{id}/bom", h.listProductBom),
		kit.Route("POST /api/purchasing/products/{id}/bom", h.addProductBom),
		kit.Route("PUT /api/purchasing/bom/{id}", h.updateProductBom),
		kit.Route("DELETE /api/purchasing/bom/{id}", h.deleteProductBom),

		kit.Route("POST /api/purchasing/import/products", h.importProducts),
		kit.Route("POST /api/purchasing/import/raw-materials", h.importRawMaterials),
		kit.Route("POST /api/purchasing/import/units", h.importUnits),
		kit.Route("GET /api/purchasing/export/products", h.exportProducts),
		kit.Route("GET /api/purchasing/export/raw-materials", h.exportRawMaterials),
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

// staffScope guards and loads the caller's business scope.
func (h *handler) staffScope(r *http.Request, guard func(*http.Request) (*auth.User, error)) (*auth.User, *ps.Scope, error) {
	u, err := guard(r)
	if err != nil {
		return nil, nil, err
	}
	s, err := h.env.Scope(r.Context(), u)
	return u, s, err
}

// listPagination is { page, limit, total, total_pages: ceil(total/limit) }.
type listPagination struct {
	Page       kit.Float `json:"page"`
	Limit      kit.Float `json:"limit"`
	Total      int       `json:"total"`
	TotalPages kit.Float `json:"total_pages"`
}

func pagination(page, limit float64, total int, totalPages float64) listPagination {
	return listPagination{kit.Float(page), kit.Float(limit), total, kit.Float(totalPages)}
}

// window is the shim's range(from, from+limit-1) as LIMIT/OFFSET params.
func window(a *kit.Args, page, limit float64) string {
	from := (page - 1) * limit
	to := from + limit - 1
	return " LIMIT " + a.Add(kit.N(to-from+1)) + " OFFSET " + a.Add(kit.N(from))
}

// countRows is the shim's count(*)::int over from + where.
func (h *handler) countRows(ctx context.Context, from, where string, a *kit.Args) (int, error) {
	var n int
	err := h.env.DB.QueryRow(ctx, `SELECT count(*)::int FROM `+from+` WHERE `+where, a.Values...).Scan(&n)
	return n, err
}
