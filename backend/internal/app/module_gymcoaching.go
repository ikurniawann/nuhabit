package app

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymcoaching"
	coachingdomain "nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/gymscheduling"
	scheddomain "nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// gym-coaching: personal training (coach availability, PT appointments)
// and fitness assessments.
//
// PT credits and the business rules come from gym-credits, the coach
// timetable lock and overlap check from gym-scheduling, on the caller's
// transaction. Member notifications use the scheduling notifier, which
// publishes gym.member.notified.
func init() {
	Register(gymcoaching.Name, func(d module.Deps) module.Module {
		return gymcoaching.New(d, coachingPorts(d))
	})
	RegisterJob(gymcoaching.Name, "gym-coaching.pt-reminders", 5*time.Minute, coachingService, (*gymcoaching.Service).SendReminders)
	RegisterJob(gymcoaching.Name, "gym-coaching.complete-past-appointments", 10*time.Minute, coachingService, (*gymcoaching.Service).CompletePastAppointments)
}

func coachingPorts(d module.Deps) gymcoaching.Ports { return coachingPortsOn(d, d.DB) }

// coachingPortsOn is coachingPorts with the credit ports on db, a
// transaction in tests.
func coachingPortsOn(d module.Deps, db gymcredits.DB) gymcoaching.Ports {
	credits := coachingCredits{svc: gymcredits.NewDefaultService(d, db)}
	return gymcoaching.Ports{
		Credits: credits, Passes: credits, Rules: credits, Schedule: coachingSchedule{}, Notifier: coachingNotifier{},
		Staff: newCoachingStaff(d),
	}
}

// coachingService is the gym-coaching service for background jobs.
func coachingService(d module.Deps) *gymcoaching.Service {
	return gymcoaching.NewService(d.DB, coachingPorts(d), d.Now, d.Log)
}

// coachingCredits adapts gymcredits.Service to the PT credit and rules ports.
type coachingCredits struct{ svc *gymcredits.Service }

var (
	_ gymcoaching.Credits     = coachingCredits{}
	_ gymcoaching.Passes      = coachingCredits{}
	_ gymcoaching.RulesSource = coachingCredits{}
)

func (c coachingCredits) UsableBalance(ctx context.Context, q database.Querier, customerID, classTypeID string) (int, error) {
	n, err := c.svc.UsableBalance(ctx, q, customerID, classTypeID)
	return n, creditErr(err)
}

func (c coachingCredits) Deduct(ctx context.Context, q database.Querier, m gymcoaching.CreditMove) (bool, error) {
	ok, _, err := c.svc.Deduct(ctx, q, gymcredits.CreditMove{
		CustomerID: m.CustomerID, Amount: m.Amount, ClassTypeID: m.ClassTypeID, SourceType: m.SourceType,
		SourceID: m.SourceID, IdempotencyKey: m.IdempotencyKey, Note: m.Note,
	})
	return ok, creditErr(err)
}

func (c coachingCredits) ActivePassAt(ctx context.Context, q database.Querier, customerID string, at time.Time) (*gymcoaching.ActivePass, error) {
	p, err := c.svc.ActivePassAt(ctx, q, customerID, at)
	if err != nil || p == nil {
		return nil, creditErr(err)
	}
	return &gymcoaching.ActivePass{ID: p.ID, CoversPersonal: p.CoversPersonal}, nil
}

func (c coachingCredits) ForBranch(ctx context.Context, q database.Querier, branchID *string) (coachingdomain.Rules, error) {
	r, err := c.svc.Rules(ctx, q, branchID)
	return coachingdomain.Rules{
		CancellationDeadlineHours: r.CancellationDeadlineHours,
		LateCancelPolicy:          coachingdomain.Policy(r.LateCancelPolicy),
		NoShowPolicy:              coachingdomain.Policy(r.NoShowPolicy),
		ReminderMinutes:           r.ClassReminderMinutes,
		RescheduleLimit:           r.PtRescheduleLimit,
	}, err
}

// coachingSchedule checks a PT time against the coach's classes and other
// PT sessions with the gym-scheduling timetable query and lock.
type coachingSchedule struct{}

var _ gymcoaching.Schedule = coachingSchedule{}

func (coachingSchedule) Lock(ctx context.Context, q database.Querier) error {
	return gymscheduling.Postgres{}.LockSchedule(ctx, q)
}

func (coachingSchedule) CoachClash(ctx context.Context, q database.Querier, appointmentID, coachID string, start, end time.Time) (string, error) {
	slot := scheddomain.Slot{ID: appointmentID, CoachID: &coachID, StartsAt: start, EndsAt: end}
	others, err := gymscheduling.Postgres{}.ScheduleNeighbours(ctx, q, slot)
	if err != nil {
		return "", err
	}
	if clash := scheddomain.FindScheduleConflict(slot, others); clash != nil {
		return clash.Message(), nil
	}
	return "", nil
}

// coachingNotifier stores PT notifications like class ones.
type coachingNotifier struct{}

func (coachingNotifier) NotifyMember(ctx context.Context, q database.Querier, customerID string, n gymcoaching.Notification) error {
	return gymscheduling.NotificationsSQL{}.NotifyMember(ctx, q, customerID, gymscheduling.Notification(n))
}
