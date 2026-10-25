package app

import (
	"context"
	"fmt"
	"time"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/gymscheduling"
	"nuhabit/backend/internal/modules/gymtraining"
	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/modules/hris"
	"nuhabit/backend/internal/modules/payroll"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/members"
)

// gymTrainingScheduling serves gym-training's Scheduling port from
// gym-scheduling's Reader.
type gymTrainingScheduling struct{ r *gymscheduling.Reader }

var _ gymtraining.Scheduling = gymTrainingScheduling{}

func (a gymTrainingScheduling) CompletedSessionsForCoachMonth(ctx context.Context, start, end time.Time, coachID *string) ([]domain.StatementSession, error) {
	classes, err := a.r.CompletedClasses(ctx, start, end, coachID)
	out := make([]domain.StatementSession, len(classes))
	for i, c := range classes {
		out[i] = domain.StatementSession(c)
	}
	return out, err
}

func (a gymTrainingScheduling) Coaches(ctx context.Context, coachID *string) ([]gymtraining.CatalogEntry, error) {
	return gymCatalog(a.r.Coaches(ctx, coachID))
}

func (a gymTrainingScheduling) ClassTypes(ctx context.Context) ([]gymtraining.CatalogEntry, error) {
	return gymCatalog(a.r.ClassTypes(ctx))
}

func (a gymTrainingScheduling) AttendedClassTimes(ctx context.Context, customerID string, since time.Time) ([]time.Time, error) {
	return a.r.AttendedClassTimes(ctx, customerID, since)
}

func (a gymTrainingScheduling) CoachForUser(ctx context.Context, userID string) (string, error) {
	return a.r.CoachForUser(ctx, userID)
}

// gymTrainingPayroll serves gym-training's Payroll port: the coach's staff
// account leads to its hris.employees row, and the payout becomes a payroll
// addition there. The payroll run journals it with the rest of the gross
// when it is paid, so no journal is posted here.
type gymTrainingPayroll struct{ employees hris.Employees }

var _ gymtraining.Payroll = gymTrainingPayroll{}

// coachPayoutSource is hris.payroll_additions.source_type of a coach payout.
const coachPayoutSource = "gym.coach_payout"

func (a gymTrainingPayroll) PostIncentive(ctx context.Context, q database.Querier, p gymtraining.IncentivePosting) (string, error) {
	userID, err := gymscheduling.NewReader(q).CoachUserID(ctx, p.CoachID)
	if err != nil {
		return "", err
	}
	if userID == "" {
		return "", gymtraining.ErrCoachNotEmployee
	}
	emp, err := a.employees.ByUserID(ctx, q, userID)
	if err != nil {
		return "", err
	}
	if emp == nil {
		return "", gymtraining.ErrCoachNotEmployee
	}
	payable := false
	if emp.IsActive {
		if payable, err = payroll.HasActiveSalary(ctx, q, emp.ID); err != nil {
			return "", err
		}
	}
	if !payable {
		return "", gymtraining.ErrEmployeeNotPayable
	}
	from, err := time.Parse("2006-01", p.FromMonth)
	if err != nil {
		return "", err
	}
	source, label := p.SourceType, p.Label
	if source == "" {
		source, label = coachPayoutSource, "Insentif coach "+p.PeriodMonth
	}
	period, err := payroll.AddToOpenPeriod(ctx, q, payroll.Addition{
		EmployeeID: emp.ID, Amount: p.AmountIDR, Label: label,
		SourceType: source, SourceID: p.PayoutID, CreatedBy: &p.ActorID,
	}, payroll.Period{Month: int(from.Month()), Year: from.Year()})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d-%02d", period.Year, period.Month), nil
}

func gymCatalog(entries []gymscheduling.CatalogEntry, err error) ([]gymtraining.CatalogEntry, error) {
	out := make([]gymtraining.CatalogEntry, len(entries))
	for i, e := range entries {
		out[i] = gymtraining.CatalogEntry(e)
	}
	return out, err
}

// gymTrainingCommission reads the revenue a branch recognised from
// gym-credits and the sessions each coach taught from gym-scheduling.
type gymTrainingCommission struct{}

var _ gymtraining.CommissionSources = gymTrainingCommission{}

func (gymTrainingCommission) BranchRevenue(ctx context.Context, q database.Querier, branchID string, start, end time.Time, fromDay, toDay string) (float64, float64, error) {
	r, err := gymcredits.RecognisedRevenue(ctx, q, branchID, start, end, fromDay, toDay)
	return r.ClassIDR, r.PtIDR, err
}

func (gymTrainingCommission) CoachActivity(ctx context.Context, q database.Querier, start, end time.Time) ([]gymtraining.CoachActivity, error) {
	rows, err := gymscheduling.NewReader(q).CoachActivity(ctx, start, end)
	out := make([]gymtraining.CoachActivity, len(rows))
	for i, a := range rows {
		out[i] = gymtraining.CoachActivity(a)
	}
	return out, err
}

// gymTrainingNotifier stores gym-training's member notifications through
// platform/members (the inbox row plus the push, WhatsApp and email delivery).
type gymTrainingNotifier struct{}

var _ gymtraining.Notifier = gymTrainingNotifier{}

func (gymTrainingNotifier) NotifyMember(ctx context.Context, q database.Querier, customerID string, n gymtraining.Notification) error {
	return members.Notify(ctx, q, customerID, members.Notice(n))
}
