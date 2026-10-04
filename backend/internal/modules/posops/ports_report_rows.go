package posops

import (
	"context"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// ReportRows reads the product sales and transaction report rows from
// pos-sales tables (pos_orders, pos_order_items, pos_checkouts). startIso
// and endIso are the TS range strings; warehouseIDs nil means every stall.
// Numeric and bigint columns arrive as text, as node-postgres returns them.
type ReportRows interface {
	// ProductSales groups paid order items by product and stall, by revenue.
	ProductSales(ctx context.Context, q database.Querier, startIso, endIso string, warehouseIDs []string) ([]ProductSalesRow, error)
	// Transactions lists paid orders, newest first, with their stall.
	Transactions(ctx context.Context, q database.Querier, startIso, endIso string, warehouseIDs []string) ([]TransactionRow, error)
	// StallSales sums the items of orders per item stall, by sales.
	StallSales(ctx context.Context, q database.Querier, orderIDs []string) ([]StallSalesRow, error)
	// TopProducts sums the items of orders per product name, at most 50.
	TopProducts(ctx context.Context, q database.Querier, orderIDs []string) ([]TopProductRow, error)
}

// ProductSalesRow is one product and stall of the product sales report.
type ProductSalesRow struct {
	ProductID, ProductName, ProductSku *string
	WarehouseID, StallCode, StallName  *string
	Quantity, Revenue, OrderCount      *string
}

// TransactionRow is a paid order of the transaction report.
type TransactionRow struct {
	ID                                                  string
	OrderNumber                                         *string
	OrderedAt                                           *time.Time
	Status, PaymentStatus                               *string
	PaymentMethod, PaymentMethodCode, PaymentMethodName *string
	Subtotal, DiscountAmount, TaxAmount                 *string
	ServiceChargeAmount, TotalAmount, ArkCoinsUsed      *string
	CashierID, WarehouseID, StallCode, StallName        *string
	CheckoutID, CheckoutNumber, SoldFrom                *string
	XenditQrID, XenditExternalID                        *string
	HariWib                                             string
	CompType, CompApprovedName                          *string
}

// StallSalesRow is one stall of the transaction report's per_stall list.
type StallSalesRow struct {
	StallCode, StallName *string
	Transactions         *string
	Quantity, Sales      *float64
}

// TopProductRow is one product of the transaction report's top list.
type TopProductRow struct {
	ProductName       string
	Quantity, Revenue *float64
}
