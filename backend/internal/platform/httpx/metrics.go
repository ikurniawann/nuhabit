package httpx

import (
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/metrics"
)

// Metrics counts requests and their duration by route pattern, method and
// status class, and tracks requests in flight. route returns the ServeMux
// pattern that serves r ("GET /api/x/{id}"), or "" when none matches;
// raw paths never become labels, so ids cannot blow up the series count.
func Metrics(reg *metrics.Registry, route func(*http.Request) string) func(http.Handler) http.Handler {
	requests := reg.NewCounterVec("http_requests_total",
		"HTTP requests by route pattern, method and status class.", "route", "method", "status")
	duration := reg.NewHistogramVec("http_request_duration_seconds",
		"HTTP request duration by route pattern, method and status class.", metrics.DefBuckets, "route", "method", "status")
	inFlight := reg.NewGauge("http_requests_in_flight", "HTTP requests being served.")
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			inFlight.Inc()
			rec := &statusRecorder{ResponseWriter: w}
			// Deferred so a panic that escapes Recover (http.ErrAbortHandler)
			// still leaves the in-flight gauge balanced.
			defer func() {
				inFlight.Dec()
				labels := []string{routeLabel(route(r)), methodLabel(r.Method), statusClass(rec.status)}
				requests.Inc(labels...)
				duration.Observe(time.Since(start).Seconds(), labels...)
			}()
			next.ServeHTTP(rec, r)
		})
	}
}

func routeLabel(pattern string) string {
	if pattern == "" {
		return "unmatched"
	}
	if _, path, ok := strings.Cut(pattern, " "); ok {
		return path
	}
	return pattern
}

func methodLabel(m string) string {
	switch m {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch,
		http.MethodDelete, http.MethodOptions:
		return m
	}
	return "OTHER"
}

func statusClass(code int) string {
	if code == 0 {
		code = http.StatusOK // nothing written: net/http sends 200
	}
	if code < 100 || code > 599 {
		return "other"
	}
	return string(rune('0'+code/100)) + "xx"
}
