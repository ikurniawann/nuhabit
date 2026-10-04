// Package members is the CRM member directory and member detail pages
// (api/crm/members/**): list and enrol, detail and edit, activity tabs,
// communication consent and manual badges.
package members

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// Ports are the capabilities of other bounded contexts this area uses;
// internal/app/adapters_crm_members.go provides them.
type Ports struct {
	// Orders reads the member's recent POS orders (pos-sales).
	Orders OrderReads
	// Wallet reads the member's wallet transactions (stored-value).
	Wallet WalletReads
}

// OrderReads are the POS order reads of the member detail page.
type OrderReads interface {
	// RecentOrders is the member's last 10 orders by ordered_at: id,
	// order_number, total_amount, payment_status, status, ordered_at.
	RecentOrders(ctx context.Context, q database.Querier, customerID string) ([]*kit.Row, error)
}

// WalletReads are the stored-value reads of the activity tab.
type WalletReads interface {
	// Transactions is the member's last 100 wallet transactions (the
	// "wallet" activity tab).
	Transactions(ctx context.Context, q database.Querier, customerID string) ([]*kit.Row, error)
}

type handler struct {
	db     database.DB
	guard  kit.Guard
	engine *xp.Engine
	ports  Ports
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
	return &handler{db: db, guard: kit.Guard{Auth: d.Auth, DB: db}, engine: engine, ports: p, now: now}
}

func (h *handler) routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/crm/members", Handler: httpx.Handle(h.list)},
		{Pattern: "POST /api/crm/members", Handler: httpx.Handle(h.enroll)},
		{Pattern: "GET /api/crm/members/{id}", Handler: httpx.Handle(h.detail)},
		{Pattern: "PATCH /api/crm/members/{id}", Handler: httpx.Handle(h.update)},
		{Pattern: "GET /api/crm/members/{id}/activity", Handler: httpx.Handle(h.activity)},
		{Pattern: "GET /api/crm/members/{id}/consent", Handler: httpx.Handle(h.consent)},
		{Pattern: "PUT /api/crm/members/{id}/consent", Handler: httpx.Handle(h.updateConsent)},
		{Pattern: "GET /api/crm/members/{id}/badges", Handler: httpx.Handle(h.badges)},
		{Pattern: "POST /api/crm/members/{id}/badges", Handler: httpx.Handle(h.badgeAction)},
	}
}
