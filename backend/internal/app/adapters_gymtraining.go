package app

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling"
	"nuhabit/backend/internal/modules/gymtraining"
	"nuhabit/backend/internal/modules/gymtraining/domain"
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
	return catalog(a.r.Coaches(ctx, coachID))
}

func (a gymTrainingScheduling) ClassTypes(ctx context.Context) ([]gymtraining.CatalogEntry, error) {
	return catalog(a.r.ClassTypes(ctx))
}

func (a gymTrainingScheduling) AttendedClassTimes(ctx context.Context, customerID string, since time.Time) ([]time.Time, error) {
	return a.r.AttendedClassTimes(ctx, customerID, since)
}

func catalog(entries []gymscheduling.CatalogEntry, err error) ([]gymtraining.CatalogEntry, error) {
	out := make([]gymtraining.CatalogEntry, len(entries))
	for i, e := range entries {
		out[i] = gymtraining.CatalogEntry(e)
	}
	return out, err
}
