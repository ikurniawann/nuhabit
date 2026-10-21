package app

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymcoaching"
	"nuhabit/backend/internal/modules/gymscheduling"
	"nuhabit/backend/internal/platform/database"
)

// schedulingPT lets the gate check members in to their PT sessions through
// the gym-coaching service, on the gate scan's transaction.
type schedulingPT struct{ svc *gymcoaching.Service }

var _ gymscheduling.PersonalTraining = schedulingPT{}

func (p schedulingPT) LockGateCandidate(ctx context.Context, q database.Querier, customerID string, branchID *string, now time.Time, early, late time.Duration) (*gymscheduling.PTCandidate, error) {
	c, err := p.svc.LockGateCandidate(ctx, q, customerID, branchID, now, early, late)
	if err != nil || c == nil {
		return nil, err
	}
	return &gymscheduling.PTCandidate{
		ParticipantID: c.ParticipantID, AppointmentID: c.AppointmentID, ClassTypeID: c.ClassTypeID, ClassName: c.ClassName,
		CreditCost: c.CreditCost, StartsAt: c.StartsAt, EndsAt: c.EndsAt, Covered: c.Covered,
	}, nil
}

func (p schedulingPT) GateCheckIn(ctx context.Context, q database.Querier, participantID string, now time.Time) (int, bool, error) {
	return p.svc.GateCheckIn(ctx, q, participantID, now)
}
