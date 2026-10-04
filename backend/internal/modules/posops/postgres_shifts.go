package posops

import (
	"context"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// Shift SQL ported from the QueryBuilder calls of app/api/pos/shifts. User
// input reaches typed columns as text (::text::uuid) so PostgreSQL raises
// the same errors node-postgres saw.

// shiftFilter is GET /api/pos/shifts' optional filters.
type shiftFilter struct {
	Status, CashierID, Date *string
}

func (f shiftFilter) where(args *[]any) string {
	var clauses []string
	add := func(column string, v any, cast string) {
		*args = append(*args, v)
		clauses = append(clauses, column+"$"+strconv.Itoa(len(*args))+cast)
	}
	if f.Status != nil {
		add("status = ", *f.Status, "")
	}
	if f.CashierID != nil {
		add("cashier_id = ", *f.CashierID, "::text::uuid")
	}
	if f.Date != nil {
		add("opened_at >= ", *f.Date+"T00:00:00", "::text::timestamptz")
		add("opened_at <= ", *f.Date+"T23:59:59", "::text::timestamptz")
	}
	if len(clauses) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(clauses, " AND ")
}

func countShifts(ctx context.Context, q database.Querier, f shiftFilter) (int, error) {
	var args []any
	var n int
	err := q.QueryRow(ctx, `SELECT count(*)::int FROM pos.pos_shifts`+f.where(&args), args...).Scan(&n)
	return n, err
}

func listShifts(ctx context.Context, q database.Querier, f shiftFilter, limit, offset int64) ([]*Obj, error) {
	var args []any
	where := f.where(&args)
	args = append(args, limit, offset)
	n := len(args)
	return QueryObjs(ctx, q, `SELECT * FROM pos.pos_shifts`+where+
		` ORDER BY opened_at DESC LIMIT $`+strconv.Itoa(n-1)+` OFFSET $`+strconv.Itoa(n), args...)
}

func currentShift(ctx context.Context, q database.Querier, cashierID string) (*Obj, error) {
	return QueryObj(ctx, q, `SELECT * FROM pos.pos_shifts
		WHERE cashier_id = $1::text::uuid AND status = 'active'
		ORDER BY opened_at DESC LIMIT 1`, cashierID)
}

func activeShiftOf(ctx context.Context, q database.Querier, cashierID any) (*Obj, error) {
	return QueryObj(ctx, q, `SELECT id, shift_number, opened_at FROM pos.pos_shifts
		WHERE cashier_id = $1::text::uuid AND status = 'active'`, cashierID)
}

func generateShiftNumber(ctx context.Context, q database.Querier) (*string, error) {
	var n *string
	err := q.QueryRow(ctx, `SELECT * FROM generate_shift_number()`).Scan(&n)
	return n, err
}

func insertShift(ctx context.Context, q database.Querier, number string, cashierID, openingCash, notes any, openedBy string) (*Obj, error) {
	return QueryObj(ctx, q, `INSERT INTO pos.pos_shifts (shift_number, cashier_id, opening_cash, notes, status, opened_by)
		VALUES ($1, $2::text::uuid, $3, $4, 'active', $5) RETURNING *`,
		number, cashierID, openingCash, notes, openedBy)
}

// shiftForClose is the shift row the close validates.
type shiftForClose struct {
	ID          string
	Status      *string
	OpeningCash string
}

func loadShiftForClose(ctx context.Context, q database.Querier, id string) (*shiftForClose, error) {
	var s shiftForClose
	err := q.QueryRow(ctx, `SELECT id::text, status, opening_cash::text FROM pos.pos_shifts WHERE id = $1::text::uuid FOR UPDATE`, id).
		Scan(&s.ID, &s.Status, &s.OpeningCash)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// shiftClose is the update the close writes.
type shiftClose struct {
	ClosedBy                                     string
	ClosingCash, ExpectedCash                    float64
	Cash, Qris, Debit, Credit, ArkCoin, TotalSum float64
	TotalOrders                                  int
	Notes                                        *string
}

func closeShift(ctx context.Context, q database.Querier, id string, c shiftClose) (*Obj, error) {
	return QueryObj(ctx, q, `UPDATE pos.pos_shifts SET
		status = 'closed', closed_at = now(), closed_by = $2, closing_cash = $3, expected_cash = $4,
		total_cash_sales = $5, total_qris_sales = $6, total_debit_sales = $7, total_credit_sales = $8,
		total_ark_coin_sales = $9, total_sales = $10, total_orders = $11, notes = $12, updated_at = now()
		WHERE id = $1::text::uuid RETURNING *`,
		id, c.ClosedBy, c.ClosingCash, c.ExpectedCash, c.Cash, c.Qris, c.Debit, c.Credit, c.ArkCoin,
		c.TotalSum, c.TotalOrders, c.Notes)
}

// shiftReportRow is the closed shift the WhatsApp report reads.
type shiftReportRow struct {
	ShiftNumber *string
	Status      *string
	OpenedAt    *time.Time
	ClosedAt    *time.Time
	OpeningCash *string
	ClosingCash *string
	Expected    *string
	TotalOrders *int
	TotalSales  *string
	CashierID   string
}

func loadShiftReport(ctx context.Context, q database.Querier, id string) (*shiftReportRow, error) {
	var s shiftReportRow
	err := q.QueryRow(ctx, `SELECT shift_number, status, opened_at, closed_at, opening_cash::text,
		closing_cash::text, expected_cash::text, total_orders, total_sales::text, cashier_id::text
		FROM pos.pos_shifts WHERE id = $1::text::uuid`, id).
		Scan(&s.ShiftNumber, &s.Status, &s.OpenedAt, &s.ClosedAt, &s.OpeningCash, &s.ClosingCash,
			&s.Expected, &s.TotalOrders, &s.TotalSales, &s.CashierID)
	if err != nil {
		return nil, err
	}
	return &s, nil
}
