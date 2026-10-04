package ticketing

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
)

// The ticketing report (reports-server.ts). Days are venue days (WIB);
// aggregation is domain.BuildTicketingReport.

// dayExpr is the WIB calendar day of a timestamptz column.
func dayExpr(col string) string { return "(" + col + " AT TIME ZONE 'Asia/Jakarta')::date" }

// Report is loadTicketingReport for [from..to].
func (s *Service) Report(ctx context.Context, v Venue, from, to string) (domain.Report, error) {
	var rows domain.ReportRows
	q := s.db
	ranged := []any{v.BranchID, v.CompanyID, from, to}

	err := scanAll(ctx, q, `SELECT `+dayExpr("c.created_at")+`::text,
		  COALESCE(orig.charge_type, c.charge_type),
		  SUM(CASE WHEN c.direction = 'debit' THEN c.amount ELSE -c.amount END)::float8,
		  SUM(CASE WHEN c.direction = 'debit' THEN 1 ELSE -1 END)::float8
		FROM ticketing.ticket_visit_charges c
		LEFT JOIN ticketing.ticket_visit_charges orig ON orig.id = c.voided_by_charge_id
		WHERE c.branch_id = $1 AND c.company_id = $2
		  AND `+dayExpr("c.created_at")+` BETWEEN $3 AND $4
		GROUP BY 1, 2`, ranged, func(scan func(...any) error) error {
		var r domain.LedgerRow
		err := scan(&r.Day, &r.EffType, &r.Net, &r.Qty)
		rows.Ledger = append(rows.Ledger, r)
		return err
	})
	if err != nil {
		return domain.Report{}, err
	}

	if err = scanAll(ctx, q, `SELECT ctx.j->>'variant_id', ctx.j->>'channel_id', ctx.j->>'season_kind', ctx.j->>'bundle_product_id',
		  SUM(CASE WHEN c.direction = 'debit' THEN c.amount ELSE -c.amount END)::float8,
		  SUM(CASE WHEN c.direction = 'debit' THEN 1 ELSE -1 END)::float8
		FROM ticketing.ticket_visit_charges c
		LEFT JOIN ticketing.ticket_visit_charges orig ON orig.id = c.voided_by_charge_id
		CROSS JOIN LATERAL (SELECT COALESCE(c.price_context, orig.price_context, '{}'::jsonb) AS j) ctx
		WHERE c.branch_id = $1 AND c.company_id = $2
		  AND COALESCE(orig.charge_type, c.charge_type) = 'tiket'
		  AND `+dayExpr("c.created_at")+` BETWEEN $3 AND $4
		GROUP BY 1, 2, 3, 4`, ranged, func(scan func(...any) error) error {
		var r domain.TicketContextRow
		err := scan(&r.VariantID, &r.ChannelID, &r.SeasonKind, &r.BundleProductID, &r.Net, &r.Qty)
		rows.TicketContexts = append(rows.TicketContexts, r)
		return err
	}); err != nil {
		return domain.Report{}, err
	}

	if err = scanAll(ctx, q, `SELECT c.charge_type, COALESCE(c.payment_method, 'lainnya'), SUM(c.amount)::float8
		FROM ticketing.ticket_visit_charges c
		WHERE c.branch_id = $1 AND c.company_id = $2
		  AND c.charge_type IN ('deposit', 'pembayaran', 'refund-deposit')
		  AND `+dayExpr("c.created_at")+` BETWEEN $3 AND $4
		GROUP BY 1, 2
		ORDER BY 1, 2`, ranged, func(scan func(...any) error) error {
		var r domain.MethodRow
		err := scan(&r.ChargeType, &r.Method, &r.Total)
		rows.Methods = append(rows.Methods, r)
		return err
	}); err != nil {
		return domain.Report{}, err
	}

	counts := []struct {
		sql  string
		args []any
		dst  *[]domain.CountRow
		day  bool
	}{
		{`SELECT ` + dayExpr("created_at") + `::text, result, COUNT(*) FROM ticketing.ticket_gate_events
			WHERE branch_id = $1 AND company_id = $2 AND ` + dayExpr("created_at") + ` BETWEEN $3 AND $4
			GROUP BY 1, 2`, ranged, &rows.GateDaily, true},
		{`SELECT ` + dayExpr("opened_at") + `::text, COUNT(*) FROM ticketing.ticket_visits
			WHERE branch_id = $1 AND company_id = $2 AND ` + dayExpr("opened_at") + ` BETWEEN $3 AND $4
			GROUP BY 1`, ranged, &rows.VisitDaily, false},
		{`SELECT status, COUNT(*) FROM ticketing.ticket_bands
			WHERE branch_id = $1 AND company_id = $2 GROUP BY 1`, ranged[:2], &rows.BandsRecap, false},
	}
	for _, c := range counts {
		if err = scanAll(ctx, q, c.sql, c.args, func(scan func(...any) error) error {
			var r domain.CountRow
			var err error
			if c.day {
				err = scan(&r.Day, &r.Key, &r.N)
			} else {
				err = scan(&r.Key, &r.N)
			}
			*c.dst = append(*c.dst, r)
			return err
		}); err != nil {
			return domain.Report{}, err
		}
	}

	if err = scanAll(ctx, q, `SELECT v.id::text, v.contact_name, v.payment_mode, v.opened_at,
		  COALESCE(SUM(CASE WHEN c.direction = 'debit' THEN c.amount ELSE -c.amount END), 0)::float8
		FROM ticketing.ticket_visits v
		LEFT JOIN ticketing.ticket_visit_charges c ON c.visit_id = v.id
		WHERE v.branch_id = $1 AND v.company_id = $2 AND v.status = 'open'
		GROUP BY v.id
		HAVING COALESCE(SUM(CASE WHEN c.direction = 'debit' THEN c.amount ELSE -c.amount END), 0) > 0
		ORDER BY v.opened_at
		LIMIT 50`, /* HANGING_LIMIT */ ranged[:2], func(scan func(...any) error) error {
		var r domain.HangingTab
		var opened time.Time
		err := scan(&r.ID, &r.ContactName, &r.PaymentMode, &opened, &r.Outstanding)
		r.OpenedAt = domain.JSDate(opened)
		rows.Hanging = append(rows.Hanging, r)
		return err
	}); err != nil {
		return domain.Report{}, err
	}

	rows.VariantNames = map[string]domain.VariantName{}
	if err = scanAll(ctx, q, `SELECT pv.id::text, pv.name, tp.name
		FROM ticketing.ticket_product_variants pv
		JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
		WHERE pv.branch_id = $1 AND pv.company_id = $2`, ranged[:2], func(scan func(...any) error) error {
		var id string
		var n domain.VariantName
		err := scan(&id, &n.VariantName, &n.ProductName)
		rows.VariantNames[id] = n
		return err
	}); err != nil {
		return domain.Report{}, err
	}
	if rows.ChannelNames, err = names(ctx, q, `SELECT id::text, name FROM ticketing.ticket_channels
		WHERE branch_id = $1 AND company_id = $2`, v); err != nil {
		return domain.Report{}, err
	}
	if rows.BundleNames, err = names(ctx, q, `SELECT id::text, name FROM ticketing.ticket_products
		WHERE branch_id = $1 AND company_id = $2 AND product_kind = 'bundle'`, v); err != nil {
		return domain.Report{}, err
	}

	// Deposits: paid and not yet redeemed (now). Forfeits: in the range.
	if err = q.QueryRow(ctx, `SELECT COUNT(*), COALESCE(SUM(total), 0)::float8 FROM ticketing.ticket_bookings
		WHERE branch_id = $1 AND company_id = $2 AND status = 'terbayar' AND visit_id IS NULL`,
		v.BranchID, v.CompanyID).Scan(&rows.DepositCount, &rows.DepositTotal); err != nil {
		return domain.Report{}, err
	}
	if err = q.QueryRow(ctx, `SELECT COUNT(*), COALESCE(SUM(total), 0)::float8 FROM ticketing.ticket_bookings
		WHERE branch_id = $1 AND company_id = $2 AND status = 'hangus'
		  AND `+dayExpr("forfeited_at")+` BETWEEN $3 AND $4`, ranged...).Scan(&rows.ForfeitedCount, &rows.ForfeitedTotal); err != nil {
		return domain.Report{}, err
	}
	return domain.BuildTicketingReport(from, to, rows), nil
}

func names(ctx context.Context, q database.Querier, sql string, v Venue) (map[string]string, error) {
	out := map[string]string{}
	err := scanAll(ctx, q, sql, []any{v.BranchID, v.CompanyID}, func(scan func(...any) error) error {
		var id, name string
		err := scan(&id, &name)
		out[id] = name
		return err
	})
	return out, err
}
