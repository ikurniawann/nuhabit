// Package metrics keeps counters, gauges and histograms in memory and
// writes them in the Prometheus text exposition format (version 0.0.4).
// It covers what cmd/api exports and nothing more, so the module needs no
// client_golang dependency.
package metrics

import (
	"bufio"
	"fmt"
	"io"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

// ContentType is the media type of the text exposition format.
const ContentType = "text/plain; version=0.0.4; charset=utf-8"

// Registry holds metric families and writes them in registration order.
type Registry struct {
	mu       sync.Mutex
	names    map[string]bool
	families []func(*bufio.Writer)
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return &Registry{names: map[string]bool{}} }

func (r *Registry) add(names []string, write func(*bufio.Writer)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, n := range names {
		if r.names[n] {
			panic(fmt.Sprintf("metrics: %q registered twice", n))
		}
		r.names[n] = true
	}
	r.families = append(r.families, write)
}

// WriteText writes every family in the text exposition format.
func (r *Registry) WriteText(w io.Writer) error {
	r.mu.Lock()
	families := slices.Clone(r.families)
	r.mu.Unlock()
	bw := bufio.NewWriter(w)
	for _, write := range families {
		write(bw)
	}
	return bw.Flush()
}

// Handler serves WriteText.
func (r *Registry) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", ContentType)
		w.Header().Set("Cache-Control", "no-store")
		_ = r.WriteText(w)
	})
}

/* ── Counter and histogram vectors ───────────────────────────────────── */

// series is the per-label-set state of a vector, keyed by the joined values.
type series[T any] struct {
	mu     sync.RWMutex
	byKey  map[string]*T
	values map[string][]string
}

func (s *series[T]) get(labels []string, values []string, init func() *T) *T {
	if len(values) != len(labels) {
		panic(fmt.Sprintf("metrics: got %d label values for %v", len(values), labels))
	}
	key := strings.Join(values, "\xff")
	s.mu.RLock()
	v, ok := s.byKey[key]
	s.mu.RUnlock()
	if ok {
		return v
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.byKey[key]; ok {
		return v
	}
	if s.byKey == nil {
		s.byKey, s.values = map[string]*T{}, map[string][]string{}
	}
	v = init()
	s.byKey[key] = v
	s.values[key] = slices.Clone(values)
	return v
}

// each calls f for every series in label order, so output is stable.
func (s *series[T]) each(f func(values []string, v *T)) {
	s.mu.RLock()
	keys := make([]string, 0, len(s.byKey))
	for k := range s.byKey {
		keys = append(keys, k)
	}
	s.mu.RUnlock()
	slices.Sort(keys)
	for _, k := range keys {
		s.mu.RLock()
		v, values := s.byKey[k], s.values[k]
		s.mu.RUnlock()
		f(values, v)
	}
}

// CounterVec counts events per label set.
type CounterVec struct {
	name, help string
	labels     []string
	series     series[atomic.Uint64]
}

// NewCounterVec registers a counter with the given label names.
func (r *Registry) NewCounterVec(name, help string, labels ...string) *CounterVec {
	c := &CounterVec{name: name, help: help, labels: labels}
	r.add([]string{name}, c.write)
	return c
}

// Inc adds one to the series for values, given in label order.
func (c *CounterVec) Inc(values ...string) {
	c.series.get(c.labels, values, func() *atomic.Uint64 { return new(atomic.Uint64) }).Add(1)
}

func (c *CounterVec) write(w *bufio.Writer) {
	writeHeader(w, c.name, c.help, "counter")
	c.series.each(func(values []string, v *atomic.Uint64) {
		writeSample(w, c.name, c.labels, values, "", "", float64(v.Load()))
	})
}

// DefBuckets are request-duration buckets in seconds, from 5 ms to 30 s.
var DefBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30}

// HistogramVec counts observations into cumulative buckets per label set.
type HistogramVec struct {
	name, help string
	labels     []string
	buckets    []float64
	series     series[histogram]
}

type histogram struct {
	mu     sync.Mutex
	counts []uint64 // per bucket, not cumulative; the last slot is +Inf
	sum    float64
	count  uint64
}

// NewHistogramVec registers a histogram. buckets must be sorted ascending.
func (r *Registry) NewHistogramVec(name, help string, buckets []float64, labels ...string) *HistogramVec {
	if !slices.IsSorted(buckets) {
		panic("metrics: histogram buckets must be sorted")
	}
	h := &HistogramVec{name: name, help: help, labels: labels, buckets: slices.Clone(buckets)}
	r.add([]string{name + "_bucket", name + "_sum", name + "_count", name}, h.write)
	return h
}

// Observe records v in the series for values, given in label order.
func (h *HistogramVec) Observe(v float64, values ...string) {
	s := h.series.get(h.labels, values, func() *histogram {
		return &histogram{counts: make([]uint64, len(h.buckets)+1)}
	})
	i, _ := slices.BinarySearch(h.buckets, v) // first bucket with le >= v
	s.mu.Lock()
	s.counts[i]++
	s.sum += v
	s.count++
	s.mu.Unlock()
}

