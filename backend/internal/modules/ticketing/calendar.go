package ticketing

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Per-ticket calendar (product-calendar-server.ts): high season and
// online-block ranges, and the monthly checklist save.

// DateKinds are the ticket_product_dates kinds.
var DateKinds = []string{"high-season", "blok-online"}

// AddProductDate is addProductDateRange.
func (s *Service) AddProductDate(ctx context.Context, v Venue, productID, kind, label, start, end string) (*Row, error) {
	if !domain.IsValidCalendarDate(start) || !domain.IsValidCalendarDate(end) || end < start {
		return nil, httpx.BadRequest("Rentang tanggal tidak valid")
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_products
		WHERE id = $1 AND branch_id = $2 AND company_id = $3)`, productID, v.BranchID, v.CompanyID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, httpx.NotFound(productNotFound)
	}
	return queryRow(ctx, s.db, `INSERT INTO ticketing.ticket_product_dates
		(company_id, branch_id, ticket_product_id, date_kind, label, start_date, end_date, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id`, v.CompanyID, v.BranchID, productID, kind, label, start, end, v.UserID)
}

// DeleteProductDate is deleteProductDateRange.
func (s *Service) DeleteProductDate(ctx context.Context, v Venue, productID, dateID string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM ticketing.ticket_product_dates
		WHERE id = $1 AND ticket_product_id = $2 AND branch_id = $3 AND company_id = $4`,
		dateID, productID, v.BranchID, v.CompanyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Rentang tanggal tidak ditemukan")
	}
	return nil
}

// SaveProductDateMarks is saveProductDateMarks: each checked date becomes
// a one-day row (idempotent), each unchecked date is cut out of the ranges
// that hold it.
func (s *Service) SaveProductDateMarks(ctx context.Context, v Venue, productID, kind string, add, remove []string) error {
	for _, d := range append(append([]string{}, add...), remove...) {
		if !domain.IsValidCalendarDate(d) {
			return httpx.BadRequest("Ada tanggal yang tidak valid")
		}
	}
	if len(add) == 0 && len(remove) == 0 {
		return nil
	}
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if _, _, err := lockProduct(ctx, tx, v, productID); err != nil {
			return err
		}
		for _, date := range remove {
			if err := removeDateMark(ctx, tx, productID, kind, date); err != nil {
				return err
			}
		}
		seen := map[string]bool{}
		for _, date := range add {
			if seen[date] {
				continue
			}
			seen[date] = true
			var marked bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_product_dates
				WHERE ticket_product_id = $1 AND date_kind = $2 AND start_date <= $3 AND end_date >= $3)`,
				productID, kind, date).Scan(&marked); err != nil {
				return err
			}
			if marked {
				continue
			}
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_product_dates
				(company_id, branch_id, ticket_product_id, date_kind, label, start_date, end_date, created_by)
				VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`, v.CompanyID, v.BranchID, productID, kind, date, date, v.UserID); err != nil {
				return err
			}
		}
		return nil
	})
}

func removeDateMark(ctx context.Context, q database.Querier, productID, kind, date string) error {
	type dateRange struct{ id, start, end string }
	var ranges []dateRange
	err := scanAll(ctx, q, `SELECT id::text, start_date::text, end_date::text
		FROM ticketing.ticket_product_dates
		WHERE ticket_product_id = $1 AND date_kind = $2 AND start_date <= $3 AND end_date >= $3`,
		[]any{productID, kind, date}, func(scan func(...any) error) error {
			var r dateRange
			err := scan(&r.id, &r.start, &r.end)
			ranges = append(ranges, r)
			return err
		})
	if err != nil {
		return err
	}
	for _, r := range ranges {
		plan := domain.PlanDateUnmark(r.start, r.end, date)
		var err error
		switch plan.Kind {
		case "delete":
			_, err = q.Exec(ctx, `DELETE FROM ticketing.ticket_product_dates WHERE id = $1`, r.id)
		case "set-start":
			_, err = q.Exec(ctx, `UPDATE ticketing.ticket_product_dates SET start_date = $2, updated_at = now() WHERE id = $1`, r.id, plan.Start)
		case "set-end":
			_, err = q.Exec(ctx, `UPDATE ticketing.ticket_product_dates SET end_date = $2, updated_at = now() WHERE id = $1`, r.id, plan.End)
		case "split":
			if _, err = q.Exec(ctx, `UPDATE ticketing.ticket_product_dates SET end_date = $2, updated_at = now() WHERE id = $1`, r.id, plan.LeftEnd); err == nil {
				_, err = q.Exec(ctx, `INSERT INTO ticketing.ticket_product_dates
					(company_id, branch_id, ticket_product_id, date_kind, label, start_date, end_date)
					SELECT company_id, branch_id, ticket_product_id, date_kind, label, $2::date, $3::date
					FROM ticketing.ticket_product_dates WHERE id = $1`, r.id, plan.RightStart, r.end)
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}
