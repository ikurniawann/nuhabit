package app

import (
	"context"
	"errors"
	"sort"

	"nuhabit/backend/internal/modules/gymcredits"
	creditsdomain "nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/modules/gymscheduling"
	scheddomain "nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// gym-scheduling: class types, coaches, sessions, bookings, gate check-in.
//
// Credits, package coverage and business rules come from the gym-credits
// service, on the caller's transaction. Members, QR tokens and member
// notifications still use the module's stopgap SQL adapters until the
// POS/CRM modules expose those operations.
func init() {
	Register(gymscheduling.Name, func(d module.Deps) module.Module {
		credits := schedulingCredits{svc: gymcredits.NewDefaultService(d, d.DB)}
		return gymscheduling.New(d, gymscheduling.Ports{
			Credits:  credits,
			Packages: credits,
			Rules:    credits,
			Members:  gymscheduling.MembersSQL{},
			Qr:       gymscheduling.QrTokensSQL{},
			Notifier: gymscheduling.NotificationsSQL{},
		})
	})
}

// schedulingCredits adapts gymcredits.Service to the scheduling ports.
type schedulingCredits struct{ svc *gymcredits.Service }

var (
	_ gymscheduling.CreditLedger   = schedulingCredits{}
	_ gymscheduling.CreditPackages = schedulingCredits{}
	_ gymscheduling.RulesSource    = schedulingCredits{}
)

// creditErr turns a gym-credits rule failure into the transport error the
// scheduling handlers render.
func creditErr(err error) error {
	var ce *gymcredits.Error
	if errors.As(err, &ce) {
		return httpx.Status(ce.Status, ce.Message)
	}
	return err
}

func move(m gymscheduling.CreditMovement) gymcredits.CreditMove {
	return gymcredits.CreditMove{
		CustomerID: m.CustomerID, Amount: m.Amount, SourceType: m.SourceType,
		SourceID: m.SourceID, IdempotencyKey: m.IdempotencyKey, Note: m.Note,
	}
}

func (c schedulingCredits) GetBalance(ctx context.Context, q database.Querier, customerID string) (int, error) {
	n, err := c.svc.Balance(ctx, q, customerID)
	return n, creditErr(err)
}

func (c schedulingCredits) Deduct(ctx context.Context, q database.Querier, in gymscheduling.CreditMovement) (gymscheduling.DeductResult, error) {
	ok, after, err := c.svc.Deduct(ctx, q, move(in))
	return gymscheduling.DeductResult{OK: ok, BalanceAfter: after}, creditErr(err)
}

func (c schedulingCredits) Refund(ctx context.Context, q database.Querier, in gymscheduling.CreditMovement) error {
	return creditErr(c.svc.RefundClass(ctx, q, move(in)))
}

func (c schedulingCredits) CoveredClassTypeIDs(ctx context.Context, q database.Querier, customerID string) ([]string, error) {
	ids, err := c.svc.CoveredClassTypeIDs(ctx, q, customerID)
	return ids, creditErr(err)
}

// Coverage lists every package (archived too) with the class types it covers.
func (schedulingCredits) Coverage(ctx context.Context, q database.Querier) ([]gymscheduling.PackageCoverage, error) {
	byID, err := gymcredits.Postgres{}.PackageCoverage(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]gymscheduling.PackageCoverage, 0, len(byID))
	for id, ids := range byID {
		out = append(out, gymscheduling.PackageCoverage{ID: id, ClassTypeIDs: ids})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (c schedulingCredits) ForBranch(ctx context.Context, q database.Querier, branchID *string) (scheddomain.Rules, error) {
	r, err := c.svc.Rules(ctx, q, branchID)
	if err != nil {
		return scheddomain.Rules{}, err
	}
	return schedulingRules(r), nil
}

func schedulingRules(r creditsdomain.Rules) scheddomain.Rules {
	return scheddomain.Rules{
		CancellationDeadlineHours: r.CancellationDeadlineHours,
		LateCancelPolicy:          scheddomain.CreditPolicy(r.LateCancelPolicy),
		NoShowPolicy:              scheddomain.CreditPolicy(r.NoShowPolicy),
		ReEntryGraceMin:           r.ReEntryGraceMin,
		AntiPassbackMin:           r.AntiPassbackMin,
		WaitlistAutoPromote:       r.WaitlistAutoPromote,
		BookingOpensDaysBefore:    r.BookingOpensDaysBefore,
		BookingClosesMinBefore:    r.BookingClosesMinBefore,
	}
}
