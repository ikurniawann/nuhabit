package shop

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Channels is shop.product_channels, the online distribution of POS
// products, for the adapters in internal/app. Every method runs on the
// caller's Querier.
type Channels struct{}

// Channel is one channel row of a product.
type Channel struct {
	ChannelCode   string
	IsDistributed bool
}

// Web maps the products distributed to the web channel to their channel
// price override (nil when none). A non-empty productID limits it to that
// product.
func (Channels) Web(ctx context.Context, q database.Querier, productID string) (map[string]*string, error) {
	rows, err := q.Query(ctx, `SELECT product_id::text, price_override::text FROM shop.product_channels
		WHERE channel_code = 'web' AND is_distributed AND ($1 = '' OR product_id = $1::text::uuid)`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]*string{}
	for rows.Next() {
		var id string
		var price *string
		if err := rows.Scan(&id, &price); err != nil {
			return nil, err
		}
		out[id] = price
	}
	return out, rows.Err()
}

// ByProduct lists the channel rows of the products.
func (Channels) ByProduct(ctx context.Context, q database.Querier, productIDs []string) (map[string][]Channel, error) {
	rows, err := q.Query(ctx, `SELECT product_id::text, channel_code, is_distributed
		FROM shop.product_channels WHERE product_id = ANY($1::uuid[])`, productIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]Channel{}
	for rows.Next() {
		var id string
		var c Channel
		if err := rows.Scan(&id, &c.ChannelCode, &c.IsDistributed); err != nil {
			return nil, err
		}
		out[id] = append(out[id], c)
	}
	return out, rows.Err()
}

// SetWeb upserts the product's 'web' channel row.
func (Channels) SetWeb(ctx context.Context, q database.Querier, productID string, distributed bool) error {
	_, err := q.Exec(ctx, `INSERT INTO shop.product_channels (product_id, channel_code, is_distributed)
		VALUES ($1::text::uuid, 'web', $2)
		ON CONFLICT (product_id, channel_code)
		DO UPDATE SET is_distributed = EXCLUDED.is_distributed, updated_at = now()`, productID, distributed)
	return err
}
