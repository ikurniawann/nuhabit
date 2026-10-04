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
	"net/http"
	"time"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/ratelimit"
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
	return salesModule{h: &handler{db: db, auth: deps.Auth, ports: ports, log: log, now: now, limiter: ratelimit.New(db)}}
}

type handler struct {
	db      database.DB
	auth    *auth.Service
	ports   Ports
	log     *slog.Logger
	now     func() time.Time
	limiter *ratelimit.Limiter
}

// limit is lib/rate-limit.ts checkRateLimit answered with a 429 msg: a
// fixed one-minute window per key, counted in platform.rate_limits so every
// replica shares it.
func (h *handler) limit(r *http.Request, key string, limit int, msg string) error {
	w, err := h.limiter.Fixed(r.Context(), key, limit, time.Minute, h.now())
	if err != nil {
		return err
	}
	if !w.Allowed {
		return tooMany(msg)
	}
	return nil
}
