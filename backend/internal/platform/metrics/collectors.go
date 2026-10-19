package metrics

import (
	rtmetrics "runtime/metrics"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// runtimeSamples maps runtime/metrics names to the exported metric. The
// names follow client_golang, so existing Go dashboards work.
var runtimeSamples = []struct {
	key string
	out Sample
}{
	{"/sched/goroutines:goroutines", Sample{Name: "go_goroutines", Help: "Number of goroutines that currently exist.", Type: GaugeType}},
	{"/memory/classes/heap/objects:bytes", Sample{Name: "go_memstats_heap_alloc_bytes", Help: "Bytes of allocated heap objects.", Type: GaugeType}},
	{"/memory/classes/total:bytes", Sample{Name: "go_memstats_sys_bytes", Help: "Bytes of memory obtained from the OS.", Type: GaugeType}},
	{"/gc/heap/goal:bytes", Sample{Name: "go_gc_heap_goal_bytes", Help: "Heap size target for the end of the GC cycle.", Type: GaugeType}},
	{"/gc/cycles/total:gc-cycles", Sample{Name: "go_gc_cycles_total", Help: "Completed GC cycles.", Type: CounterType}},
	{"/sched/gomaxprocs:threads", Sample{Name: "go_sched_gomaxprocs_threads", Help: "Current GOMAXPROCS setting.", Type: GaugeType}},
}

// RegisterRuntime exports goroutine, heap and GC figures from runtime/metrics.
func RegisterRuntime(r *Registry) {
	names := make([]string, len(runtimeSamples))
	for i, s := range runtimeSamples {
		names[i] = s.out.Name
	}
	r.Register(Collector{Names: names, Collect: func() []Sample {
		read := make([]rtmetrics.Sample, len(runtimeSamples))
		for i, s := range runtimeSamples {
			read[i].Name = s.key
		}
		rtmetrics.Read(read)
		out := make([]Sample, 0, len(read))
		for i, s := range read {
			// KindBad: this Go version dropped the metric.
			if s.Value.Kind() != rtmetrics.KindUint64 {
				continue
			}
			o := runtimeSamples[i].out
			o.Value = float64(s.Value.Uint64())
			out = append(out, o)
		}
		return out
	}})
}

// PoolStat is the part of *pgxpool.Stat the pool metrics read.
type PoolStat interface {
	AcquiredConns() int32
	IdleConns() int32
	ConstructingConns() int32
	TotalConns() int32
	MaxConns() int32
	AcquireCount() int64
	EmptyAcquireCount() int64
	CanceledAcquireCount() int64
	AcquireDuration() time.Duration
	EmptyAcquireWaitTime() time.Duration
	NewConnsCount() int64
	MaxLifetimeDestroyCount() int64
	MaxIdleDestroyCount() int64
}

var _ PoolStat = (*pgxpool.Stat)(nil)

var poolSamples = []struct {
	out Sample
	get func(PoolStat) float64
}{
	{Sample{Name: "pgxpool_acquired_conns", Help: "Connections currently checked out.", Type: GaugeType}, func(s PoolStat) float64 { return float64(s.AcquiredConns()) }},
	{Sample{Name: "pgxpool_idle_conns", Help: "Idle connections in the pool.", Type: GaugeType}, func(s PoolStat) float64 { return float64(s.IdleConns()) }},
	{Sample{Name: "pgxpool_constructing_conns", Help: "Connections being opened.", Type: GaugeType}, func(s PoolStat) float64 { return float64(s.ConstructingConns()) }},
	{Sample{Name: "pgxpool_total_conns", Help: "Open connections: acquired, idle and constructing.", Type: GaugeType}, func(s PoolStat) float64 { return float64(s.TotalConns()) }},
	{Sample{Name: "pgxpool_max_conns", Help: "Configured pool size.", Type: GaugeType}, func(s PoolStat) float64 { return float64(s.MaxConns()) }},
	{Sample{Name: "pgxpool_acquires_total", Help: "Successful connection acquires.", Type: CounterType}, func(s PoolStat) float64 { return float64(s.AcquireCount()) }},
	{Sample{Name: "pgxpool_empty_acquires_total", Help: "Acquires that waited because the pool was empty.", Type: CounterType}, func(s PoolStat) float64 { return float64(s.EmptyAcquireCount()) }},
	{Sample{Name: "pgxpool_canceled_acquires_total", Help: "Acquires cancelled by their context.", Type: CounterType}, func(s PoolStat) float64 { return float64(s.CanceledAcquireCount()) }},
	{Sample{Name: "pgxpool_acquire_duration_seconds_total", Help: "Time spent in successful acquires.", Type: CounterType}, func(s PoolStat) float64 { return s.AcquireDuration().Seconds() }},
	{Sample{Name: "pgxpool_empty_acquire_wait_seconds_total", Help: "Time acquires waited on an empty pool.", Type: CounterType}, func(s PoolStat) float64 { return s.EmptyAcquireWaitTime().Seconds() }},
	{Sample{Name: "pgxpool_new_conns_total", Help: "Connections opened.", Type: CounterType}, func(s PoolStat) float64 { return float64(s.NewConnsCount()) }},
	{Sample{Name: "pgxpool_max_lifetime_destroys_total", Help: "Connections closed for exceeding max lifetime.", Type: CounterType}, func(s PoolStat) float64 { return float64(s.MaxLifetimeDestroyCount()) }},
	{Sample{Name: "pgxpool_max_idle_destroys_total", Help: "Connections closed for exceeding max idle time.", Type: CounterType}, func(s PoolStat) float64 { return float64(s.MaxIdleDestroyCount()) }},
}

// RegisterPool exports pool statistics, read from one stat() call per scrape.
// For a *pgxpool.Pool pass func() metrics.PoolStat { return pool.Stat() }.
func RegisterPool(r *Registry, stat func() PoolStat) {
	names := make([]string, len(poolSamples))
	for i, p := range poolSamples {
		names[i] = p.out.Name
	}
	r.Register(Collector{Names: names, Collect: func() []Sample {
		s := stat()
		out := make([]Sample, len(poolSamples))
		for i, p := range poolSamples {
			out[i] = p.out
			out[i].Value = p.get(s)
		}
		return out
	}})
}
