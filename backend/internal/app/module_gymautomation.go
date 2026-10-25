package app

import (
	"context"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymautomation"
	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/modules/memberportal"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jobs"
	"nuhabit/backend/internal/platform/module"
)

// gym-automation: the gym background jobs page (switches, settings, manual
// runs) and the member notification log.
func init() {
	Register(gymautomation.Name, func(d module.Deps) module.Module {
		return gymautomation.New(d, GymAutomationPorts(d))
	})
}

// GymAutomationPorts lists the registered gym jobs and reads the global
// gym rules from gym-credits. The module's integration tests use it too.
func GymAutomationPorts(d module.Deps) gymautomation.Ports {
	return gymautomation.Ports{
		Jobs:  gymJobs{deps: d},
		Rules: gymRules{svc: gymcredits.NewDefaultService(d, d.DB), q: d.DB},
	}
}

// isGymJob: the jobs of the gym modules and the member portal's referral
// rewards (gym referrals).
func isGymJob(j jobSpec) bool {
	return strings.HasPrefix(j.module, "gym-") || j.module == memberportal.Name
}

// gymJobs serves the registry's gym jobs. A manual run builds the job like
// the runner does and takes the same lock (jobs.PostgresLocker), so it never
// overlaps a scheduled run on any replica, even when this process does not
// run jobs (JOBS_ENABLED off) or does not mount the job's module.
type gymJobs struct{ deps module.Deps }

var _ gymautomation.Jobs = gymJobs{}

func (g gymJobs) List() []gymautomation.Job {
	var out []gymautomation.Job
	for _, j := range jobRegistry {
		if isGymJob(j) {
			out = append(out, gymautomation.Job{Name: j.name, Module: j.module, Every: j.every})
		}
	}
	return out
}

func (g gymJobs) Run(ctx context.Context, name string, now time.Time) error {
	for _, j := range jobRegistry {
		if j.name == name && isGymJob(j) {
			job := jobs.Job{Name: j.name, Every: j.every, Run: j.build(g.deps)}
			return jobs.RunNow(ctx, jobs.PostgresLocker{DB: g.deps.DB}, job, now)
		}
	}
	return gymautomation.ErrUnknownJob
}

// gymRules reads the global gym rules on q.
type gymRules struct {
	svc *gymcredits.Service
	q   database.Querier
}

func (g gymRules) GlobalRules(ctx context.Context) (gymautomation.Rules, error) {
	r, err := g.svc.Rules(ctx, g.q, nil)
	return gymautomation.Rules{
		ClassReminderMinutes: r.ClassReminderMinutes,
		LowBalanceThreshold:  r.LowBalanceThreshold,
		ExpiryReminderDays:   r.ExpiryReminderDays,
	}, err
}
