package inbox

import (
	"context"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
)

// PosOrdersSQL is a stopgap adapter: moves to pos-sales once it exposes a
// member order read. SQL ported from lib/crm/inbox-server.ts.
type PosOrdersSQL struct{}

var _ PosOrders = PosOrdersSQL{}

// RecentOrders are the member's five latest orders.
func (PosOrdersSQL) RecentOrders(ctx context.Context, q database.Querier, customerID string) ([]*kit.Row, error) {
	return kit.Query(ctx, q, `SELECT id, order_number, total_amount::float AS total_amount,
              payment_method, status, created_at
         FROM pos.pos_orders
        WHERE customer_id = $1
        ORDER BY created_at DESC LIMIT 5`, customerID)
}
