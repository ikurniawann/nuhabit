package gymscheduling

import (
	"context"
	"errors"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// testCredits backs the credit and rules ports with the gym-credits service,
// the same way internal/app/module_gymscheduling.go wires them (that adapter
// cannot be imported from here without an import cycle).
type testCredits struct{ svc *gymcredits.Service }

func newTestCredits(db gymcredits.DB) testCredits {
	return testCredits{svc: gymcredits.NewDefaultService(module.Deps{}, db)}
}

func creditErr(err error) error {
	var ce *gymcredits.Error
	if errors.As(err, &ce) {
		return httpx.Status(ce.Status, ce.Message)
	}
	return err
}

func toMove(m CreditMovement) gymcredits.CreditMove {
	return gymcredits.CreditMove{CustomerID: m.CustomerID, Amount: m.Amount, SourceType: m.SourceType,
		SourceID: m.SourceID, IdempotencyKey: m.IdempotencyKey, Note: m.Note}
}

func (c testCredits) GetBalance(ctx context.Context, q database.Querier, id string) (int, error) {
	n, err := c.svc.Balance(ctx, q, id)
	return n, creditErr(err)
}

func (c testCredits) Deduct(ctx context.Context, q database.Querier, in CreditMovement) (DeductResult, error) {
	ok, after, err := c.svc.Deduct(ctx, q, toMove(in))
	return DeductResult{OK: ok, BalanceAfter: after}, creditErr(err)
}

func (c testCredits) Refund(ctx context.Context, q database.Querier, in CreditMovement) error {
	return creditErr(c.svc.RefundClass(ctx, q, toMove(in)))
}

func (c testCredits) CoveredClassTypeIDs(ctx context.Context, q database.Querier, id string) ([]string, error) {
	ids, err := c.svc.CoveredClassTypeIDs(ctx, q, id)
	return ids, creditErr(err)
}

func (testCredits) Coverage(ctx context.Context, q database.Querier) ([]PackageCoverage, error) {
	byID, err := gymcredits.Postgres{}.PackageCoverage(ctx, q)
	out := make([]PackageCoverage, 0, len(byID))
	for id, ids := range byID {
		out = append(out, PackageCoverage{ID: id, ClassTypeIDs: ids})
	}
	return out, err
}

func (c testCredits) ForBranch(ctx context.Context, q database.Querier, branchID *string) (domain.Rules, error) {
	r, err := c.svc.Rules(ctx, q, branchID)
	return domain.Rules{
		CancellationDeadlineHours: r.CancellationDeadlineHours,
		LateCancelPolicy:          domain.CreditPolicy(r.LateCancelPolicy),
		NoShowPolicy:              domain.CreditPolicy(r.NoShowPolicy),
		ReEntryGraceMin:           r.ReEntryGraceMin,
		AntiPassbackMin:           r.AntiPassbackMin,
		WaitlistAutoPromote:       r.WaitlistAutoPromote,
		BookingOpensDaysBefore:    r.BookingOpensDaysBefore,
		BookingClosesMinBefore:    r.BookingClosesMinBefore,
	}, err
}
