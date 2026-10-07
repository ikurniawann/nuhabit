// Package ports declares what pos-sales needs from other bounded contexts.
// Every method runs on the caller's database.Querier so the call joins the
// sale's transaction (rule 2 of the ERP brief: the HTTP response depends on
// the result, or the write must be atomic with the sale). internal/app wires
// the adapters (possales/adapters until the owning modules expose a service).
//
// Convention: an adapter whose SQL may fail on purpose (a DB function raising
// "Insufficient balance", a unique violation it translates) runs that SQL in
// a savepoint when q is a database.TxBeginner, so the caller's transaction
// stays usable after a rejection.
package ports

import (
	"context"
	"encoding/json"
	"errors"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/scope"
)

/* ── Loyalty (CRM XP) ────────────────────────────────────────────────── */

// XPItem is one order line as awardCrmXpForPosOrder reads it
// (PosOrderItemInput). Nil fields are JS undefined/null.
type XPItem struct {
	ProductID   string
	Quantity    *float64
	TotalAmount *float64
	Subtotal    *float64
	UnitPrice   *float64
}

// OrderXP is the payload of awardCrmXpForPosOrder.
type OrderXP struct {
	OrderID       string
	CustomerID    string // "" = no customer
	TotalAmount   float64
	Items         []XPItem
	OutletID      *string
	PaymentMethod string
}

// SplitXP is the payload of awardCrmXpForSplitPayment.
type SplitXP struct {
	OrderID       string
	SplitID       string
	CustomerID    string
	TotalAmount   float64
	OutletID      *string
	PaymentMethod string
}

// XPAward is CrmXpAwardResult, serialized in its TS key order.
type XPAward struct {
	Status    string   `json:"status"`
	XPAwarded float64  `json:"xpAwarded"`
	Reason    string   `json:"reason,omitempty"`
	LedgerIDs []string `json:"ledgerIds,omitempty"`
}

// Loyalty awards CRM XP for paid POS sales. The award is returned to the
// cashier (crm_xp, xp_total_after on the receipt), so it is a port.
type Loyalty interface {
	// AwardOrderXP is awardCrmXpForPosOrder: product bonus XP for every
	// payment method plus spend XP for ARK Coin payments. Failures inside the
	// engine are reported in the result (status "error"), never returned.
	AwardOrderXP(ctx context.Context, q database.Querier, in OrderXP) (XPAward, error)
	// AwardSplitXP is awardCrmXpForSplitPayment.
	AwardSplitXP(ctx context.Context, q database.Querier, in SplitXP) (XPAward, error)
	// TotalXP is pos_customers.total_xp after the award (nil when unknown).
	TotalXP(ctx context.Context, q database.Querier, customerID string) (*float64, error)
	// ArkCoinEnabled is getLoyaltyFeatures().arkCoin (default true when unreadable).
	ArkCoinEnabled(ctx context.Context, q database.Querier) bool
	// CheckProductPrivileges is crm/product-privilege.ts: allowed, or the
	// cashier message when a min_xp product is not unlocked for the customer.
	CheckProductPrivileges(ctx context.Context, q database.Querier, productIDs []string, customerID string) (allowed bool, message string, err error)
	// ValidateKolComp is comp-orders-server.ts validateKolComp ("" = ok).
	ValidateKolComp(ctx context.Context, q database.Querier, customerID string, grossIdr float64) (string, error)
}

/* ── ARK Coin wallet (stored-value) ──────────────────────────────────── */

// ErrArkInsufficient is the DB function's "Insufficient balance" rejection.
var ErrArkInsufficient = errors.New("ark wallet: insufficient balance")

// ErrArkFailed is any other rejection of update_ark_coin_balance.
var ErrArkFailed = errors.New("ark wallet: failed")

// ArkMove calls update_ark_coin_balance(p_customer_id, p_amount, p_type,
// p_order_id[, p_notes]). Notes nil = parameter not passed.
type ArkMove struct {
	CustomerID string
	Amount     float64
	Type       string // "payment" | "refund"
	OrderID    string
	Notes      *string
}

// WalletRow is one pos_wallet_transactions row of an order.
type WalletRow struct {
	OrderID string
	Type    string
	Amount  float64
}

// Wallet is the ARK Coin balance (pos.pos_wallet_transactions, owned by
// stored-value). Debits are atomic with the sale.
type Wallet interface {
	// Move returns the balance after the move (nil when the function
	// returned a non-number), ErrArkInsufficient or ErrArkFailed.
	Move(ctx context.Context, q database.Querier, m ArkMove) (*float64, error)
	// Balance is pos_customers.ark_coin_balance (nil when unknown).
	Balance(ctx context.Context, q database.Querier, customerID string) (*float64, error)
	// OrderRows lists the wallet rows referencing the orders.
	OrderRows(ctx context.Context, q database.Querier, orderIDs []string) ([]WalletRow, error)
}

