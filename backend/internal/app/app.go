// Package app is the only package that knows every module. Each module
// registers itself from internal/app/module_<name>.go.
package app

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"time"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// registry maps module names to constructors. Register runs from init(),
// which Go executes sequentially, so no lock is needed.
var registry = map[string]func(module.Deps) module.Module{}

// Register adds a module constructor. Call it from init().
func Register(name string, ctor func(module.Deps) module.Module) {
	if _, dup := registry[name]; dup {
		panic(fmt.Sprintf("app: module %q registered twice", name))
	}
	registry[name] = ctor
}

// Names lists registered modules in a stable order.
func Names() []string {
	names := make([]string, 0, len(registry))
	for n := range registry {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// Mount builds the modules selected by MODULES and registers their routes
// on mux (which panics on conflicting patterns). It returns the mounted names.
func Mount(mux *http.ServeMux, deps module.Deps) []string {
	var mounted []string
	for _, name := range Names() {
		if !deps.Config.ModuleEnabled(name) {
			continue
		}
		for _, rt := range registry[name](deps).Routes() {
			mux.Handle(rt.Pattern, rt.Handler)
		}
		mounted = append(mounted, name)
	}
	return mounted
}

// Handler builds the whole HTTP surface: /health, /ready, the selected
// modules, wrapped in request id, access log, panic recovery and the API
// auth gate (the half of the Next proxy that proxied requests skip).
func Handler(deps module.Deps, started time.Time) (http.Handler, []string) {
	mux := http.NewServeMux()
	mux.Handle("GET /health", Health(started))
	mux.Handle("GET /ready", Ready(deps))
	mounted := Mount(mux, deps)
	h := httpx.Chain(mux,
		httpx.WithRequestID,
		httpx.AccessLog(deps.Log),
		httpx.Recover(deps.Log),
		deps.Auth.Gate,
	)
	return h, mounted
}

// Health mirrors GET /api/health: the process is alive, no database.
func Health(started time.Time) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		_ = httpx.JSON(w, http.StatusOK, struct {
			Status  string `json:"status"`
			UptimeS int64  `json:"uptime_s"`
		}{"ok", int64(time.Since(started).Round(time.Second) / time.Second)})
	})
}

// readyTimeout is READY_TIMEOUT_MS from frontend/src/lib/ops/readiness.ts.
const readyTimeout = 2 * time.Second

type readyBody struct {
	Status    string `json:"status"`
	Database  string `json:"database"`
	LatencyMS int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

// Ready mirrors GET /api/ready: 200 when SELECT 1 answers within 2s, else 503.
func Ready(deps module.Deps) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		started := time.Now()
		ctx, cancel := context.WithTimeout(r.Context(), readyTimeout)
		defer cancel()
		var one int
		err := deps.DB.QueryRow(ctx, "SELECT 1").Scan(&one)
		latency := time.Since(started).Milliseconds()
		if err != nil {
			msg := err.Error()
			if ctx.Err() == context.DeadlineExceeded {
				msg = fmt.Sprintf("database tidak menjawab dalam %d ms", readyTimeout.Milliseconds())
			}
			_ = httpx.JSON(w, http.StatusServiceUnavailable, readyBody{"unavailable", "error", latency, msg})
			return
		}
		_ = httpx.JSON(w, http.StatusOK, readyBody{"ready", "ok", latency, ""})
	})
}
