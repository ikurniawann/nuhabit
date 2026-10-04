package app

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/giftcards"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// storedValueGiftCardPorts wires the gift card adapters.
func storedValueGiftCardPorts(d module.Deps) giftcards.Ports {
	return giftcards.Ports{Settings: appSettings{}, Catalog: posCatalog{}}
}

// appSettings is configuration.app_settings (lib/settings/app-settings
// getSetting / setSetting); the settings context is in no porting wave.
type appSettings struct{}

func (appSettings) Get(ctx context.Context, q database.Querier, key string) (*string, error) {
	var v *string
	err := q.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = $1`, key).Scan(&v)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return v, err
}

func (appSettings) Set(ctx context.Context, q database.Querier, key, value string) error {
	_, err := q.Exec(ctx, `INSERT INTO configuration.app_settings (key, value, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value)
	return err
}

// posCatalog reads pos.pos_products for prepareGiftCardSale. The ids go
// as text[] so an id that is not a uuid fails in PostgreSQL (22P02), as
// in the TS query.
type posCatalog struct{}

func (posCatalog) GiftCardProductIDs(ctx context.Context, q database.Querier, ids []string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT id::text FROM pos.pos_products
		WHERE id = ANY($1::text[]::uuid[]) AND product_kind = 'gift_card'`, ids)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
