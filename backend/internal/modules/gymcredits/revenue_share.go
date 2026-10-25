package gymcredits

import (
	"context"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// BranchRevenue is the revenue one branch recognised in a period, the base
// of coach revenue-share commission.
type BranchRevenue struct {
	// ClassIDR: credits used at the branch's classes plus pass revenue.
	ClassIDR float64
	// PtIDR: credits used at the branch's PT sessions.
	PtIDR float64
}

// Ledger source types of credits used at a class or a PT session; their
// refunds and reversals carry the same source type.
var (
	classSources = []string{"class_booking", "late_cancel", "no_show"}
	ptSources    = []string{"pt_session", "pt_late_cancel", "pt_no_show"}
)

// RecognisedRevenue is what branchID recognised from [start, end), the way
// the GYM_CREDIT_USAGE journals value it: each credit used at the lot's unit
// price (the lot value over its credits), less the credits given back by
// refunds and reversals in the period. Bonus and adjustment lots carry no
// money and count nothing. Pass revenue is the daily release of passes
// bought at the branch for the days fromDay to toDay (YYYY-MM-DD); it counts
// as class revenue. A pass refund trues its revenue up by journal only, so
// it is not taken back here.
func RecognisedRevenue(ctx context.Context, q database.Querier, branchID string, start, end time.Time, fromDay, toDay string) (BranchRevenue, error) {
	rows, err := q.Query(ctx, `
WITH moves AS (
  SELECT l.lot_id, l.amount, l.source_type = ANY ($5::text[]) AS pt,
         CASE WHEN l.source_type = ANY ($5::text[])
              THEN (SELECT a.branch_id FROM gym.pt_participants p JOIN gym.pt_appointments a ON a.id = p.appointment_id
                     WHERE p.id = l.source_id)
              ELSE (SELECT s.branch_id FROM gym.bookings b JOIN gym.class_sessions s ON s.id = b.session_id
                     WHERE b.id = l.source_id)
         END AS branch_id
    FROM gym.credit_ledger l
   WHERE l.created_at >= $2 AND l.created_at < $3 AND l.lot_id IS NOT NULL
     AND l.type IN ('class_deduction', 'refund', 'reversal')
     AND (l.source_type = ANY ($4::text[]) OR l.source_type = ANY ($5::text[]))
)
SELECT lot_id::text, pt, -sum(amount)::int FROM moves WHERE branch_id = $1 GROUP BY lot_id, pt`,
		branchID, start, end, classSources, ptSources)
	if err != nil {
		return BranchRevenue{}, err
	}
	type used struct {
		LotID   string
		PT      bool
		Credits int
	}
	moves, err := pgx.CollectRows(rows, pgx.RowToStructByPos[used])
	if err != nil {
		return BranchRevenue{}, err
	}
	ids := make([]string, len(moves))
	for i, m := range moves {
		ids[i] = m.LotID
	}
	values, err := Postgres{}.LotValues(ctx, q, ids)
	if err != nil {
		return BranchRevenue{}, err
	}
	var classSen, ptSen int64
	for _, m := range moves {
		v, paid := values[m.LotID]
		if !paid || v.Credits <= 0 {
			continue
		}
		s := int64(math.Round(float64(v.ValueSen) * float64(m.Credits) / float64(v.Credits)))
		if m.PT {
			ptSen += s
		} else {
			classSen += s
		}
	}
	var passIDR float64
	if err := q.QueryRow(ctx, `
SELECT COALESCE(sum(r.amount_idr), 0)::float
  FROM gym.pass_revenue_releases r
  JOIN gym.member_passes mp ON mp.id = r.pass_id
  LEFT JOIN gym.credit_purchases p ON p.id = mp.purchase_id
  LEFT JOIN gym.credit_packages k ON k.id = mp.package_id
 WHERE COALESCE(p.branch_id, k.branch_id) = $1 AND r.release_date BETWEEN $2::date AND $3::date`,
		branchID, fromDay, toDay).Scan(&passIDR); err != nil {
		return BranchRevenue{}, err
	}
	return BranchRevenue{ClassIDR: float64(classSen)/100 + passIDR, PtIDR: float64(ptSen) / 100}, nil
}
