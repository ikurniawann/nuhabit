package payroll

import (
	"context"
	"time"

	"nuhabit/backend/internal/platform/module"
)

// Jobs are the background jobs of the module, for app.RegisterJob.
type Jobs struct{ svc *service }

// NewJobs builds the jobs on the pool.
func NewJobs(deps module.Deps, ports Ports) *Jobs {
	m := NewOn(deps, deps.DB, ports).(payrollModule)
	return &Jobs{svc: m.svc}
}

// MaterializeOccurrences is the dept-tasks.recurrence job.
func (j *Jobs) MaterializeOccurrences(ctx context.Context, now time.Time) error {
	return j.svc.MaterializeOccurrences(ctx, now)
}

// SendReminders is the dept-tasks.reminders job.
func (j *Jobs) SendReminders(ctx context.Context, now time.Time) error {
	return j.svc.SendReminders(ctx, now)
}
