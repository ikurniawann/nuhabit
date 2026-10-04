// Package inventory is the event contract of the inventory context.
package inventory

// Journal events accounting subscribes to. Created by the accounting agent as
// the subscriber (ERP brief rule 3) from what the TS passes to
// lib/inventory/accounting-posting.ts; inventory owns them from here on:
// add fields, never repurpose them. Dates are YYYY-MM-DD.

// TopicStockOpnameCompleted fires when an opname's variances are applied
// (completeStockOpname in lib/inventory/stock-opname-service.ts).
// Accounting posts STOCK_OPNAME_SHORTAGE and STOCK_OPNAME_SURPLUS.
const TopicStockOpnameCompleted = "inventory.stock_opname.completed"

// VarianceLine is one counted material: QtyDiff = counted − system.
type VarianceLine struct {
	RawMaterialID string  `json:"raw_material_id"`
	QtyDiff       float64 `json:"qty_diff"`
	UnitCost      float64 `json:"unit_cost"`
	MaterialNama  *string `json:"material_nama,omitempty"`
}

// StockOpnameCompleted is the TopicStockOpnameCompleted payload.
type StockOpnameCompleted struct {
	OpnameID     string         `json:"opname_id"`
	OpnameNumber string         `json:"opname_number"`
	OpnameDate   string         `json:"opname_date"`
	CompanyID    *string        `json:"company_id"` // the branch's company
	UserID       string         `json:"user_id"`
	Lines        []VarianceLine `json:"lines"`
}

// TopicStockAdjusted fires for a manual stock adjustment
// (adjustRawMaterialStock in lib/purchasing/inventory-stock-moves.ts) or a
// scrap (scrapStock in lib/inventory/scrap.ts, QtyDiff = −qty). Accounting
// posts STOCK_ADJUSTMENT_SHORTAGE or _SURPLUS.
const TopicStockAdjusted = "inventory.stock.adjusted"

// StockAdjusted is the TopicStockAdjusted payload.
type StockAdjusted struct {
	DocumentID    string  `json:"document_id"` // the movement reference id
	CompanyID     *string `json:"company_id"`
	UserID        string  `json:"user_id"`
	EntryDate     string  `json:"entry_date"`
	RawMaterialID string  `json:"raw_material_id"`
	QtyDiff       float64 `json:"qty_diff"`
	UnitCost      float64 `json:"unit_cost"`
	Notes         *string `json:"notes"`
}

// TopicStockTransferred fires for a warehouse transfer
// (transferRawMaterialStock in lib/purchasing/inventory-stock-moves.ts).
// Accounting posts STOCK_TRANSFER.
const TopicStockTransferred = "inventory.stock.transferred"

// StockTransferred is the TopicStockTransferred payload.
type StockTransferred struct {
	TransferID          string  `json:"transfer_id"`
	TransferNumber      string  `json:"transfer_number"`
	CompanyID           *string `json:"company_id"`
	UserID              string  `json:"user_id"`
	EntryDate           string  `json:"entry_date"`
	RawMaterialID       string  `json:"raw_material_id"`
	Qty                 float64 `json:"qty"`
	UnitCost            float64 `json:"unit_cost"`
	SourceWarehouseName string  `json:"source_warehouse_name,omitempty"`
	DestWarehouseName   string  `json:"dest_warehouse_name,omitempty"`
}
