package kit

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// AppSettings is configuration.app_settings (lib/settings/app-settings.ts):
// the key-value store dashboard settings write. Every method runs on the
// caller's querier so another module can take part in its transaction.
type AppSettings struct{}

// Get is getSetting: the value, nil when the key is missing or NULL.
func (AppSettings) Get(ctx context.Context, q database.Querier, key string) (*string, error) {
	var v *string
	err := q.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = $1`, key).Scan(&v)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return v, err
}

// GetMany is getSettings: every requested key, nil when missing or NULL.
func (AppSettings) GetMany(ctx context.Context, q database.Querier, keys []string) (map[string]*string, error) {
	out := make(map[string]*string, len(keys))
	for _, k := range keys {
		out[k] = nil
	}
	rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`, keys)
	if err != nil {
		return nil, err
	}
	type kv struct {
		Key   string
		Value *string
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByPos[kv])
	if err != nil {
		return nil, err
	}
	for _, r := range list {
		out[r.Key] = r.Value
	}
	return out, nil
}

// Put is setSetting(key, value): an upsert, nil stores NULL.
func (AppSettings) Put(ctx context.Context, q database.Querier, key string, value *string) error {
	_, err := q.Exec(ctx, `INSERT INTO configuration.app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value)
	return err
}

// Set is setSetting with a non-null value.
func (s AppSettings) Set(ctx context.Context, q database.Querier, key, value string) error {
	return s.Put(ctx, q, key, &value)
}

// MaskSecret is maskSecret: "••••" up to 8 characters, else the first and
// last four around eight dots. Secrets are ASCII, so runes equal JS units.
func MaskSecret(value *string) *string {
	if value == nil || *value == "" {
		return nil
	}
	u := []rune(*value)
	var out string
	if len(u) <= 8 {
		out = "••••"
	} else {
		out = string(u[:4]) + "••••••••" + string(u[len(u)-4:])
	}
	return &out
}

// Deref returns *p or "".
func Deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
