package hris

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Holidays is the read service other contexts use to see the active public
// holidays (hris.public_holidays, every type). It runs on the caller's
// Querier.
type Holidays struct{}

// Between maps each active holiday date in [from, to] (YYYY-MM-DD) to its
// name; holidays sharing a date are joined with " · ".
func (Holidays) Between(ctx context.Context, q database.Querier, from, to string) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT holiday_date::text, string_agg(name, ' · ' ORDER BY name)
		FROM hris.public_holidays
		WHERE deleted_at IS NULL AND status = 'aktif' AND holiday_date BETWEEN $1::date AND $2::date
		GROUP BY holiday_date`, from, to)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	var date, name string
	_, err = pgx.ForEachRow(rows, []any{&date, &name}, func() error {
		out[date] = name
		return nil
	})
	return out, err
}