/* ── Gift cards (stored-value) ───────────────────────────────────────── */

// GiftScope is the venue of a gift card operation.
type GiftScope struct {
	CompanyID string
	BranchID  string
}

// GiftSaleLine is a cart line checked by prepareGiftCardSale (raw JSON values).
type GiftSaleLine struct {
	ProductID               string
	Quantity                any
	UnitPrice               any
	VariantPriceAdjustment  any
	ModifierPriceAdjustment any
}

// GiftRedeem debits a card for an order.
type GiftRedeem struct {
	Scope     GiftScope
	Code      string
	Amount    float64
	OrderID   string
	CreatedBy string
}

// GiftOutcome is a redeem result: OK, or a rejection with status 400/404/409.
type GiftOutcome struct {
	OK     bool
	Reason string
	Status int
}

// IssuedGiftCard is IssuedGiftCard as the POS response serializes it.
type IssuedGiftCard struct {
	ID           string          `json:"id"`
	Code         string          `json:"code"`
	InitialValue float64         `json:"initial_value"`
	ExpiresAt    json.RawMessage `json:"expires_at"`
}

// GiftIssue issues the cards sold by a paid order.
type GiftIssue struct {
	Scope      GiftScope
	OrderID    string
	Nominals   []float64
	BuyerName  *string
	BuyerPhone *string
	CreatedBy  string
}

// IssuedCardUsedError is IssuedGiftCardAlreadyUsedError.
type IssuedCardUsedError struct{ Code string }

func (e *IssuedCardUsedError) Error() string {
	return "Gift card " + e.Code + " sudah terpakai — void ditolak"
}

// GiftCards is the gift card ledger (giftcard.*).
type GiftCards interface {
	// PrepareSale is prepareGiftCardSale: the nominals of the cards the cart
	// sells, or the rejection reason.
	PrepareSale(ctx context.Context, q database.Querier, lines []GiftSaleLine) (nominals []float64, reason string, err error)
	Redeem(ctx context.Context, q database.Querier, in GiftRedeem) (GiftOutcome, error)
	// Refund is refundGiftCardForPosOrder (idempotent).
	Refund(ctx context.Context, q database.Querier, scope GiftScope, orderID, createdBy, note string) (bool, error)
	// Issue is issueGiftCardsForPosOrder (idempotent per order).
	Issue(ctx context.Context, q database.Querier, in GiftIssue) ([]IssuedGiftCard, error)
	// VoidIssued is voidIssuedGiftCardsForPosOrder; *IssuedCardUsedError
	// when a sold card was already spent.
	VoidIssued(ctx context.Context, q database.Querier, orderID, note string) (int, error)
}

/* ── NFC Tab (ticketing) ─────────────────────────────────────────────── */

// TabCharge moves an F&B order onto a ticketing visit tab.
type TabCharge struct {
	OrderID     string
	OrderNumber string
	Amount      float64
	BandUID     string
	CompanyID   string
	BranchID    string
	CreatedBy   string
}

// TabOutcome: OK, or Reason with Status 404 (band/visit), 409 (closed) or
// 402 (limit/balance).
type TabOutcome struct {
	OK     bool
	Reason string
	Status int
}

// Tabs is ticketing's visit tab ledger.
type Tabs interface {
	// Charge is chargeFnbOrderToTab without markOrderPaid: the caller marks
	// the order paid in the same transaction.
	Charge(ctx context.Context, q database.Querier, in TabCharge) (TabOutcome, error)
	// Void is voidFnbOrderFromTab.
	Void(ctx context.Context, q database.Querier, orderID, reason, createdBy string) (bool, error)
}

/* ── Merchandise stock (catalog) ─────────────────────────────────────── */

// MerchClaim is one stock claim (SkuID "" = flat product stock).
type MerchClaim struct {
	ProductID string
	SkuID     string
	Qty       float64
}

// MerchLine is a cart line as claimMerchandiseStock reads it.
type MerchLine struct {
	ProductID string
	SkuID     string
	Quantity  any
}

// Merchandise is the merchandise stock of pos.pos_products (DB functions
// pos_sell_merchandise_stock / pos_sell_merchandise_sku_stock).
type Merchandise interface {
	// Claim decrements stock for every merchandise line (aggregated per
	// product+sku). On rejection it restores what it claimed and returns
	// status 400/500 with the TS reason.
	Claim(ctx context.Context, q database.Querier, lines []MerchLine) (claims []MerchClaim, status int, reason string, err error)
	// Restore returns claimed stock (errors are logged, not returned).
	Restore(ctx context.Context, q database.Querier, claims []MerchClaim)
	// RestoreOne returns one line's stock; false when the DB call failed.
	RestoreOne(ctx context.Context, q database.Querier, claim MerchClaim) bool
	// HasTracked reports a tracked merchandise product among the ids.
	HasTracked(ctx context.Context, q database.Querier, productIDs []string) bool
}

