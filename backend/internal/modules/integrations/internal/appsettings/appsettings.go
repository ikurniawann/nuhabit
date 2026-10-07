// Package appsettings is lib/settings/app-settings.ts for the integration
// keys: key/value rows in configuration.app_settings and the secret mask the
// settings pages show.
package appsettings

import (
	"context"
	"unicode/utf16"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/validate"
)

// Get is getSetting: nil when the row is missing or NULL.
func Get(ctx context.Context, q database.Querier, key string) (*string, error) {
	var value *string
	err := q.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = $1`, key).Scan(&value)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return value, err
}

// Values is getSettings' map: every requested key, nil when unset.
type Values map[string]*string

// Str is `map[key] ?? ""`.
func (v Values) Str(key string) string {
	if p := v[key]; p != nil {
		return *p
	}
	return ""
}

// Trimmed is `map[key]?.trim() || ""`.
func (v Values) Trimmed(key string) string { return validate.JSTrim(v.Str(key)) }

// GetMany is getSettings.
func GetMany(ctx context.Context, q database.Querier, keys ...string) (Values, error) {
	out := make(Values, len(keys))
	for _, k := range keys {
		out[k] = nil
	}
	rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var value *string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		out[key] = value
	}
	return out, rows.Err()
}

// Set is setSetting: upsert, nil stores NULL.
func Set(ctx context.Context, q database.Querier, key string, value *string) error {
	_, err := q.Exec(ctx, `INSERT INTO configuration.app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value)
	return err
}

// Ptr returns &s, or nil for "" (the TS `value || null`).
func Ptr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Mask is maskSecret from app-settings: null for an empty value, "••••" up
// to 8 UTF-16 units, else the first and last 4 units around eight bullets.
func Mask(value *string) *string {
	if value == nil || *value == "" {
		return nil
	}
	units := utf16.Encode([]rune(*value))
	m := "••••"
	if len(units) > 8 {
		m = string(utf16.Decode(units[:4])) + "••••••••" + string(utf16.Decode(units[len(units)-4:]))
	}
	return &m
}
