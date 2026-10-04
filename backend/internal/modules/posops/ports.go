package posops

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
)

// Ports reach data owned by other bounded contexts. internal/app wires the
// adapters; every method runs on the caller's Querier so reads see the
// caller's transaction.
type Ports struct {
	Sales       Sales
	MemberBills MemberBills
	Directory   Directory
	Stalls      Stalls
	Inventory   Inventory
	Shop        Shop
	CRM         CRM
	StoredValue StoredValue
	WhatsApp    WhatsApp
}

// Sales reads POS orders and checkouts (pos-sales).
type Sales interface {
	// ShiftOrders lists the orders of each shift, for the embedded
	// pos_orders(...) of the shift list; detailed adds the payment columns.
	ShiftOrders(ctx context.Context, q database.Querier, shiftIDs []string, detailed bool) (map[string][]ShiftOrderRef, error)
	// ShiftCloseOrders returns the paid or partial, not cancelled orders of
	// a shift with the columns the close sums.
	ShiftCloseOrders(ctx context.Context, q database.Querier, shiftID string) ([]domain.ShiftOrder, error)
	// TableOpenOrders lists unpaid orders on a table whose status is
	// pending..completed (kitchen-completed bills stay on the floor).
	TableOpenOrders(ctx context.Context, q database.Querier) ([]domain.BoardOrder, error)
	// TableUnpaidCheckouts lists unpaid central checkouts on a table,
	// limited to the company and branch when given.
	TableUnpaidCheckouts(ctx context.Context, q database.Querier, companyID, branchID *string) ([]domain.BoardCheckout, error)
	// TableHasActiveOrder reports an order in pending..served on the table,
	// other than exceptOrderID when set.
	TableHasActiveOrder(ctx context.Context, q database.Querier, tableID, exceptOrderID string) (bool, error)
	// NextOrderNumber is generate_order_number().
	NextOrderNumber(ctx context.Context, q database.Querier) (string, error)
	// OpenTableBill inserts an empty dine-in order for a seated
	// reservation and returns the whole row (RETURNING *).
	OpenTableBill(ctx context.Context, q database.Querier, bill OpenTableBill) (*Obj, error)

	// DashboardOrders lists the orders placed in [start, end].
	DashboardOrders(ctx context.Context, q database.Querier, start, end time.Time) ([]domain.DashboardOrder, error)
	// PaidOrderTotals lists total_amount of paid, not voided orders placed
	// in [start, end].
	PaidOrderTotals(ctx context.Context, q database.Querier, start, end time.Time) ([]*string, error)
	// DashboardItems lists order items created in [start, end].
	DashboardItems(ctx context.Context, q database.Querier, start, end time.Time) ([]domain.DashboardItem, error)
	// RecentOrders lists the newest orders.
	RecentOrders(ctx context.Context, q database.Querier, limit int) ([]RecentOrder, error)

	// Report reads. startIso and endIso are the TS range strings, cast by
	// PostgreSQL; warehouseIDs nil means every stall.

	// RushHourPoints aggregates paid sales per WIB hour and ISO weekday.
	RushHourPoints(ctx context.Context, q database.Querier, startIso, endIso string, warehouseIDs []string) ([]domain.RushHourPoint, error)
	// VoidedOrders lists voided orders, newest void first, with names and stall.
	VoidedOrders(ctx context.Context, q database.Querier, startIso, endIso string, warehouseIDs []string) ([]VoidOrder, error)
	// OrderLines lists the items of orders by creation.
	OrderLines(ctx context.Context, q database.Querier, orderIDs []string) ([]OrderLine, error)
	// PaymentLegs lists one row per payment (split payments separately).
	PaymentLegs(ctx context.Context, q database.Querier, startIso, endIso string, warehouseIDs []string) ([]PaymentLeg, error)
	// PaidOrders lists paid, not voided orders placed in [start, end],
	// newest first when newestFirst is set.
	PaidOrders(ctx context.Context, q database.Querier, start, end time.Time, newestFirst bool) ([]PaidOrder, error)
	// SaleLines lists the items of orders with their cost snapshot.
	SaleLines(ctx context.Context, q database.Querier, orderIDs []string) ([]SaleLine, error)
	// ClosingOrders lists paid, not voided orders of a WIB day range, of
	// one shift when shiftID is set.
	ClosingOrders(ctx context.Context, q database.Querier, startIso, endIso string, shiftID *string) ([]ClosingOrder, error)
}

