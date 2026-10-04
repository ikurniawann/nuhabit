// Package possales is the event contract of the pos-sales context (orders,
// checkouts, splits, voids).
//
// Created by the CRM agent as the first subscriber (ERP brief rule 3), from
// what the TS checkout passes to lib/crm/loyalty-engine. The POS-CHECKOUT
// publisher owns this file from here on: add fields, never repurpose them.
//
// XP note: the cashier response carries the XP award (crm_xp,
// xp_total_after), so pos-sales awards XP in the sale transaction through
// its Loyalty port with the TS idempotency keys. A SaleCompleted/SplitPaid
// subscriber that awards XP again only finds duplicates; its job is the
// customer stats (StatsAmount).
package possales

// Topics.
const (
	// TopicSaleCompleted is one paid order (one child order of a mixed
	// checkout): awardCrmXpForPosOrder in lib/pos/checkout/finalize.ts,
	// lib/pos/orders/settle-order.ts, settle-order-qris.ts,
	// member-bill-server.ts and api/table-order/orders.
	TopicSaleCompleted = "pos.sale.completed"
	// TopicSplitPaid is one paid split of a split bill
	// (awardCrmXpForSplitPayment in api/pos/orders/[id]/splits/[splitId]/pay).
	TopicSplitPaid = "pos.split.paid"
	// TopicOrdersVoided is a void of paid orders
	// (reverseCrmXpForVoidedOrders in api/pos/orders/[id]/void).
	TopicOrdersVoided = "pos.orders.voided"
	// TopicSaleSettled asks accounting for the sales journal of a paid
	// order or split payment (postPosSaleAccountingJournals in
	// lib/pos/accounting-posting.ts). Subscriber: accounting.
	TopicSaleSettled = "pos.sale.settled"
	// TopicTableStatusChanged is a table freed or occupied by a bill move
	// (merge / transfer-items write pos_tables.status). Subscriber: pos-ops.
	TopicTableStatusChanged = "pos.table.status_changed"
	// TopicCompApproved is a free (FOC / owner comp) sale approved by a
	// supervisor; pos-sales itself sends the owner WhatsApp alert
	// (notifyCompTransaction in lib/wa/comp-notification.ts).
	TopicCompApproved = "pos.comp.approved"
	// TopicGiftCardsSold is gift cards issued by a paid order; pos-sales
	// itself sends the buyer WhatsApp (sendGiftCardSoldWa).
	TopicGiftCardsSold = "pos.gift_cards.sold"
)

// SaleSettled is the payload of TopicSaleSettled.
type SaleSettled struct {
	OrderID string `json:"order_id"`
	UserID  string `json:"user_id"`
	// PaymentMethod overrides the order's stored method (nil = use the order's).
	PaymentMethod *string `json:"payment_method"`
	// DocumentID/DocumentType default to the order ("pos_order").
	DocumentID   string `json:"document_id,omitempty"`
	DocumentType string `json:"document_type,omitempty"`
	// AmountsOverride replaces buildPosAccountingAmounts (split payments,
	// buildSplitAccountingAmounts), keyed like JournalAmountMap.
	AmountsOverride map[string]float64 `json:"amounts_override,omitempty"`
}

// TableStatusChanged is the payload of TopicTableStatusChanged.
type TableStatusChanged struct {
	TableID string `json:"table_id"`
	Status  string `json:"status"` // "available" | "occupied"
	// IfNoOtherActiveOrder: only apply "available" when no other active
	// order (pending..served) sits on the table, excluding ExceptOrderID.
	IfNoOtherActiveOrder bool   `json:"if_no_other_active_order,omitempty"`
	ExceptOrderID        string `json:"except_order_id,omitempty"`
}

// CompApproved is the payload of TopicCompApproved.
type CompApproved struct {
	CompType     string  `json:"comp_type"` // "foc_comp" | "owner_comp"
	OrderNumber  string  `json:"order_number"`
	OrderCount   int     `json:"order_count,omitempty"`
	GrossIdr     float64 `json:"gross_idr"`
	ApprovedName *string `json:"approved_name"`
	CustomerID   *string `json:"customer_id"`
}

// GiftCardsSold is the payload of TopicGiftCardsSold.
type GiftCardsSold struct {
	OrderID    string         `json:"order_id"`
	BuyerName  *string        `json:"buyer_name"`
	BuyerPhone string         `json:"buyer_phone"`
	Cards      []SoldGiftCard `json:"cards"`
}

// SoldGiftCard is one issued card.
type SoldGiftCard struct {
	ID           string  `json:"id"`
	Code         string  `json:"code"`
	InitialValue float64 `json:"initial_value"`
	ExpiresAt    *string `json:"expires_at"`
}

// SaleItem is one order line (PosOrderItemInput). Amounts are rupiah.
type SaleItem struct {
	ProductID   string   `json:"product_id"`
	Quantity    float64  `json:"quantity"`
	UnitPrice   *float64 `json:"unit_price,omitempty"`
	TotalAmount *float64 `json:"total_amount,omitempty"`
}

// SaleCompleted is published once per paid order.
type SaleCompleted struct {
	OrderID string `json:"order_id"`
	// CustomerID is the member on the order; nil for walk-in sales.
	CustomerID    *string    `json:"customer_id"`
	TotalAmount   float64    `json:"total_amount"`
	PaymentMethod string     `json:"payment_method"`
	BranchID      *string    `json:"branch_id"`
	Items         []SaleItem `json:"items"`
	// StatsAmount, when set, is the amount syncPosCustomerOrderStats adds to
	// the member's total_spent with one visit. A mixed checkout sets it on
	// one of its child-order events only (the checkout total), the single
	// order flows on their own event; nil means no stats update.
	StatsAmount *float64 `json:"stats_amount,omitempty"`
	// UserID is the staff user who settled the sale (journal created_by).
	UserID *string `json:"user_id"`
}

// SplitPaid is published once per paid split.
type SplitPaid struct {
	OrderID       string  `json:"order_id"`
	SplitID       string  `json:"split_id"`
	CustomerID    *string `json:"customer_id"`
	TotalAmount   float64 `json:"total_amount"`
	PaymentMethod string  `json:"payment_method"`
	BranchID      *string `json:"branch_id"`
	// StatsAmount as in SaleCompleted.
	StatsAmount *float64 `json:"stats_amount,omitempty"`
}

// OrdersVoided is published when orders are voided. ReverseXP is set when
// some were paid (reverseCrmXpForVoidedOrders); the stats fields carry
// resolveCustomerStatsReversal (total_spent − amount, visit_count − delta,
// both floored at 0). pos-sales itself subscribes for the large-void owner
// alert (the alert fields).
type OrdersVoided struct {
	OrderIDs   []string `json:"order_ids"`
	VoidReason string   `json:"void_reason,omitempty"`
	ReverseXP  bool     `json:"reverse_xp,omitempty"`
	// Customer stats reversal (nil customer = none).
	StatsCustomerID *string `json:"stats_customer_id,omitempty"`
	StatsAmount     float64 `json:"stats_amount,omitempty"`
	StatsVisitDelta int     `json:"stats_visit_delta,omitempty"`
	// Large-void alert inputs.
	SourceOrderID  string  `json:"source_order_id,omitempty"`
	OrderNumber    string  `json:"order_number,omitempty"`
	Total          float64 `json:"total,omitempty"`
	SupervisorName string  `json:"supervisor_name,omitempty"`
}
