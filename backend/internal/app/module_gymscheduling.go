package app

import (
	"context"
	"errors"
	"sort"
	"time"

	"nuhabit/backend/internal/modules/gymcoaching"
	"nuhabit/backend/internal/modules/gymcredits"
	creditsdomain "nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/modules/gymscheduling"
	scheddomain "nuhabit/backend/internal/modules/gymscheduling/domain"
	memberdomain "nuhabit/backend/internal/modules/memberportal/domain"
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
		return gymscheduling.New(d, schedulingPorts(d))
	})
	RegisterJob(gymscheduling.Name, "gym-scheduling.class-reminders", 5*time.Minute, schedulingService, (*gymscheduling.Service).SendClassReminders)
	RegisterJob(gymscheduling.Name, "gym-scheduling.waitlist-offers", time.Minute, schedulingService, (*gymscheduling.Service).SweepWaitlistOffers)
	RegisterJob(gymscheduling.Name, "gym-scheduling.generate-from-templates", time.Hour, schedulingService,
		func(s *gymscheduling.Service, ctx context.Context, now time.Time) error {
			_, err := s.GenerateFromTemplates(ctx, now, 0) // 0: each branch's scheduleHorizonDays
			return err
		})
	RegisterJob(gymscheduling.Name, "gym-scheduling.complete-past-sessions", 10*time.Minute, schedulingService,
		func(s *gymscheduling.Service, ctx context.Context, now time.Time) error {
			_, err := s.CompletePastSessions(ctx, now, 30)
			return err
		})
}

func schedulingPorts(d module.Deps) gymscheduling.Ports { return schedulingPortsOn(d, d.DB) }

// schedulingPortsOn is schedulingPorts with the credit and PT ports on db,
// a transaction in tests.
func schedulingPortsOn(d module.Deps, db gymcredits.DB) gymscheduling.Ports {
	credits := schedulingCredits{svc: gymcredits.NewDefaultService(d, db)}
	return gymscheduling.Ports{
		Credits:       credits,
		Packages:      credits,
		Passes:        credits,
		Rules:         credits,
		Members:       gymscheduling.MembersSQL{},
		Qr:            gymscheduling.QrTokensSQL{},
		Notifier:      gymscheduling.NotificationsSQL{},
		PT:            schedulingPT{svc: gymcoaching.NewService(db, coachingPortsOn(d, db), d.Now, d.Log)},
		WaiverVersion: memberdomain.WaiverVersion,
	}
}

// schedulingService is the scheduling service for background jobs.
func schedulingService(d module.Deps) *gymscheduling.Service {
	return gymscheduling.NewService(d.DB, gymscheduling.Postgres{}, schedulingPorts(d), d.Now)
}

// schedulingCredits adapts gymcredits.Service to the scheduling ports.
type schedulingCredits struct{ svc *gymcredits.Service }

var (
	_ gymscheduling.CreditLedger   = schedulingCredits{}
	_ gymscheduling.CreditPackages = schedulingCredits{}
	_ gymscheduling.Passes         = schedulingCredits{}
	_ gymscheduling.RulesSource    = schedulingCredits{}
	_ gymscheduling.CreditCoverer  = schedulingCredits{}
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

// UsableBalance is the credits that may pay for a class of classTypeID:
// lots restricted to other class types do not count.
func (c schedulingCredits) UsableBalance(ctx context.Context, q database.Querier, customerID, classTypeID string) (int, error) {
	n, err := c.svc.UsableBalance(ctx, q, customerID, classTypeID)
	return n, creditErr(err)
}

// CanCover checks the member's lots against their upcoming bookings plus
// one more, class type by class type.
func (c schedulingCredits) CanCover(ctx context.Context, q database.Querier, customerID string, pending []gymscheduling.CreditDemand, next gymscheduling.CreditDemand) (bool, error) {
	demand := func(d gymscheduling.CreditDemand) creditsdomain.Demand {
		return creditsdomain.Demand{ClassTypeID: d.ClassTypeID, Credits: d.Credits, At: d.At}
	}
	out := make([]creditsdomain.Demand, len(pending))
	for i, d := range pending {
		out[i] = demand(d)
	}
	fits, err := c.svc.CanCover(ctx, q, customerID, out, demand(next))
	return fits, creditErr(err)
}

func (c schedulingCredits) Deduct(ctx context.Context, q database.Querier, in gymscheduling.CreditMovement) (gymscheduling.DeductResult, error) {
	ok, after, err := c.svc.Deduct(ctx, q, move(in))
	return gymscheduling.DeductResult{OK: ok, BalanceAfter: after}, creditErr(err)
}

func (c schedulingCredits) Refund(ctx context.Context, q database.Querier, in gymscheduling.CreditMovement) error {
	return creditErr(c.svc.RefundClass(ctx, q, move(in)))
}

func (c schedulingCredits) ActivePassAt(ctx context.Context, q database.Querier, customerID string, at time.Time) (*gymscheduling.ActivePass, error) {
	p, err := c.svc.ActivePassAt(ctx, q, customerID, at)
	if err != nil || p == nil {
		return nil, creditErr(err)
	}
	return &gymscheduling.ActivePass{ID: p.ID, EndsAt: p.EndsAt, CoversPersonal: p.CoversPersonal}, nil
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
	delete(byID, creditsdomain.PersonalOnly)
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
		MaxConcurrentBookings:     r.MaxConcurrentBookings,
		MaxBookingsPerDay:         r.MaxBookingsPerDay,
		StrikeLimit:               r.StrikeLimit,
		StrikeWindowDays:          r.StrikeWindowDays,
		StrikeSuspendDays:         r.StrikeSuspendDays,
		WaitlistPromoteCutoffMin:  r.WaitlistPromoteCutoffMin,
		WaitlistOfferMinutes:      r.WaitlistOfferMinutes,
		ClassReminderMinutes:      r.ClassReminderMinutes,
		ScheduleHorizonDays:       r.ScheduleHorizonDays,
		RequireWaiver:             r.RequireWaiver,
		CheckinOpensMinBefore:     r.CheckinOpensMinBefore,
		CheckinClosesMinAfter:     r.CheckinClosesMinAfter,
		OpenGymEnabled:            r.OpenGymEnabled,
		OpenGymCreditCost:         r.OpenGymCreditCost,
		CorrectionWindowDays:      r.CorrectionWindowDays,
	}
}