// VoidOrder is a voided order of the void report.
type VoidOrder struct {
	ID                                                  string
	OrderNumber, CheckoutNumber, CheckoutID             *string
	OrderedAt, VoidedAt                                 *time.Time
	VoidReason, CreatedByName, VoidedByName             *string
	StallName, StallCode                                *string
	TotalAmount                                         *string
	PaymentMethod, PaymentMethodCode, PaymentMethodName *string
	SoldFrom                                            *string
}

// OrderLine is an order item of the void report.
type OrderLine struct {
	ID, OrderID                      string
	ProductName, ProductSku          *string
	Quantity, UnitPrice, TotalAmount *string
}

// PaymentLeg is one payment of the payment methods report.
type PaymentLeg struct {
	OrderID, HariWib                                    string
	PaymentMethod, PaymentMethodCode, PaymentMethodName *string
	Amount                                              *string
}

// PaidOrder is a paid order of the profit and revenue reports.
type PaidOrder struct {
	ID          string
	OrderNumber *string
	OrderedAt   *time.Time
	CashierID   *string
	TotalAmount *string
}

// SaleLine is an order item with its cost snapshot.
type SaleLine struct {
	OrderID                                     string
	ProductID, ProductName, ProductSku          *string
	Quantity, TotalAmount, CostPrice, CostTotal *string
	GrossProfit, GrossMarginPct                 *string
	Station                                     *string
	DiscountAmount                              *string
}

// ClosingOrder is a paid order of the closing report.
type ClosingOrder struct {
	ID                                                 string
	ShiftID, OrderType                                 *string
	Subtotal, DiscountAmount, TaxAmount, ServiceCharge *string
	TotalAmount                                        *string
	OrderedAt, CompletedAt                             *time.Time
	DiscountReason                                     *string
}

// RecentOrder is a dashboard "recent orders" row.
type RecentOrder struct {
	ID            string
	OrderNumber   *string
	TotalAmount   *string
	Status        *string
	PaymentStatus *string
	OrderedAt     *time.Time
	CashierID     *string
}

// OpenTableBill is the pending, unpaid, zero-total order a seated
// reservation opens on its table.
type OpenTableBill struct {
	OrderNumber string
	CustomerID  *string
	CashierID   string
	TableID     string
	GuestCount  int
	Notes       string
}

// ShiftOrderRef is one element of a shift's embedded pos_orders list.
// Payment holds total_amount, payment_method, amount_paid, ark_coins_used
// when the list is detailed.
type ShiftOrderRef struct {
	ID      string
	Payment *ShiftOrderPayment
}

// ShiftOrderPayment carries the detailed columns; json numbers stay numbers.
type ShiftOrderPayment struct {
	TotalAmount   *float64
	PaymentMethod *string
	AmountPaid    *float64
	ArkCoinsUsed  *float64
}

// MemberBills reads member bill instalments (stored-value).
type MemberBills interface {
	ShiftPayments(ctx context.Context, q database.Querier, shiftID string) ([]domain.MemberBillPayment, error)
}

// Directory reads configuration data: settings, companies, staff names.
type Directory interface {
	// Setting is configuration.app_settings.value, nil when absent.
	Setting(ctx context.Context, q database.Querier, key string) (*string, error)
	// FirstCompanyName is the oldest configuration.companies name.
	FirstCompanyName(ctx context.Context, q database.Querier) (*string, error)
	// UserFullName is configuration.users.full_name.
	UserFullName(ctx context.Context, q database.Querier, userID string) (*string, error)
	// EmployeeNames maps hris.employees ids to their non-empty full names.
	EmployeeNames(ctx context.Context, q database.Querier, ids []string) (map[string]string, error)
	// Branches maps configuration.branches ids to name and code.
	Branches(ctx context.Context, q database.Querier, ids []string) (map[string]Branch, error)
	// ActiveBranches lists active branches {id, name, code} by name.
	ActiveBranches(ctx context.Context, q database.Querier) ([]*Obj, error)
}

// Branch is a configuration.branches row.
type Branch struct{ Name, Code *string }

// WhatsApp sends a free-text notification (lib/whatsapp sendWhatsAppText,
// messageType "notification") and logs it. It never fails the caller.
type WhatsApp interface {
	SendText(ctx context.Context, target, message, sentByUserID string) Delivery
}

// Delivery is the outcome of one send.
type Delivery struct {
	Delivered bool
	Reason    string
}

