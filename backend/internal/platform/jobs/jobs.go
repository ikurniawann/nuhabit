// Package jobs runs periodic background work inside the API process.
//
// Modules hand their jobs to internal/app (RegisterJobs in the module's
// wiring file); cmd/api starts one Runner with the jobs of the mounted
// modules. A Locker decides whether this process may run a job now: the
// Postgres locker takes a session advisory lock per job and starts a run only
// when the previous one, on any replica, started at least one interval ago.
// Jobs must be idempotent: a crash mid-run means the next run repeats work.
package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/metrics"
)

// Job is one periodic task. Run gets the time the run started.
type Job struct {
	Name  string
	Every time.Duration
	Run   func(ctx context.Context, now time.Time) error
}

// Locker grants one process the right to run a job.
type Locker interface {
	// Acquire returns ok=false when another process is running the job or
	// a run started less than every before now. release records the outcome
	// and frees the lock; call it exactly once when ok.
	Acquire(ctx context.Context, name string, every time.Duration, now time.Time) (release func(runErr error), ok bool, err error)
}

// Runner runs jobs on their intervals.
type Runner struct {
	locker Locker
	log    *slog.Logger
	now    func() time.Time
	jobs   []Job

	runs        *metrics.CounterVec
	failures    *metrics.CounterVec
	skipped     *metrics.CounterVec
	lastSuccess *metrics.GaugeVec
	duration    *metrics.HistogramVec
}

// durationBuckets cover a quick sweep up to a slow reconciliation, in seconds.
var durationBuckets = []float64{0.05, 0.1, 0.5, 1, 5, 15, 60, 300}

// NewRunner registers the job metrics on reg.
func NewRunner(locker Locker, log *slog.Logger, now func() time.Time, reg *metrics.Registry) *Runner {
	if now == nil {
		now = time.Now
	}
	return &Runner{
		locker:      locker,
		log:         log,
		now:         now,
		runs:        reg.NewCounterVec("job_runs_total", "Background job runs started by this process.", "job"),
		failures:    reg.NewCounterVec("job_failures_total", "Background job runs that returned an error, or could not take the lock.", "job"),
		skipped:     reg.NewCounterVec("job_skipped_total", "Ticks skipped because another process held the job or it ran less than one interval ago.", "job"),
		lastSuccess: reg.NewGaugeVec("job_last_success_timestamp_seconds", "Unix time of the last successful run by this process.", "job"),
		duration:    reg.NewHistogramVec("job_duration_seconds", "Background job run duration.", durationBuckets, "job"),
	}
}

// Add queues jobs for Start. It panics on an empty name, a non-positive
// interval, a nil Run or a duplicate name: those are wiring bugs.
func (r *Runner) Add(jobs ...Job) {
	for _, j := range jobs {
		if j.Name == "" || j.Every <= 0 || j.Run == nil {
			panic(fmt.Sprintf("jobs: invalid job %q (every %s)", j.Name, j.Every))
		}
		for _, have := range r.jobs {
			if have.Name == j.Name {
				panic(fmt.Sprintf("jobs: job %q added twice", j.Name))
			}
		}
		r.jobs = append(r.jobs, j)
	}
}

// Names lists the queued jobs in the order they were added.
func (r *Runner) Names() []string {
	names := make([]string, len(r.jobs))
	for i, j := range r.jobs {
		names[i] = j.Name
	}
	return names
}

// Run ticks every job until ctx ends: once at start, then every interval.
// It returns when all job loops have stopped.
func (r *Runner) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for _, j := range r.jobs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r.loop(ctx, j)
		}()
	}
	wg.Wait()
}

func (r *Runner) loop(ctx context.Context, j Job) {
	tick := time.NewTicker(j.Every)
	defer tick.Stop()
	for {
		_, _ = r.RunOnce(ctx, j)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// RunOnce runs j now when the locker allows it. ran is false when it was
// skipped. A run gets at most one interval; a panic counts as a failure.
func (r *Runner) RunOnce(ctx context.Context, j Job) (ran bool, err error) {
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	now := r.now()
	release, ok, err := r.locker.Acquire(ctx, j.Name, j.Every, now)
	if err != nil {
		r.failures.Inc(j.Name)
		r.log.Error("job lock failed", "job", j.Name, "error", err)
		return false, err
	}
	if !ok {
		r.skipped.Inc(j.Name)
		return false, nil
	}
	r.runs.Inc(j.Name)
	started := time.Now()
	err = invoke(ctx, j, now)
	r.duration.Observe(time.Since(started).Seconds(), j.Name)
	release(err)
	if err != nil {
		r.failures.Inc(j.Name)
		r.log.Error("job failed", "job", j.Name, "error", err)
		return true, err
	}
	r.lastSuccess.Set(float64(r.now().Unix()), j.Name)
	return true, nil
}

// invoke runs j with at most one interval and turns a panic into an error.
func invoke(ctx context.Context, j Job, now time.Time) (err error) {
	ctx, cancel := context.WithTimeout(ctx, j.Every)
	defer cancel()
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("panic: %v", p)
		}
	}()
	return j.Run(ctx, now)
}

// ErrBusy refuses a manual run while the job is running.
var ErrBusy = errors.New("jobs: job is already running")

// NowLocker takes a job's lock for a manual run.
type NowLocker interface {
	// AcquireNow is Acquire without the interval and the job switch: ok is
	// false only when a run holds the lock.
	AcquireNow(ctx context.Context, name string, now time.Time) (release func(runErr error), ok bool, err error)
}

// RunNow runs j once, now, under the same lock as its scheduled runs, so it
// never overlaps one. It records the run like a scheduled one and refuses
// with ErrBusy while another run holds the lock.
func RunNow(ctx context.Context, l NowLocker, j Job, now time.Time) error {
	release, ok, err := l.AcquireNow(ctx, j.Name, now)
	if err != nil {
		return err
	}
	if !ok {
		return ErrBusy
	}
	err = invoke(ctx, j, now)
	release(err)
	return err
}

// Due reports whether a job that last started at last may start again at
// now. A tenth of the interval is forgiven so ticker jitter never skips a
// whole period.
func Due(last *time.Time, now time.Time, every time.Duration) bool {
	return last == nil || now.Sub(*last) >= every-every/10
}
