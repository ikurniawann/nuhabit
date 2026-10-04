// Package procurement holds the events the procurement module publishes:
// topic constants and JSON payloads, no logic.
package procurement

// TopicPurchaseRequestUrgent fires when a PR with priority "urgent" is saved
// as draft or submitted (notifyPrMendesak in lib/purchasing/pr-urgent-notify).
// Subscribers send the owner WhatsApp alert, deduplicated per PR per status.
const TopicPurchaseRequestUrgent = "procurement.purchase_request.urgent"

// PurchaseRequestUrgentItem is one PR line in the alert.
type PurchaseRequestUrgentItem struct {
	Description string  `json:"description"`
	Qty         float64 `json:"qty"`
	Unit        *string `json:"unit"`
}

// PurchaseRequestUrgent is the TopicPurchaseRequestUrgent payload.
type PurchaseRequestUrgent struct {
	PrID          string                      `json:"pr_id"`
	PrNumber      string                      `json:"pr_number"`
	Priority      string                      `json:"priority"`
	Status        string                      `json:"status"` // "draft" | "pending_head"
	RequesterName string                      `json:"requester_name"`
	DepartmentID  *string                     `json:"department_id"`
	TotalAmount   float64                     `json:"total_amount"`
	RequiredDate  *string                     `json:"required_date"`
	Notes         *string                     `json:"notes"`
	Items         []PurchaseRequestUrgentItem `json:"items"`
	// DedupKey is prMendesakDedupKey: "<pr id>:<status>".
	DedupKey string `json:"dedup_key"`
}

// TopicPurchaseOrderOnOrderChanged fires when a sent PO adds its open raw
// material quantity to inventory qty_on_order (+1) or a void releases it
// (-1): adjustOnOrderForOpenQty in lib/purchasing/po-lifecycle.
const TopicPurchaseOrderOnOrderChanged = "procurement.purchase_order.on_order_changed"

// OnOrderLine is one PO line's open quantity in the line's purchase unit.
// The subscriber converts it to the material base unit (pack factor) and
// applies Direction * OpenQty * factor to item qty_on_order
// (adjustInventoryOnOrder).
type OnOrderLine struct {
	RawMaterialID string  `json:"raw_material_id"`
	SatuanID      *string `json:"satuan_id"`
	OpenQty       float64 `json:"open_qty"`
}

// PurchaseOrderOnOrderChanged is the TopicPurchaseOrderOnOrderChanged payload.
type PurchaseOrderOnOrderChanged struct {
	PurchaseOrderID string        `json:"purchase_order_id"`
	Direction       int           `json:"direction"` // 1 on send, -1 on void
	Lines           []OnOrderLine `json:"lines"`
}
