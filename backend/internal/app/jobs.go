package app

import (
	"context"
	"fmt"
	"time"

	"nuhabit/backend/internal/platform/jobs"
	"nuhabit/backend/internal/platform/module"
)

type jobSpec struct {
	module string
	name   string
	every  time.Duration
	build  func(module.Deps) func(ctx context.Context, now time.Time) error
}

// jobRegistry is filled from init(), like registry.
var jobRegistry []jobSpec

// RegisterJob adds a background job: the method run of the module service
// that service builds. Call it from init() in the module's wiring file, one
// line per job:
//
//	RegisterJob(gymcredits.Name, "gym-credits.reminders", time.Hour, creditsService, (*gymcredits.Service).SendCreditReminders)
//
// The job runs only in processes that mount the module (MODULES) and have
// JOBS_ENABLED on. name is also the metric label and the lock key, so keep
// it stable.
func RegisterJob[S any](moduleName, name string, every time.Duration, service func(module.Deps) S, run func(S, context.Context, time.Time) error) {
	for _, j := range jobRegistry {
		if j.name == name {
			panic(fmt.Sprintf("app: job %q registered twice", name))
		}
	}
	jobRegistry = append(jobRegistry, jobSpec{module: moduleName, name: name, every: every,
		build: func(d module.Deps) func(context.Context, time.Time) error {
			svc := service(d)
			return func(ctx context.Context, now time.Time) error { return run(svc, ctx, now) }
		},
	})
}

// Jobs builds the jobs of the modules MODULES selects, in registration order.
func Jobs(deps module.Deps) []jobs.Job {
	var out []jobs.Job
	for _, j := range jobRegistry {
		if !deps.Config.ModuleEnabled(j.module) {
			continue
		}
		out = append(out, jobs.Job{Name: j.name, Every: j.every, Run: j.build(deps)})
	}
	return out
}
