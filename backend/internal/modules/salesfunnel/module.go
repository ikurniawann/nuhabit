// Package salesfunnel is the B2B sales funnel bounded context (module name
// "sales-funnel"): leads, deals and pipelines, accounts and contacts, tasks,
// quotations with stock realisation, invoices and payments, forecast and
// targets, reports and the record timeline. Port of
// frontend/src/app/api/sales-funnel/** and frontend/src/lib/sales-funnel/**.
// It owns crm.crm_sales_*, crm.crm_accounts, crm.crm_contacts,
// crm.crm_pipelines and crm.crm_deal_members.
package salesfunnel

import (
	"log/slog"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// Name is the MODULES key.
const Name = "sales-funnel"

type salesModule struct{ h *handler }

func (m salesModule) Name() string           { return Name }
func (m salesModule) Routes() []module.Route { return m.h.routes() }

// New mounts the module on the shared pool.
func New(deps module.Deps, ports Ports) module.Module { return NewOn(deps, deps.DB, ports) }

// NewOn mounts the module on db: the pool in production, a rolled-back
// transaction in tests. Sessions still resolve on deps.Auth.
func NewOn(deps module.Deps, db database.DB, ports Ports) module.Module {
	now, log := deps.Now, deps.Log
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	if ports.Gateway == nil {
		ports.Gateway = whatsapp.New(log)
	}
	return salesModule{h: &handler{db: db, auth: deps.Auth, ports: ports, log: log, now: now, limiter: newRateLimiter()}}
}

type handler struct {
	db      database.DB
	auth    *auth.Service
	ports   Ports
	log     *slog.Logger
	now     func() time.Time
	limiter *rateLimiter
}

// rateLimiter is lib/rate-limit.ts checkRateLimit: a fixed one-minute
// window per key, per process.
type rateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rateEntry
}

type rateEntry struct {
	count int
	reset time.Time
}

func newRateLimiter() *rateLimiter { return &rateLimiter{entries: map[string]*rateEntry{}} }

func (l *rateLimiter) allow(key string, limit int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok || now.After(e.reset) {
		if len(l.entries) > 10_000 {
			for k, v := range l.entries {
				if now.After(v.reset) {
					delete(l.entries, k)
				}
			}
		}
		l.entries[key] = &rateEntry{count: 1, reset: now.Add(time.Minute)}
		return true
	}
	if e.count >= limit {
		return false
	}
	e.count++
	return true
}
