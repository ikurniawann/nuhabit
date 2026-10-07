package engagement

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// OrdersSQL implements OrderReads on pos.pos_orders with the SQL of
// challengeValues and listMemberReviews.
// Stopgap adapter: moves to pos-sales.
type OrdersSQL struct{}

var _ OrderReads = OrdersSQL{}

// ChallengeValues implements OrderReads.
func (OrdersSQL) ChallengeValues(ctx context.Context, q database.Querier, metric string, from, to time.Time, customerIDs []string) (map[string]float64, error) {
	value := `COALESCE(sum(o.total_amount), 0)`
	if metric == "visits" {
		value = `count(DISTINCT (o.created_at AT TIME ZONE 'Asia/Jakarta')::date)`
	}
	rows, err := q.Query(ctx, `SELECT o.customer_id::text, (`+value+`)::float8
	   FROM pos.pos_orders o
	  WHERE o.customer_id = ANY($1::uuid[]) AND o.payment_status = 'paid'
	    AND o.created_at BETWEEN $2 AND $3
	  GROUP BY o.customer_id`, customerIDs, from, to)
	if err != nil {
		return nil, err
	}
	out := map[string]float64{}
	var id string
	var v float64
	_, err = pgx.ForEachRow(rows, []any{&id, &v}, func() error {
		out[id] = v
		return nil
	})
	return out, err
}

// OrderSummaries implements OrderReads.
func (OrdersSQL) OrderSummaries(ctx context.Context, q database.Querier, orderIDs []string) (map[string]OrderSummary, error) {
	rows, err := q.Query(ctx, `SELECT id::text, order_number, total_amount::float8 FROM pos.pos_orders WHERE id = ANY($1::uuid[])`, orderIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]OrderSummary{}
	for rows.Next() {
		var id string
		var s OrderSummary
		if err := rows.Scan(&id, &s.Number, &s.Total); err != nil {
			return nil, err
		}
		out[id] = s
	}
	return out, rows.Err()
}
