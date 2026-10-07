// Package loyalty ports the CRM loyalty catalog and configuration routes
// (tiers, XP rules, rewards, redemptions, CRM settings, loyalty feature
// flags, admin XP adjustment) and subscribes the XP engine to POS sales.
package loyalty

import (
	"time"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// Ports are the capabilities of other bounded contexts this area uses.
type Ports struct {
	// Orders backs the dashboard's ARK spenders and ledger order numbers.
	Orders PosOrders
}

type handler struct {
	db     database.DB
	guard  kit.Guard
	engine *xp.Engine
	orders PosOrders
	now    func() time.Time
}

// Routes mounts the area's routes.
func Routes(d module.Deps, engine *xp.Engine, p Ports) []module.Route {
	return newHandler(d.DB, d, engine, p).routes()
}

func newHandler(db database.DB, d module.Deps, engine *xp.Engine, p Ports) *handler {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	orders := p.Orders
	if orders == nil {
		orders = PosOrdersSQL{}
	}
	return &handler{db: db, guard: kit.Guard{Auth: d.Auth, DB: db}, engine: engine, orders: orders, now: now}
}

func (h *handler) routes() []module.Route {
	r := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		r("GET /api/crm/dashboard", h.dashboard),
		r("GET /api/crm/tiers", h.listTiers),
		r("POST /api/crm/tiers", h.saveTier),
		r("GET /api/crm/xp-rules", h.listXPRules),
		r("POST /api/crm/xp-rules", h.saveXPRule),
		r("GET /api/crm/rewards", h.listRewards),
		r("POST /api/crm/rewards", h.saveReward),
		r("DELETE /api/crm/rewards", h.deleteReward),
		r("GET /api/crm/redemptions", h.listRedemptions),
		r("POST /api/crm/redemptions", h.claimRedemption),
		r("PATCH /api/crm/redemptions", h.updateRedemption),
		r("GET /api/crm/loyalty-features", h.loyaltyFeatures),
		r("GET /api/crm/settings", h.readSettings),
		r("PUT /api/crm/settings", h.updateSettings),
		r("POST /api/crm/members/{id}/xp-adjust", h.adjustXP),
	}
}
