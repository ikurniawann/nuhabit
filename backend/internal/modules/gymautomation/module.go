// Package gymautomation is the Gym → Otomasi & Pengingat page: the gym
// background jobs with their last runs (platform.job_runs), an on/off switch
// and settings per job (platform.job_settings, which the job runner and the
// jobs read), a manual run through the runner's lock, the gym rules the
// reminders follow, and the reminders and notifications one member received
// (platform.reminder_sends, crm.member_notifications).
//
// The jobs themselves live in their modules and are registered in
// internal/app, which hands them over through the Jobs port.
package gymautomation

import (
	"context"
	"errors"
	"time"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "gym-automation"

// Job is a registered background job.
type Job struct {
	Name   string
	Module string
	Every  time.Duration
}

// ErrUnknownJob is a job name that is not registered.
var ErrUnknownJob = errors.New("gym-automation: unknown job")

// Jobs lists the gym jobs and runs one on demand.
type Jobs interface {
	List() []Job
	// Run runs the job once now under its lock. It returns jobs.ErrBusy
	// while another run holds the lock, ErrUnknownJob for a name List does
	// not have, and the job's own error when it fails.
	Run(ctx context.Context, name string, now time.Time) error
}

// Rules are the global gym rules the reminder jobs follow.
type Rules struct {
	ClassReminderMinutes int
	LowBalanceThreshold  int
	ExpiryReminderDays   int
}

// RulesSource reads the global gym rules (gym-credits owns them).
type RulesSource interface {
	GlobalRules(ctx context.Context) (Rules, error)
}

// Ports are the adapters internal/app wires in.
type Ports struct {
	Jobs  Jobs
	Rules RulesSource
}

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module.
func New(deps module.Deps, ports Ports) module.Module {
	return NewOn(deps.DB, deps.Auth, deps.Now, ports)
}

// NewOn builds the module on db (a rolled-back transaction in tests).
func NewOn(db database.Querier, guard auth.Granter, now func() time.Time, ports Ports) module.Module {
	if now == nil {
		now = time.Now
	}
	return mod{h: &handler{svc: &Service{db: db, ports: ports, now: now}, guard: guard}}
}
