package gymcredits

import (
	"context"
	"encoding/json"

	"nuhabit/backend/internal/platform/database"
)

func (Postgres) NotePurchase(ctx context.Context, q database.Querier, id, note string, meta map[string]any) error {
	raw, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx,
		`UPDATE gym.credit_purchases
		    SET note = concat_ws(' · ', note, $2::text), payment_meta = payment_meta || $3::jsonb, updated_at = now()
		  WHERE id = $1`, id, note, string(raw))
	return err
}
