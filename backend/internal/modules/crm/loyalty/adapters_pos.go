package loyalty

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// ArkUsage is one POS order paid (partly) with ARK Coin.
type ArkUsage struct {
	CustomerID   string
	ArkCoinsUsed float64
}

// PosOrders are the pos_orders reads of the CRM dashboard.
type PosOrders interface {
	// ArkUsage is up to 1000 member orders with ark_coins_used > 0.
	ArkUsage(ctx context.Context, q database.Querier) ([]ArkUsage, error)
	// OrderNumbers maps order id to order_number (orders without one are left out).
	OrderNumbers(ctx context.Context, q database.Querier, ids []string) map[string]string
}

// PosOrdersSQL is a stopgap adapter: it moves to pos-sales once it exposes
// these reads. SQL ported from lib/crm/dashboard-server.ts.
type PosOrdersSQL struct{}

var _ PosOrders = PosOrdersSQL{}

func (PosOrdersSQL) ArkUsage(ctx context.Context, q database.Querier) ([]ArkUsage, error) {
	rows, err := q.Query(ctx, `SELECT customer_id::text, COALESCE(ark_coins_used, 0)::float8 FROM pos.pos_orders
		WHERE customer_id IS NOT NULL AND ark_coins_used > 0 LIMIT 1000`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ArkUsage, error) {
		var u ArkUsage
		err := r.Scan(&u.CustomerID, &u.ArkCoinsUsed)
		return u, err
	})
}

func (PosOrdersSQL) OrderNumbers(ctx context.Context, q database.Querier, ids []string) map[string]string {
	out := map[string]string{}
	rows, err := q.Query(ctx, `SELECT id::text, order_number FROM pos.pos_orders WHERE id::text = ANY($1::text[]) AND order_number IS NOT NULL AND order_number <> ''`, ids)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, num string
		if rows.Scan(&id, &num) == nil {
			out[id] = num
		}
	}
	return out
}
