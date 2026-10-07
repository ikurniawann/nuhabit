package ledger

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/inventory"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
)

// CapitalizeLandedCosts runs inventory.apply_landed_costs for the given
// additional costs (active or just deleted) and for the active costs on the
// given GRNs and their POs: each cost's allocation to the posted raw
// material lines of its document moves into the stock value (or, with no
// stock left, is expensed). Every cost that moved publishes
// inventory.landed_cost.applied for the journals, dated today in Jakarta.
// The function is shared with the TS routes (lib/purchasing/landed-cost.ts).
func CapitalizeLandedCosts(ctx context.Context, q database.Querier, costIDs, grnIDs []string, userID string, now time.Time) error {
	rows, err := q.Query(ctx, `SELECT batch_id::text, cost_id::text, company_id::text, capitalized::float8, expensed::float8
		FROM inventory.apply_landed_costs($1::uuid[], $2::uuid[], $3::uuid)`, costIDs, grnIDs, strOrNil(userID))
	if err != nil {
		return err
	}
	applied, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (contracts.LandedCostApplied, error) {
		var a contracts.LandedCostApplied
		return a, r.Scan(&a.BatchID, &a.CostID, &a.CompanyID, &a.Capitalized, &a.Expensed)
	})
	if err != nil {
		return err
	}
	date := kit.TodayJakarta(now)
	for _, a := range applied {
		a.UserID, a.EntryDate = userID, date
		if err := outbox.Publish(ctx, q, contracts.TopicLandedCostApplied, a.BatchID, a); err != nil {
			return err
		}
	}
	return nil
}
