package members

import (
	"context"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
)

// OrdersSQL is a stopgap adapter: moves to pos-sales. It reads pos_orders
// with the SQL the member detail page runs today.
type OrdersSQL struct{}

var _ OrderReads = OrdersSQL{}

// RecentOrders implements OrderReads.
func (OrdersSQL) RecentOrders(ctx context.Context, q database.Querier, customerID string) ([]*kit.Row, error) {
	return kit.Query(ctx, q, `SELECT "id", "order_number", "total_amount", "payment_status", "status", "ordered_at"
		FROM pos.pos_orders WHERE "customer_id" = $1 ORDER BY "ordered_at" DESC LIMIT 10`, customerID)
}

// WalletSQL is a stopgap adapter: moves to stored-value. It reads
// pos_wallet_transactions for the member activity tab.
type WalletSQL struct{}

var _ WalletReads = WalletSQL{}

// Transactions implements WalletReads.
func (WalletSQL) Transactions(ctx context.Context, q database.Querier, customerID string) ([]*kit.Row, error) {
	return kit.Query(ctx, q, `SELECT w.id, w.type, w.amount::float AS amount, w.ark_coins::float AS ark_coins,
                  w.balance_after::float AS balance_after, w.status, w.notes, w.payment_method, w.created_at
             FROM pos.pos_wallet_transactions w
            WHERE w.customer_id = $1 ORDER BY w.created_at DESC LIMIT 100`, customerID)
}
