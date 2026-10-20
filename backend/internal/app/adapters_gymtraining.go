package app

import (
	"context"
	"fmt"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling"
	"nuhabit/backend/internal/modules/gymtraining"
	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/modules/hris"
	"nuhabit/backend/internal/modules/payroll"
	"nuhabit/backend/internal/platform/database"
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
	period, err := payroll.AddToOpenPeriod(ctx, q, payroll.Addition{
		EmployeeID: emp.ID, Amount: p.AmountIDR, Label: "Insentif coach " + p.PeriodMonth,
		SourceType: coachPayoutSource, SourceID: p.PayoutID, CreatedBy: &p.ActorID,
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
