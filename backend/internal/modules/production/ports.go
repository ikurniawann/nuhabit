package production

import (
	"context"
	"errors"

	"nuhabit/backend/internal/modules/production/legacy"
	"nuhabit/backend/internal/platform/database"
)

// Ports are the other contexts production reaches; internal/app adapts
// them. Every call runs on the caller's Querier, so an issue or a receipt
// commits together with its stock movements.
type Ports struct {
	Catalog Catalog
	Stock   Stock
	Pos     Pos
	// Legacy serves the order and BOM routes ported from TS.
	Legacy legacy.Ports
}

/* ── catalog (inventory: item.raw_materials, item.products) ──────────── */

// Material is a raw material with its stock, as the explosion and the
// issue screen show it. Unit and UnitID are the stock unit the balances
// count in. SourceProductID is set on the WIP mirror of a product.
type Material struct {
	ID              string
	Kode            string
	Nama            string
	Unit            string
	UnitID          string
	QtyOnHand       float64
	AvgCost         float64
	SourceProductID string
}

// Product is a finished good's header.
type Product struct {
	ID   string
	Kode string
	Nama string
	Unit string
}

// Catalog reads item masters and stock levels.
type Catalog interface {
	// Materials returns the materials that exist among ids.
	Materials(ctx context.Context, q database.Querier, ids []string) (map[string]Material, error)
	// Product is nil when the product does not exist.
	Product(ctx context.Context, q database.Querier, id string) (*Product, error)
	// RecipeFactors converts recipe units into stock units: the i-th
	// factor is for materialIDs[i] in unitIDs[i] ("" = the stock unit).
	RecipeFactors(ctx context.Context, q database.Querier, materialIDs, unitIDs []string) ([]float64, error)
	// UnitNames maps unit ids to their names.
	UnitNames(ctx context.Context, q database.Querier, ids []string) (map[string]string, error)
}

/* ── stock (inventory ledgers) ───────────────────────────────────────── */

// StockIssue takes a raw material out of stock for an issue.
type StockIssue struct {
	RawMaterialID string
	Qty           float64
	WarehouseID   *string // nil: the order's branch first, then the largest balance
	BranchID      *string
	IssueID       string
	IssueNumber   string
	UserID        string
}

// IssuedStock is the movement an issue wrote and the balance's average cost.
type IssuedStock struct {
	MovementID  string
	UnitCost    float64
	WarehouseID *string
}

// ShortageError is a balance without enough stock.
type ShortageError struct{ Available float64 }

func (e *ShortageError) Error() string { return "insufficient stock" }

// ErrNoStock is a material without a stock balance where it was asked.
var ErrNoStock = errors.New("no stock balance")

// MaterialReceipt is a produced raw material (intermediate or WIP) coming
// into stock, idempotent per batch.
type MaterialReceipt struct {
	RawMaterialID string
	Qty           float64
	UnitCost      float64
	BatchID       string
	BatchNumber   string
	UserID        string
}

// PostedVariant is a SKU whose stock a batch raised.
type PostedVariant struct {
	SkuID         string
	Before, After float64
}

// GoodsReceipt is produced finished goods coming into stock.
type GoodsReceipt struct {
	ProductID   string
	Qty         float64
	UnitCost    float64
	TotalCost   float64
	OrderID     string
	BatchNumber string
	UserID      string
	Variants    []PostedVariant
}

// Stock moves inventory for production.
type Stock interface {
	// Issue returns *ShortageError or ErrNoStock when it cannot take qty.
	Issue(ctx context.Context, q database.Querier, in StockIssue) (IssuedStock, error)
	ReceiveMaterial(ctx context.Context, q database.Querier, in MaterialReceipt) error
	ReceiveGoods(ctx context.Context, q database.Querier, in GoodsReceipt) error
	// WipMaterial is the raw material mirroring a product as WIP, created on
	// first use.
	WipMaterial(ctx context.Context, q database.Querier, productID, userID string) (string, error)
}

/* ── POS (merchandise SKUs and HPP sync) ─────────────────────────────── */

// Sku is an active SKU of a merchandise POS product.
type Sku struct {
	ID   string `json:"id"`
	Sku  string `json:"sku"`
	Name string `json:"name"`
}

// Pos reaches the POS catalog.
type Pos interface {
	// Variants is the merchandise POS product of productID ("" when none)
	// and its active SKUs.
	Variants(ctx context.Context, q database.Querier, productID string) (string, []Sku, error)
	// AddSkuStock raises a SKU's stock and returns the new stock (false when
	// the SKU is not posProductID's).
	AddSkuStock(ctx context.Context, q database.Querier, skuID, posProductID string, qty float64) (float64, bool, error)
	// SyncHpp sets the POS cost of the product to hpp and returns the POS
	// margin in percent (nil when no POS product follows it).
	SyncHpp(ctx context.Context, q database.Querier, productID string, hpp float64) (*float64, error)
}
