package marketing

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// AppSettingsSQL is the stopgap Settings adapter on configuration.app_settings
// (lib/settings/app-settings.ts getSetting/setSetting).
// Stopgap adapter: moves to the settings context.
type AppSettingsSQL struct{}

var _ Settings = AppSettingsSQL{}

// Get returns the value, nil when the key is missing or NULL.
func (AppSettingsSQL) Get(ctx context.Context, q database.Querier, key string) (*string, error) {
	var v *string
	err := q.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = $1`, key).Scan(&v)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return v, err
}

// Set upserts the value.
func (AppSettingsSQL) Set(ctx context.Context, q database.Querier, key, value string) error {
	_, err := q.Exec(ctx, `INSERT INTO configuration.app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value)
	return err
}
