// Package tableorder ports table self-order (customer ordering from the QR
// on the table): frontend/src/app/api/table-order/{products,session,orders}
// and frontend/src/lib/table-order. The routes are public (guests and
// member-portal sessions); /api/table-order is in auth.PublicAuthPrefixes.
// orders/{id}/payment-proof stays in TS (Next private storage).
package tableorder

import (
	"context"
	"log/slog"

	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Handler serves the routes of this package.
type Handler struct {
	svc     *service
	auth    *auth.Service
	limiter *kit.RateLimiter
	log     *slog.Logger
}

// New builds the handler on the pool; nil ports get this package's stopgap
// adapters (see Ports).
func New(deps module.Deps, p Ports) *Handler { return newHandler(deps, p, deps.DB) }

// newHandler runs the routes on db (tests pass a rolled-back transaction).
func newHandler(deps module.Deps, p Ports, db database.DB) *Handler {
	log := deps.Log
	if log == nil {
		log = slog.Default()
	}
	if p.Loyalty == nil {
		p.Loyalty = noLoyalty{}
	}
	if p.Wallet == nil {
		p.Wallet = walletSQL{}
	}
	if p.Directory == nil {
		p.Directory = crmSQL{}
	}
	if p.Catalog == nil {
		p.Catalog = catalogSQL{}
	}
	if p.Settings == nil {
		p.Settings = settingsSQL{}
	}
	if p.CRM == nil {
		p.CRM = crmSQL{}
	}
	if p.Alerts == nil {
		p.Alerts = newAlertsSender(db, log)
	}
	if p.Xendit == nil {
		p.Xendit = NewXendit()
	}
	if deps.Events != nil {
		subscribeQrisOrders(deps.Events)
	}
	return &Handler{
		svc:     &service{db: db, p: p, now: deps.Now, log: log},
		auth:    deps.Auth,
		limiter: kit.NewRateLimiter(deps.Now),
		log:     log,
	}
}

// noLoyalty is the nil-Loyalty fallback, for tests only: XP is skipped,
// ARK Coin stays enabled and no product is privileged.
type noLoyalty struct{ ports.Loyalty }

func (noLoyalty) AwardOrderXP(context.Context, database.Querier, ports.OrderXP) (ports.XPAward, error) {
	return ports.XPAward{Status: "skipped", Reason: "no_customer"}, nil
}

func (noLoyalty) ArkCoinEnabled(context.Context, database.Querier) bool { return true }

func (noLoyalty) CheckProductPrivileges(context.Context, database.Querier, []string, string) (bool, string, error) {
	return true, "", nil
}

// Routes lists the routes.
func (h *Handler) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/table-order/products", Handler: h.products()},
		{Pattern: "GET /api/table-order/session/{tableCode}", Handler: h.session()},
		{Pattern: "POST /api/table-order/orders", Handler: h.createOrder()},
		{Pattern: "GET /api/table-order/orders/{id}", Handler: h.orderStatus()},
	}
}
