package jobs

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/metrics"
)

// fakeLocker grants the lock unless busy, and records released outcomes.
type fakeLocker struct {
	mu       sync.Mutex
	busy     bool
	err      error
	released []error
}

func (f *fakeLocker) Acquire(context.Context, string, time.Duration, time.Time) (func(error), bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil || f.busy {
		return nil, false, f.err
	}
	return func(err error) {
		f.mu.Lock()
		f.released = append(f.released, err)
		f.mu.Unlock()
	}, true, nil
}

func newRunner(l Locker, now time.Time) (*Runner, *metrics.Registry) {
	reg := metrics.NewRegistry()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewRunner(l, log, func() time.Time { return now }, reg), reg
}

func scrape(t *testing.T, reg *metrics.Registry) string {
	t.Helper()
	var b strings.Builder
	if err := reg.WriteText(&b); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

func wantLines(t *testing.T, text string, lines ...string) {
	t.Helper()
	for _, l := range lines {
		if !strings.Contains(text, l+"\n") {
			t.Errorf("metrics missing %q in\n%s", l, text)
		}
	}
}

func TestRunOnceSkipsWhenLockBusy(t *testing.T) {
	lock := &fakeLocker{busy: true}
	r, reg := newRunner(lock, time.Unix(1_761_000_000, 0))
	calls := 0
	ran, err := r.RunOnce(context.Background(), Job{Name: "a", Every: time.Minute, Run: func(context.Context, time.Time) error {
		calls++
		return nil
	}})
	if ran || err != nil || calls != 0 {
		t.Fatalf("ran=%v err=%v calls=%d, want skipped", ran, err, calls)
	}
	wantLines(t, scrape(t, reg), `job_skipped_total{job="a"} 1`)
}

func TestRunOnceSuccessAndFailureMetrics(t *testing.T) {
	lock := &fakeLocker{}
	now := time.Unix(1_761_000_000, 0)
	r, reg := newRunner(lock, now)
	var gotNow time.Time
	ok := Job{Name: "ok", Every: time.Minute, Run: func(_ context.Context, n time.Time) error { gotNow = n; return nil }}
	boom := errors.New("boom")
	bad := Job{Name: "bad", Every: time.Minute, Run: func(context.Context, time.Time) error { return boom }}
	panics := Job{Name: "panics", Every: time.Minute, Run: func(context.Context, time.Time) error { panic("oops") }}

	if ran, err := r.RunOnce(context.Background(), ok); !ran || err != nil || !gotNow.Equal(now) {
		t.Fatalf("ok: ran=%v err=%v now=%v", ran, err, gotNow)
	}
	if ran, err := r.RunOnce(context.Background(), bad); !ran || !errors.Is(err, boom) {
		t.Fatalf("bad: ran=%v err=%v", ran, err)
	}
	if ran, err := r.RunOnce(context.Background(), panics); !ran || err == nil || !strings.Contains(err.Error(), "oops") {
		t.Fatalf("panics: ran=%v err=%v", ran, err)
	}
	if len(lock.released) != 3 || lock.released[0] != nil || !errors.Is(lock.released[1], boom) || lock.released[2] == nil {
		t.Fatalf("released = %v", lock.released)
	}
	text := scrape(t, reg)
	wantLines(t, text,
		`job_runs_total{job="bad"} 1`,
		`job_runs_total{job="ok"} 1`,
		`job_runs_total{job="panics"} 1`,
		`job_failures_total{job="bad"} 1`,
		`job_failures_total{job="panics"} 1`,
		`job_last_success_timestamp_seconds{job="ok"} 1.761e+09`,
		`job_duration_seconds_count{job="ok"} 1`,
	)
	if strings.Contains(text, `job_failures_total{job="ok"}`) || strings.Contains(text, `job_last_success_timestamp_seconds{job="bad"}`) {
		t.Fatalf("unexpected series in\n%s", text)
	}
}

func TestRunOnceCountsLockErrorAsFailure(t *testing.T) {
	r, reg := newRunner(&fakeLocker{err: errors.New("db down")}, time.Now())
	ran, err := r.RunOnce(context.Background(), Job{Name: "a", Every: time.Minute, Run: func(context.Context, time.Time) error { return nil }})
	if ran || err == nil {
		t.Fatalf("ran=%v err=%v", ran, err)
	}
	wantLines(t, scrape(t, reg), `job_failures_total{job="a"} 1`)
}

func TestRunTicksOnInterval(t *testing.T) {
	r, _ := newRunner(&fakeLocker{}, time.Now())
	var n atomic.Int32
	r.Add(Job{Name: "tick", Every: 20 * time.Millisecond, Run: func(context.Context, time.Time) error {
		n.Add(1)
		return nil
	}})
	ctx, cancel := context.WithTimeout(context.Background(), 110*time.Millisecond)
	defer cancel()
	r.Run(ctx)
	// Once at start, then about every 20 ms for 110 ms.
	if got := n.Load(); got < 3 || got > 7 {
		t.Fatalf("runs = %d, want about 6", got)
	}
}

func TestDue(t *testing.T) {
	now := time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { v := now.Add(-d); return &v }
	cases := []struct {
		last *time.Time
		want bool
	}{
		{nil, true},
		{at(2 * time.Minute), true},
		{at(2*time.Minute - 5*time.Second), true}, // ticker jitter is forgiven
		{at(time.Minute), false},
		{at(0), false},
	}
	for i, c := range cases {
		if got := Due(c.last, now, 2*time.Minute); got != c.want {
			t.Errorf("case %d: Due = %v, want %v", i, got, c.want)
		}
	}
}

func TestAddRejectsBadJobs(t *testing.T) {
	r, _ := newRunner(&fakeLocker{}, time.Now())
	run := func(context.Context, time.Time) error { return nil }
	r.Add(Job{Name: "a", Every: time.Minute, Run: run})
	for _, j := range []Job{
		{Name: "", Every: time.Minute, Run: run},
		{Name: "b", Every: 0, Run: run},
		{Name: "c", Every: time.Minute},
		{Name: "a", Every: time.Minute, Run: run},
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("Add(%q) did not panic", j.Name)
				}
			}()
			r.Add(j)
		}()
	}
	if got := r.Names(); len(got) != 1 || got[0] != "a" {
		t.Fatalf("Names = %v", got)
	}
}