/* ── Catalog reads (pos.pos_products, item.products) ─────────────────── */

// ProductSku is what resolveOrderItemSkus reads per product.
type ProductSku struct {
	PosSku     *string
	MasterKode *string
}

// Catalog reads the POS catalog owned by pos-ops.
type Catalog interface {
	// Warehouses is loadPosProductWarehouseIds: product id → stall ("" when
	// unlinked or unknown).
	Warehouses(ctx context.Context, q database.Querier, productIDs []string) (map[string]string, error)
	// CostPrices is loadPosProductCostMap's cost_price per known product.
	CostPrices(ctx context.Context, q database.Querier, productIDs []string) (map[string]float64, error)
	// Skus is the lookup behind resolveOrderItemSkus.
	Skus(ctx context.Context, q database.Querier, productIDs []string) (map[string]ProductSku, error)
}

/* ── Directory reads (configuration.*, hris.employees, crm settings) ─── */

// CashierFlags are the configuration.users stall flags.
type CashierFlags struct {
	CanCentralCheckout bool
	CanSwitchStall     bool
	DefaultWarehouseID string
}

// Warehouse is a configuration.warehouses row as the stall pickers read it.
type Warehouse struct {
	ID        string
	Name      string
	Code      string
	BranchID  string
	IsDefault bool
}

// Supervisor is an active pos_supervisor with a PIN.
type Supervisor struct {
	ID       string
	FullName *string
	PosPin   string
	Scope    *scope.Scope
}

// Directory reads identity/org data no wave module owns yet.
type Directory interface {
	// Venue is getCrmDefaultVenue ("" when unset or unreadable).
	Venue(ctx context.Context, q database.Querier) (companyID, branchID string)
	Flags(ctx context.Context, q database.Querier, userID string) (CashierFlags, error)
	// AssignedWarehouses is loadUserWarehouses (active assignments).
	AssignedWarehouses(ctx context.Context, q database.Querier, userID string) ([]Warehouse, error)
	// BranchWarehouses lists active warehouses ("" branch = all).
	BranchWarehouses(ctx context.Context, q database.Querier, branchID string) ([]Warehouse, error)
	// ActiveWarehouse is findActiveStall (nil when unknown or inactive).
	ActiveWarehouse(ctx context.Context, q database.Querier, id string) (*Warehouse, error)
	// EmployeeID is hris.employees.id of the user ("" when none).
	EmployeeID(ctx context.Context, q database.Querier, userID string) (string, error)
	// EmployeeName / UserName are display names (nil when unknown).
	EmployeeName(ctx context.Context, q database.Querier, employeeID string) (*string, error)
	UserName(ctx context.Context, q database.Querier, userID string) (*string, error)
	// ActiveSupervisors lists role pos_supervisor, status active, PIN set.
	ActiveSupervisors(ctx context.Context, q database.Querier) ([]Supervisor, error)
	// HasCentralMenu reports the pos.cashier.central grant.
	HasCentralMenu(ctx context.Context, userID, role string) bool
}

/* ── Notifications (WhatsApp, owner alerts) ──────────────────────────── */

// Delivery is a WhatsApp send result.
type Delivery struct {
	OK     bool
	Reason string
}

// CompNotice is wa/comp-notification.ts CompNotifInput.
type CompNotice struct {
	CompType     string // "foc_comp" | "owner_comp"
	OrderNumber  string
	OrderCount   int // 0 = not passed
	GrossIdr     float64
	ApprovedName *string
	CustomerID   *string
}

// VoidNotice is the input of the large-void owner alert (void route step 5).
type VoidNotice struct {
	OrderID        string
	OrderNumber    string
	Total          float64
	Reason         string
	SupervisorName string
}

// GiftCardsSoldNotice is sendGiftCardSoldWa's input.
type GiftCardsSoldNotice struct {
	BuyerName  *string
	BuyerPhone string
	Cards      []IssuedGiftCard
}

// Notifier sends WhatsApp messages (lib/whatsapp, lib/wa). The send-wa
// route answers with the result, so SendText is synchronous; the notices
// are fire-and-forget (called from outbox handlers, errors only logged).
type Notifier interface {
	// SendText is sendWhatsAppText({target, message}, {messageType, sentByUserId}).
	SendText(ctx context.Context, target, message, messageType, sentByUserID string) Delivery
	// NotifyComp is notifyCompTransaction.
	NotifyComp(ctx context.Context, n CompNotice)
	// NotifyLargeVoid sends the voidBesar owner alert when Total reaches the
	// configured threshold (getWaNotifConfig().voidThresholdRp).
	NotifyLargeVoid(ctx context.Context, n VoidNotice)
	// NotifyGiftCardsSold is sendGiftCardSoldWa.
	NotifyGiftCardsSold(ctx context.Context, n GiftCardsSoldNotice)
}