func (h *HistogramVec) write(w *bufio.Writer) {
	writeHeader(w, h.name, h.help, "histogram")
	h.series.each(func(values []string, s *histogram) {
		s.mu.Lock()
		counts, sum, count := slices.Clone(s.counts), s.sum, s.count
		s.mu.Unlock()
		var cum uint64
		for i, le := range h.buckets {
			cum += counts[i]
			writeSample(w, h.name+"_bucket", h.labels, values, "le", formatFloat(le), float64(cum))
		}
		writeSample(w, h.name+"_bucket", h.labels, values, "le", "+Inf", float64(count))
		writeSample(w, h.name+"_sum", h.labels, values, "", "", sum)
		writeSample(w, h.name+"_count", h.labels, values, "", "", float64(count))
	})
}

/* ── Gauges and scrape-time collectors ───────────────────────────────── */

// Gauge is an integer value that goes up and down.
type Gauge struct{ v atomic.Int64 }

// NewGauge registers a gauge without labels.
func (r *Registry) NewGauge(name, help string) *Gauge {
	g := &Gauge{}
	r.add([]string{name}, func(w *bufio.Writer) {
		writeHeader(w, name, help, "gauge")
		writeSample(w, name, nil, nil, "", "", float64(g.v.Load()))
	})
	return g
}

// Inc adds one.
func (g *Gauge) Inc() { g.v.Add(1) }

// Dec subtracts one.
func (g *Gauge) Dec() { g.v.Add(-1) }

// GaugeVec holds one float value per label set, such as a timestamp.
type GaugeVec struct {
	name, help string
	labels     []string
	series     series[atomic.Uint64] // math.Float64bits of the value
}

// NewGaugeVec registers a gauge with the given label names.
func (r *Registry) NewGaugeVec(name, help string, labels ...string) *GaugeVec {
	g := &GaugeVec{name: name, help: help, labels: labels}
	r.add([]string{name}, g.write)
	return g
}

// Set stores v in the series for values, given in label order.
func (g *GaugeVec) Set(v float64, values ...string) {
	g.series.get(g.labels, values, func() *atomic.Uint64 { return new(atomic.Uint64) }).Store(math.Float64bits(v))
}

func (g *GaugeVec) write(w *bufio.Writer) {
	writeHeader(w, g.name, g.help, "gauge")
	g.series.each(func(values []string, v *atomic.Uint64) {
		writeSample(w, g.name, g.labels, values, "", "", math.Float64frombits(v.Load()))
	})
}

// Type is a metric type in the exposition format.
type Type string

// The metric types a Collector may emit.
const (
	GaugeType   Type = "gauge"
	CounterType Type = "counter"
)

// Sample is one unlabelled value a Collector reports at scrape time.
type Sample struct {
	Name, Help string
	Type       Type
	Value      float64
}

// Collector returns its samples when the registry is scraped, so values
// that come from one snapshot (pool stats, runtime metrics) stay consistent.
type Collector struct {
	// Names lists every sample name the collector emits, for the duplicate check.
	Names   []string
	Collect func() []Sample
}

// Register adds a scrape-time collector.
func (r *Registry) Register(c Collector) {
	r.add(c.Names, func(w *bufio.Writer) {
		for _, s := range c.Collect() {
			writeHeader(w, s.Name, s.Help, string(s.Type))
			writeSample(w, s.Name, nil, nil, "", "", s.Value)
		}
	})
}

/* ── Text format ─────────────────────────────────────────────────────── */

var (
	helpEscaper  = strings.NewReplacer(`\`, `\\`, "\n", `\n`)
	labelEscaper = strings.NewReplacer(`\`, `\\`, "\n", `\n`, `"`, `\"`)
)

func writeHeader(w *bufio.Writer, name, help, typ string) {
	fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s %s\n", name, helpEscaper.Replace(help), name, typ)
}

// writeSample writes name{labels...,extra="extraValue"} value. extra is
// the histogram "le" label, or "" for none.
func writeSample(w *bufio.Writer, name string, labels, values []string, extra, extraValue string, v float64) {
	w.WriteString(name)
	if len(labels) > 0 || extra != "" {
		w.WriteByte('{')
		for i, l := range labels {
			if i > 0 {
				w.WriteByte(',')
			}
			fmt.Fprintf(w, `%s="%s"`, l, labelEscaper.Replace(values[i]))
		}
		if extra != "" {
			if len(labels) > 0 {
				w.WriteByte(',')
			}
			fmt.Fprintf(w, `%s="%s"`, extra, extraValue)
		}
		w.WriteByte('}')
	}
	w.WriteByte(' ')
	w.WriteString(formatFloat(v))
	w.WriteByte('\n')
}

func formatFloat(v float64) string {
	switch {
	case math.IsInf(v, 1):
		return "+Inf"
	case math.IsInf(v, -1):
		return "-Inf"
	case math.IsNaN(v):
		return "NaN"
	}
	return strconv.FormatFloat(v, 'g', -1, 64)
}
