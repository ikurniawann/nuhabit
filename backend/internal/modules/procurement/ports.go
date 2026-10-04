package procurement

import (
	"context"
	"encoding/json"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
)

// Ports reach data owned by other bounded contexts. internal/app wires the
// adapters (adapters_procurement.go) with the SQL the TS routes ran inline.
type Ports struct {
	Directory   Directory
	Catalog     Catalog
	Pricing     Pricing
	Locations   Locations
	Merchandise Merchandise
	ReturnStock ReturnStock
	Production  Production
	Owner       OwnerNotifier
	Stock       StockAlerts
}

// StockAlerts reads raw material stock (inventory's v_raw_materials_stock
// views) for the purchasing dashboard. warehouseID "" reads the aggregate
// over every stall.
type StockAlerts interface {
	// LowStockCount counts the materials at MENIPIS or HABIS.
	LowStockCount(ctx context.Context, q database.Querier, warehouseID string) (int, error)
	// LowStockItems lists the ten lowest of them by qty_onhand: id, nama,
	// kategori, qty_onhand, min_stock, satuan.
	LowStockItems(ctx context.Context, q database.Querier, warehouseID string) ([]*Row, error)
}

// OwnerNotifier sends an owner WhatsApp alert (lib/wa/notifications-sender
// sendOwnerNotification): silent when the master switch or the type is off
// or nobody is listed; the dedup key is claimed on the caller's tx so one
// event is sent at most once.
type OwnerNotifier interface {
	Notify(ctx context.Context, tx database.Querier, notifType, dedupKey, message string) error
}

// UserRef is the configuration.users slice the PR screens read.
type UserRef struct {
	ID        string
	FullName  *string
	CompanyID *string
	BranchID  *string
}

// Directory reads staff users (identity) and departments (HRIS).
type Directory interface {
	Users(ctx context.Context, q database.Querier, ids []string) (map[string]UserRef, error)
	DepartmentNames(ctx context.Context, q database.Querier, ids []string) (map[string]string, error)
	// Department is `select("name, code")…single()`, nil when missing.
	Department(ctx context.Context, q database.Querier, id string) (*Row, error)
	// ActiveDepartments is `select("id, name").eq("is_active", true).order("name")`.
	ActiveDepartments(ctx context.Context, q database.Querier) ([]*Row, error)
}

// Entity names a catalog table owned by the inventory/POS contexts.
type Entity string

// Catalog entities the purchasing screens embed.
const (
	EntityRawMaterial Entity = "raw_materials"
	EntityProduct     Entity = "products"
	EntityUnit        Entity = "units"
	EntitySupplyItem  Entity = "supply_items"
	EntityPosSku      Entity = "pos_product_skus"
)

// Catalog reads the item master (item.*) and POS SKUs. Refs returns
// row_to_json of the given columns per id, the shape a query-builder embed
// produced; missing ids are absent from the map.
type Catalog interface {
	Refs(ctx context.Context, q database.Querier, e Entity, columns string, ids []string) (map[string]json.RawMessage, error)
	// FormProducts is v_products_cogs (active, not deleted) in the user's
	// scope, ordered by name: id, kode, nama, satuan_id, satuan_nama, harga_modal.
	FormProducts(ctx context.Context, q database.Querier, companyID, branchID *string) ([]*Row, error)
	// FormSupplies is item.supply_items (active, not deleted) in scope:
	// id, kode, nama, satuan_id, stockable, harga_beli.
	FormSupplies(ctx context.Context, q database.Querier, companyID, branchID *string) ([]*Row, error)
	// FormMaterials is v_raw_materials_stock (active) with its active purchase
	// packs under unit_conversions.
	FormMaterials(ctx context.Context, q database.Querier) ([]*Row, error)
	// ActiveUnits lists item.units (active) ordered by name with the columns.
	ActiveUnits(ctx context.Context, q database.Querier, columns string) ([]*Row, error)
	// MerchandiseSkus lists the POS SKUs (active and inactive, ordered by
	// name) of the merchandise POS products whose source_product_id is one of
	// productIDs: id, product_id (the POS product), sku, name, options,
	// stock_quantity, is_active, source_product_id.
	MerchandiseSkus(ctx context.Context, q database.Querier, productIDs []string) ([]*Row, error)
	// ShelfLifeDays is raw_materials.shelf_life_days per id (nil when NULL).
	ShelfLifeDays(ctx context.Context, q database.Querier, ids []string) (map[string]*float64, error)
	// MaterialUnits is the unit setup (legacy big/small units and active
	// packs) of raw materials, for converting purchase units to base units
	// (createBaseUnitResolver).
	MaterialUnits(ctx context.Context, q database.Querier, ids []string) (map[string]MaterialUnits, error)
	// ProductsMatch reports whether an active product's nama or kode is
	// ILIKE term.
	ProductsMatch(ctx context.Context, q database.Querier, term string) (bool, error)
	// ProductUnit is the base unit of an active product (found=false when
	// the product does not exist or is deleted).
	ProductUnit(ctx context.Context, q database.Querier, productID string) (found bool, satuanID *string, err error)
	// StockableSupplies lists the supply item ids with stockable = true.
	StockableSupplies(ctx context.Context, q database.Querier, ids []string) (map[string]bool, error)
}

