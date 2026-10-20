package payroll

import (
	"context"
	"errors"

	"nuhabit/backend/internal/platform/database"
)

// Payroll additions (hris.payroll_additions) are one-off taxable earnings
// other contexts hand to payroll, such as a paid coach incentive. Calculating
// a draft run adds an employee's additions for the period to the slip's
// bonus, so they reach the gross, the PPh 21 base and the run's journal.

// Addition is one earning for one employee.
type Addition struct {
	EmployeeID string
	Amount     float64
	Label      string
	// SourceType and SourceID name what created the addition; a source adds
	// at most one row.
	SourceType string
	SourceID   string
	CreatedBy  *string
}

// Period is a payroll period.
type Period struct{ Month, Year int }

// next is the period after p.
func (p Period) next() Period {
	if p.Month == 12 {
		return Period{1, p.Year + 1}
	}
	return Period{p.Month + 1, p.Year}
}

// periodSearchLimit bounds the look-ahead for a period without a closed run.
const periodSearchLimit = 24

// ErrDuplicateAddition is returned when the source already added a row.
var ErrDuplicateAddition = errors.New("payroll: source already has an addition")

// AddToOpenPeriod stores a in the first period from `from` on whose payroll
// run is missing or still a draft, so the next calculation picks it up, and
// returns that period. It runs on q, the caller's transaction.
func AddToOpenPeriod(ctx context.Context, q database.Querier, a Addition, from Period) (Period, error) {
	p := from
	for range periodSearchLimit {
		var closed bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM hris.payroll_runs
			WHERE period_month = $1 AND period_year = $2 AND status <> 'draft')`, p.Month, p.Year).Scan(&closed); err != nil {
			return Period{}, err
		}
		if !closed {
			break
		}
		p = p.next()
	}
	tag, err := q.Exec(ctx, `INSERT INTO hris.payroll_additions
		(employee_id, period_month, period_year, amount, label, source_type, source_id, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (source_type, source_id) DO NOTHING`,
		a.EmployeeID, p.Month, p.Year, a.Amount, a.Label, a.SourceType, a.SourceID, a.CreatedBy)
	if err != nil {
		return Period{}, err
	}
	if tag.RowsAffected() == 0 {
		return Period{}, ErrDuplicateAddition
	}
	return p, nil
}

// HasActiveSalary reports whether payroll would calculate the employee: an
// active salary structure exists.
func HasActiveSalary(ctx context.Context, q database.Querier, employeeID string) (bool, error) {
	s, err := activeSalary(ctx, q, employeeID)
	return s != nil, err
}

// periodAdditions is the sum of the employee's additions for a period.
func periodAdditions(ctx context.Context, q database.Querier, employeeID string, month, year int) (float64, error) {
	var total float64
	err := q.QueryRow(ctx, `SELECT COALESCE(sum(amount), 0)::float8 FROM hris.payroll_additions
		WHERE employee_id = $1 AND period_month = $2 AND period_year = $3`, employeeID, month, year).Scan(&total)
	return total, err
}
