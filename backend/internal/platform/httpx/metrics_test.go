package httpx

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/metrics"
)

func TestMetricsLabelsByPatternAndStatusClass(t *testing.T) {
	reg := metrics.NewRegistry()
	mux := http.NewServeMux()
	var inFlight string
	mux.HandleFunc("GET /api/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		var b strings.Builder
		_ = reg.WriteText(&b)
		inFlight = b.String()
		if r.PathValue("id") == "missing" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /api/boom", func(w http.ResponseWriter, r *http.Request) { panic("boom") })
	route := func(r *http.Request) string { _, p := mux.Handler(r); return p }
	// Recover sits inside Metrics, as in app.Handler, so a panic counts as 500.
	h := Chain(mux, Metrics(reg, route), Recover(slog.New(slog.NewTextHandler(io.Discard, nil))))

	for _, req := range []*http.Request{
		httptest.NewRequest("GET", "/api/items/1", nil),
		httptest.NewRequest("GET", "/api/items/2", nil),
		httptest.NewRequest("GET", "/api/items/missing", nil),
		httptest.NewRequest("POST", "/api/boom", nil),
		httptest.NewRequest("GET", "/nope/123", nil),
		httptest.NewRequest("BREW", "/api/items/1", nil),
	} {
		serve(h, req)
	}
	if !strings.Contains(inFlight, "http_requests_in_flight 1\n") {
		t.Errorf("in-flight while serving:\n%s", inFlight)
	}
	var b strings.Builder
	_ = reg.WriteText(&b)
	out := b.String()
	for _, line := range []string{
		`http_requests_total{route="/api/items/{id}",method="GET",status="2xx"} 2`,
		`http_requests_total{route="/api/items/{id}",method="GET",status="4xx"} 1`,
		`http_requests_total{route="/api/boom",method="POST",status="5xx"} 1`,
		`http_requests_total{route="unmatched",method="GET",status="4xx"} 1`,
		`http_requests_total{route="unmatched",method="OTHER",status="4xx"} 1`,
		`http_request_duration_seconds_count{route="/api/items/{id}",method="GET",status="2xx"} 2`,
		"http_requests_in_flight 0\n",
	} {
		if !strings.Contains(out, line) {
			t.Errorf("missing %s in\n%s", line, out)
		}
	}
	if strings.Contains(out, "/api/items/1") || strings.Contains(out, "/nope") {
		t.Errorf("raw path leaked into labels:\n%s", out)
	}
}

func TestStatusClass(t *testing.T) {
	for code, want := range map[int]string{0: "2xx", 200: "2xx", 204: "2xx", 301: "3xx", 404: "4xx", 503: "5xx", 42: "other", 700: "other"} {
		if got := statusClass(code); got != want {
			t.Errorf("statusClass(%d) = %s, want %s", code, got, want)
		}
	}
}
