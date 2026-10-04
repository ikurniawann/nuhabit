package posops

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// posCategoryNames maps POS products to their POS category name; a blank
// name becomes fallback ("" for none). Products without a found category
// are absent.
func posCategoryNames(ctx context.Context, q database.Querier, productIDs []string, fallback string) (map[string]*string, error) {
	out := map[string]*string{}
	if len(productIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT pp.id::text, c.name FROM pos.pos_products pp
		JOIN pos.pos_categories c ON c.id = pp.category_id WHERE pp.id = ANY($1::uuid[])`, productIDs)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var name *string
		if err := rows.Scan(&id, &name); err != nil {
			return out, err
		}
		if name == nil || *name == "" {
			name = nil
			if fallback != "" {
				name = &fallback
			}
		}
		out[id] = name
	}
	return out, rows.Err()
}

// closingShift is a shift opened on the closing report's day.
type closingShift struct {
	ID                    string
	ShiftNumber, BranchID *string
	ClosedAt              *time.Time
}

func closingShifts(ctx context.Context, q database.Querier, startIso, endIso string) ([]closingShift, error) {
	rows, err := q.Query(ctx, `SELECT id::text, shift_number, branch_id::text, closed_at FROM pos.pos_shifts
		WHERE opened_at >= $1::text::timestamptz AND opened_at <= $2::text::timestamptz
		ORDER BY opened_at ASC`, startIso, endIso)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (closingShift, error) {
		var s closingShift
		err := r.Scan(&s.ID, &s.ShiftNumber, &s.BranchID, &s.ClosedAt)
		return s, err
	})
}

// paymentCatalogRow is an active pos.payment_methods row.
type paymentCatalogRow struct {
	Code, Name string
	SortOrder  int
}

func activePaymentCatalog(ctx context.Context, q database.Querier) ([]paymentCatalogRow, error) {
	rows, err := q.Query(ctx, `SELECT code, name, sort_order FROM pos.payment_methods
		WHERE is_active = true ORDER BY sort_order ASC, name ASC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (paymentCatalogRow, error) {
		var c paymentCatalogRow
		err := r.Scan(&c.Code, &c.Name, &c.SortOrder)
		return c, err
	})
}
