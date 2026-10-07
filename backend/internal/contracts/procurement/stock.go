package procurement

// Stock events inventory subscribes to. Procurement (the publisher) owns
// this contract: add fields, never repurpose them. This file keeps the
// shape procurement defined so inventory's subscriber builds against it.

// TopicGrnStockReceived fires when a goods receipt posts stock: raw
// materials after QC (addInventoryFromGrn in submitGrnQcInspection) and
// stockable supply items of a general receipt (addSupplyStockFromGrn in
// createGrn). The subscriber raises qty_available, lowers qty_on_order,
// updates the weighted average cost, writes the 'in' movement (reference
// grn) and, for raw materials, syncs the master purchase price
// (updateRawMaterialLastPurchasePrice).
const TopicGrnStockReceived = "procurement.grn.stock_received"

// GrnStockLine is one posted line. Raw material quantities and costs are
// already converted to the material base unit (packToBase/packPriceToBase).
type GrnStockLine struct {
	RawMaterialID *string `json:"raw_material_id"`
	SupplyItemID  *string `json:"supply_item_id"`
	Qty           float64 `json:"qty"`
	UnitCost      float64 `json:"unit_cost"`
	WarehouseID   *string `json:"warehouse_id"`
	BatchNumber   *string `json:"batch_number"`
	ExpiryDate    *string `json:"expiry_date"` // YYYY-MM-DD
}

// GrnStockReceived is the TopicGrnStockReceived payload.
type GrnStockReceived struct {
	GrnID     string `json:"grn_id"`
	GrnNumber string `json:"grn_number"`
	UserID    string `json:"user_id"`
	// CompanyID and BranchID are the receiving scope (supply stock rows).
	CompanyID *string        `json:"company_id"`
	BranchID  *string        `json:"branch_id"`
	Lines     []GrnStockLine `json:"lines"`
}
