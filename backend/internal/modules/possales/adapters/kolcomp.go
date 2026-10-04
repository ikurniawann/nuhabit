package adapters

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/platform/database"
)

// KolComp ports validateKolComp (lib/pos/comp-orders-server.ts): the
// customer must be a KOL and, when a monthly limit is set, this month's KOL
// comps plus this order must fit in it. It is ports.Loyalty's
// ValidateKolComp; internal/app combines it with the CRM XP adapter.
type KolComp struct {
	Now func() time.Time
}

// ValidateKolComp returns "" when allowed, else the cashier message.
// grossIdr is the subtotal before discounts.
func (k KolComp) ValidateKolComp(ctx context.Context, q database.Querier, customerID string, grossIdr float64) (string, error) {
	var isKol *bool
	var limit *float64
	var name *string
	// 42703 (KOL columns not migrated) must not abort the sale's transaction.
	err := savepoint(ctx, q, func(q database.Querier) error {
		return q.QueryRow(ctx, `SELECT is_kol, kol_monthly_limit_idr::float8, name FROM pos.pos_customers WHERE id = $1`, customerID).
			Scan(&isKol, &limit, &name)
	})
	if database.IsNoRows(err) || database.PgCode(err) == "42703" {
		return "Customer tidak ditemukan / fitur KOL belum aktif (migrasi 015)", nil
	}
	if err != nil {
		return "", err
	}
	if isKol == nil || !*isKol {
		label := "Customer"
		if name != nil && *name != "" {
			label = *name
		}
		return label + " bukan KOL — komplimen KOL ditolak", nil
	}
	if limit == nil {
		return "", nil
	}
	now := time.Now
	if k.Now != nil {
		now = k.Now
	}
	var used float64
	err = q.QueryRow(ctx, `SELECT COALESCE(SUM(subtotal), 0)::float8
		FROM pos.pos_orders
		WHERE customer_id = $1
		  AND comp_type = 'kol_comp'
		  AND status NOT IN ('cancelled', 'voided', 'merged')
		  AND ordered_at >= $2`, customerID, domain.MonthStartWIB(now())).Scan(&used)
	if err != nil {
		return "", err
	}
	return domain.KolQuotaAllows(limit, used, grossIdr), nil
}
