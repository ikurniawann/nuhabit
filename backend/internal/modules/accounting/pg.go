package accounting

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// ts is a timestamptz (or date) column as node-pg hands it to
// NextResponse.json: a Date serialized by toISOString.
type ts time.Time

// MarshalJSON writes "2026-10-04T08:00:00.000Z".
func (t ts) MarshalJSON() ([]byte, error) { return httpx.JSTime(t).MarshalJSON() }

// Scan reads a timestamptz or date value.
func (t *ts) Scan(src any) error {
	v, ok := src.(time.Time)
	if !ok {
		return fmt.Errorf("accounting.ts: cannot scan %T", src)
	}
	*t = ts(v)
	return nil
}

// jsDate is a date column read through `i.*`, which the AP/AR stores
// stringify with String(date).slice(0, 10) ("Sun Aug 09").
type jsDate string

// Scan reads a date value.
func (d *jsDate) Scan(src any) error {
	v, ok := src.(time.Time)
	if !ok {
		return fmt.Errorf("accounting.jsDate: cannot scan %T", src)
	}
	*d = jsDate(domain.JSDateString(v))
	return nil
}

func collect[T any](ctx context.Context, q database.Querier, sql string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[T])
	if out == nil {
		out = []T{}
	}
	return out, err
}

// one returns nil when the query has no row.
func one[T any](ctx context.Context, q database.Querier, sql string, args ...any) (*T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	v, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByPos[T])
	if database.IsNoRows(err) {
		return nil, nil
	}
	return v, err
}

func scalar[T any](ctx context.Context, q database.Querier, sql string, args ...any) (T, bool, error) {
	var v T
	err := q.QueryRow(ctx, sql, args...).Scan(&v)
	if database.IsNoRows(err) {
		return v, false, nil
	}
	return v, err == nil, err
}

// rejection turns a domain rule failure into the transport error.
func rejection(err error) error {
	if r, ok := err.(*domain.Rejection); ok {
		return httpx.Status(r.Status, r.Message)
	}
	return err
}

func jsTrim(s string) string { return validate.JSTrim(s) }

// trimOrNull is `value?.trim() || null` for an optional string.
func trimOrNull(s *string) *string {
	if s == nil {
		return nil
	}
	v := jsTrim(*s)
	if v == "" {
		return nil
	}
	return &v
}

// strOrNull is `value || null`.
func strOrNull(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}