// MaterialUnits is a raw material's unit setup.
type MaterialUnits struct {
	Units domain.UnitMaterial
	Packs []domain.Pack
}

// BusinessIDs is a company/branch pair.
type BusinessIDs struct {
	CompanyID string
	BranchID  string
}

// Warehouse is a configuration.warehouses row with its branch's company.
type Warehouse struct {
	BranchID  string
	IsActive  bool
	CompanyID *string
}

// Locations reads warehouses, branches and companies (configuration).
type Locations interface {
	// WarehouseScope is resolveBusinessScopeFromWarehouse: the company and
	// branch of an active warehouse with an active branch and company.
	WarehouseScope(ctx context.Context, q database.Querier, warehouseID string) (*BusinessIDs, error)
	// ScopeByCodes is resolveBusinessScopeByCodes.
	ScopeByCodes(ctx context.Context, q database.Querier, companyCode, branchCode string) (*BusinessIDs, error)
	// Warehouse returns nil when the warehouse does not exist.
	Warehouse(ctx context.Context, q database.Querier, id string) (*Warehouse, error)
	// WarehouseNames maps warehouse ids to names.
	WarehouseNames(ctx context.Context, q database.Querier, ids []string) (map[string]*string, error)
}

// Merchandise posts received goods to POS merchandise stock through the
// POS database functions. It runs on the caller's transaction: a variant
// receipt fails the request when its SKU is gone.
type Merchandise interface {
	// ReceiveSkuStock is pos_receive_merchandise_sku_stock: rows updated.
	ReceiveSkuStock(ctx context.Context, q database.Querier, skuID string, qty float64) (int, error)
	// ReceiveProductStock is pos_receive_merchandise_stock: rows updated.
	ReceiveProductStock(ctx context.Context, q database.Querier, productID string, qty float64) (int, error)
}

// PriceRequest asks for the purchase price of a raw material in a unit.
type PriceRequest struct {
	RawMaterialID string
	SatuanID      *string
}

// Pricing is getPurchasePriceSuggestions (inventory movements and the raw
// material master): unit price per request item, in request order.
type Pricing interface {
	UnitPrices(ctx context.Context, q database.Querier, items []PriceRequest, supplierID string) ([]float64, error)
	// GrnMovements lists the 'in' inventory movements of the GRNs (newest
	// first, at most 1000): id, raw_material_id, jumlah, unit_cost,
	// reference_id, reference_number, created_at.
	GrnMovements(ctx context.Context, q database.Querier, grnIDs []string, rawMaterialID *string) ([]*Row, error)
}

// ProductionFilter is productionInHouseQuerySchema minus export.
type ProductionFilter struct {
	DateFrom, DateTo, Status, ProductID *string
	DateField, OutputType               string
	ProductIDs                          []string // nil = no product filter
}

// Production reads in-house production (manufacturing) for the
// production-in-house report.
type Production interface {
	// WarehouseProductIDs lists active products stocked in a warehouse.
	WarehouseProductIDs(ctx context.Context, q database.Querier, warehouseID string) ([]string, error)
	// Orders is v_production_orders (production_context 'product') filtered
	// and ordered by the date field, newest first, NULLs last.
	Orders(ctx context.Context, q database.Querier, f ProductionFilter) ([]*Row, error)
	// ProductWarehouses maps product ids to {warehouse_id, warehouse_name, warehouse_code}.
	ProductWarehouses(ctx context.Context, q database.Querier, productIDs []string) (map[string]*Row, error)
}