// Stalls reads stall (warehouse) assignments from configuration.
type Stalls interface {
	// Flags are the user's stall switch and central checkout flags.
	Flags(ctx context.Context, q database.Querier, userID string) (StallFlags, error)
	// Assigned is loadUserWarehouses: active assignments to active stalls,
	// default first, then by name.
	Assigned(ctx context.Context, q database.Querier, userID string) ([]domain.Stall, error)
	// Active is the stall with this id when it is active (findActiveStall).
	Active(ctx context.Context, q database.Querier, id string) (*domain.Stall, error)
	// Branch lists the active stalls, of one branch when branchID is set.
	Branch(ctx context.Context, q database.Querier, branchID *string) ([]domain.Stall, error)
	// BranchByName is Branch ordered by name (the report stall picker).
	BranchByName(ctx context.Context, q database.Querier, branchID *string) ([]domain.Stall, error)
}

// StallFlags are configuration.users' stall columns.
type StallFlags struct {
	CanCentralCheckout bool
	CanSwitchStall     bool
	DefaultWarehouseID *string
}

// Inventory reads purchasing products (item.products, v_products_cogs).
type Inventory interface {
	// ProductIDsForStalls lists the POS products whose purchasing product
	// lives in one of the stalls (by source_product_id or a PUR-<kode> SKU).
	ProductIDsForStalls(ctx context.Context, q database.Querier, warehouseIDs []string) ([]string, error)
	// ProductStalls maps POS product ids to their purchasing stall.
	ProductStalls(ctx context.Context, q database.Querier, productIDs []string) (map[string]ProductStall, error)
	// CogsByKode maps purchasing codes to their estimated COGS.
	CogsByKode(ctx context.Context, q database.Querier, kodes []string) (map[string]Cogs, error)
	// PurchasingProduct is one v_products_cogs row, nil when absent.
	PurchasingProduct(ctx context.Context, q database.Querier, id string) (*PurchasingProduct, error)
	// ItemKategori maps POS product ids to their master item category code.
	ItemKategori(ctx context.Context, q database.Querier, productIDs []string) (map[string]*string, error)
	// ItemCategories lists the live item.product_categories.
	ItemCategories(ctx context.Context, q database.Querier) ([]domain.ItemCategory, error)
	// LowRawMaterials lists active MENIPIS/HABIS raw materials, lowest
	// stock first, at most 100.
	LowRawMaterials(ctx context.Context, q database.Querier) ([]domain.RawMaterialStock, error)
	// ActiveBom lists active BOM lines with their product and material.
	ActiveBom(ctx context.Context, q database.Querier) ([]domain.BomLine, error)
	// MaterialStock maps raw material ids to their stock rows.
	MaterialStock(ctx context.Context, q database.Querier, ids []string) (map[string]domain.RawMaterialStock, error)
}

// ProductStall is a POS product's purchasing stall.
type ProductStall struct {
	WarehouseID, Code, Name *string
}

// Cogs is v_products_cogs' cost estimate (numeric text).
type Cogs struct {
	HppEstimasi, EstimatedCogs *string
}

// PurchasingProduct is the v_products_cogs slice the POS sync copies.
type PurchasingProduct struct {
	ID                                    string
	Kode, Nama, Deskripsi, Kategori       *string
	HargaJual, HppEstimasi, EstimatedCogs *string
	IsActive                              *bool
}

// Shop reads and writes online shop distribution (shop.product_channels).
type Shop interface {
	ProductChannels(ctx context.Context, q database.Querier, productIDs []string) (map[string][]ProductChannel, error)
	// SetWebDistribution upserts the product's 'web' channel row.
	SetWebDistribution(ctx context.Context, q database.Querier, productID string, distributed bool) error
}

// ProductChannel is one embedded channels(channel_code, is_distributed).
type ProductChannel struct {
	ChannelCode   string `json:"channel_code"`
	IsDistributed bool   `json:"is_distributed"`
}

// CRM reads loyalty configuration (crm).
type CRM interface {
	// TierDiscounts maps active membership tier codes (lower case) to their
	// discount percent.
	TierDiscounts(ctx context.Context, q database.Querier) (map[string]float64, error)
	// PosXp lists XP earned at the POS in [start, end]: crm_xp_ledger
	// earn rows first, then the legacy pos_xp_transactions.
	PosXp(ctx context.Context, q database.Querier, start, end time.Time) ([]domain.XpRow, error)
	// ArkCoinEnabled is the CRM ark_coin_enabled flag (true when unreadable).
	ArkCoinEnabled(ctx context.Context, q database.Querier) bool
}

// StoredValue reads the ARK Coin wallet (stored-value).
type StoredValue interface {
	// WalletCredits lists amounts of top-up and bonus wallet transactions
	// created in [start, end].
	WalletCredits(ctx context.Context, q database.Querier, start, end time.Time) ([]*string, error)
}
