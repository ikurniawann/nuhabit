package reports

import (
	"context"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
)

// PosReportsSQL is a stopgap adapter: it moves to pos-sales / stored-value
// once they expose report reads. SQL ported from lib/crm/reports-server.ts.
type PosReportsSQL struct{}

var _ PosReports = PosReportsSQL{}

// paidOrderFilter: paid, not cancelled/voided, with a member, in the period.
const paidOrderFilter = `
  o.payment_status = 'paid'
  AND (o.status IS NULL OR o.status NOT IN ('cancelled', 'voided'))
  AND o.customer_id IS NOT NULL
  AND o.created_at >= $1 AND o.created_at < $2`

func (PosReportsSQL) TopSpenders(ctx context.Context, q database.Querier, from, to string) ([]*kit.Row, error) {
	return kit.Query(ctx, q, `SELECT c.id, c.name, c.phone, c.membership_tier, c.member_type,
              COUNT(o.id) AS order_count,
              COALESCE(SUM(o.total_amount), 0) AS total_spend,
              COALESCE(SUM(o.ark_coins_used), 0) AS ark_spend,
              MAX(o.created_at) AS last_order_at
       FROM pos.pos_orders o
       JOIN pos.pos_customers c ON c.id = o.customer_id
       WHERE `+paidOrderFilter+`
       GROUP BY c.id
       ORDER BY total_spend DESC
       LIMIT 20`, from, to)
}

func (PosReportsSQL) FrequentVisitors(ctx context.Context, q database.Querier, from, to string) ([]*kit.Row, error) {
	return kit.Query(ctx, q, `SELECT c.id, c.name, c.phone, c.membership_tier, c.member_type,
              COUNT(o.id) AS order_count,
              COUNT(DISTINCT (o.created_at AT TIME ZONE 'Asia/Jakarta')::date) AS visit_days,
              MAX(o.created_at) AS last_visit_at,
              c.visit_count AS lifetime_visits
       FROM pos.pos_orders o
       JOIN pos.pos_customers c ON c.id = o.customer_id
       WHERE `+paidOrderFilter+`
       GROUP BY c.id
       ORDER BY visit_days DESC, order_count DESC
       LIMIT 20`, from, to)
}

func (PosReportsSQL) VenueReconciliation(ctx context.Context, q database.Querier, from, to string) ([]*kit.Row, error) {
	return kit.Query(ctx, q, `SELECT w.company_id, w.branch_id,
              co.name AS company_name,
              br.name AS branch_name,
              COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'topup' AND COALESCE(w.payment_method, '') <> 'foc'), 0) AS topup_amount,
              COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'topup' AND w.payment_method = 'foc'), 0) AS foc_topup_amount,
              COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'topup_bonus'), 0) AS bonus_amount,
              COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'payment'), 0) AS spend_amount,
              COALESCE(SUM(w.amount) FILTER (WHERE w.type NOT IN ('topup', 'topup_bonus', 'payment')), 0) AS other_amount,
              COUNT(*) FILTER (WHERE w.type = 'topup' AND COALESCE(w.payment_method, '') <> 'foc') AS topup_count,
              COUNT(*) FILTER (WHERE w.type = 'topup' AND w.payment_method = 'foc') AS foc_topup_count,
              COUNT(*) FILTER (WHERE w.type = 'payment') AS payment_count
       FROM pos.pos_wallet_transactions w
       LEFT JOIN configuration.companies co ON co.id = w.company_id
       LEFT JOIN configuration.branches br ON br.id = w.branch_id
       WHERE w.created_at >= $1 AND w.created_at < $2
         AND w.company_id IS NOT NULL
       GROUP BY w.company_id, w.branch_id, co.name, br.name
       ORDER BY topup_amount DESC, spend_amount DESC`, from, to)
}

func (PosReportsSQL) UntaggedTopups(ctx context.Context, q database.Querier, from, to string) (*kit.Row, error) {
	return kit.QueryOne(ctx, q, `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'topup' AND COALESCE(payment_method, '') <> 'foc'), 0) AS topup_amount,
         COUNT(*) FILTER (WHERE type = 'topup' AND COALESCE(payment_method, '') <> 'foc') AS topup_count
       FROM pos.pos_wallet_transactions
       WHERE created_at >= $1 AND created_at < $2 AND company_id IS NULL`, from, to)
}

func (PosReportsSQL) MemberSummary(ctx context.Context, q database.Querier) (*kit.Row, error) {
	return kit.QueryOne(ctx, q, `SELECT
         (SELECT COALESCE(SUM(ark_coin_balance), 0) FROM pos.pos_customers WHERE is_active) AS outstanding_balance,
         (SELECT COUNT(*) FROM pos.pos_customers WHERE is_active AND member_type = 'card') AS card_members,
         (SELECT COUNT(*) FROM pos.pos_customers WHERE is_active AND member_type = 'registered') AS registered_members`)
}
