package metrics

import (
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func text(t *testing.T, r *Registry) string {
	t.Helper()
	var b strings.Builder
	if err := r.WriteText(&b); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

func TestCounterAndGauge(t *testing.T) {
	r := NewRegistry()
	c := r.NewCounterVec("jobs_total", "Jobs run.\nSecond line.", "kind")
	g := r.NewGauge("busy", "Busy workers.")
	c.Inc("b")
	c.Inc("a")
	c.Inc("a")
	c.Inc(`q"x\y` + "\n")
	g.Inc()
	g.Inc()
	g.Dec()
	want := `# HELP jobs_total Jobs run.\nSecond line.
# TYPE jobs_total counter
jobs_total{kind="a"} 2
jobs_total{kind="b"} 1
jobs_total{kind="q\"x\\y\n"} 1
# HELP busy Busy workers.
# TYPE busy gauge
busy 1
`
	if got := text(t, r); got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestHistogramBucketsAreCumulative(t *testing.T) {
	r := NewRegistry()
	h := r.NewHistogramVec("lat_seconds", "Latency.", []float64{0.1, 1}, "route")
	for _, v := range []float64{0.05, 0.1, 0.5, 3} {
		h.Observe(v, "/x")
	}
	want := `# HELP lat_seconds Latency.
# TYPE lat_seconds histogram
lat_seconds_bucket{route="/x",le="0.1"} 2
lat_seconds_bucket{route="/x",le="1"} 3
lat_seconds_bucket{route="/x",le="+Inf"} 4
lat_seconds_sum{route="/x"} 3.65
lat_seconds_count{route="/x"} 4
`
	if got := text(t, r); got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestConcurrentUpdates(t *testing.T) {
	r := NewRegistry()
	c := r.NewCounterVec("n_total", "N.", "k")
	h := r.NewHistogramVec("d_seconds", "D.", DefBuckets, "k")
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 1000 {
				c.Inc("same")
				h.Observe(0.01, string(rune('a'+i)))
				_ = text(t, r)
			}
		}()
	}
	wg.Wait()
	if out := text(t, r); !strings.Contains(out, `n_total{k="same"} 8000`) {
		t.Fatalf("lost increments:\n%s", out)
	}
}

func TestDuplicateNamePanics(t *testing.T) {
	r := NewRegistry()
	r.NewHistogramVec("x", "X.", DefBuckets)
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	r.NewGauge("x_count", "clashes with the histogram's _count series")
}

func TestWrongLabelCountPanics(t *testing.T) {
	c := NewRegistry().NewCounterVec("c_total", "C.", "a", "b")
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	c.Inc("only-one")
}

type fakeStat struct{}

func (fakeStat) AcquiredConns() int32                { return 2 }
func (fakeStat) IdleConns() int32                    { return 3 }
func (fakeStat) ConstructingConns() int32            { return 0 }
func (fakeStat) TotalConns() int32                   { return 5 }
func (fakeStat) MaxConns() int32                     { return 8 }
func (fakeStat) AcquireCount() int64                 { return 42 }
func (fakeStat) EmptyAcquireCount() int64            { return 1 }
func (fakeStat) CanceledAcquireCount() int64         { return 0 }
func (fakeStat) AcquireDuration() time.Duration      { return 1500 * time.Millisecond }
func (fakeStat) EmptyAcquireWaitTime() time.Duration { return 0 }
func (fakeStat) NewConnsCount() int64                { return 6 }
func (fakeStat) MaxLifetimeDestroyCount() int64      { return 1 }
func (fakeStat) MaxIdleDestroyCount() int64          { return 0 }

func TestPoolAndRuntimeCollectors(t *testing.T) {
	r := NewRegistry()
	calls := 0
	RegisterPool(r, func() PoolStat { calls++; return fakeStat{} })
	RegisterRuntime(r)
	out := text(t, r)
	if calls != 1 {
		t.Errorf("stat called %d times per scrape, want 1", calls)
	}
	for _, line := range []string{
		"# TYPE pgxpool_acquired_conns gauge\npgxpool_acquired_conns 2\n",
		"pgxpool_max_conns 8\n",
		"# TYPE pgxpool_acquires_total counter\npgxpool_acquires_total 42\n",
		"pgxpool_acquire_duration_seconds_total 1.5\n",
		"# TYPE go_goroutines gauge\ngo_goroutines ",
		"\ngo_memstats_heap_alloc_bytes ",
		"\ngo_memstats_sys_bytes ",
		"# TYPE go_gc_cycles_total counter\n",
	} {
		if !strings.Contains(out, line) {
			t.Errorf("missing %q in\n%s", line, out)
		}
	}
}

func TestHandler(t *testing.T) {
	r := NewRegistry()
	r.NewGauge("up", "Up.").Inc()
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	if ct := rec.Header().Get("Content-Type"); ct != ContentType {
		t.Errorf("content type %q", ct)
	}
	if !strings.HasSuffix(rec.Body.String(), "\nup 1\n") {
		t.Errorf("body %q", rec.Body.String())
	}
}
