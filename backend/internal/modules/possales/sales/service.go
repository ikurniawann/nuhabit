// Package sales ports the cashier sale routes of pos-sales:
// /api/pos/orders/**, /api/pos/checkouts/**, /api/pos/qris/** and
// /api/pos/supervisors (frontend/src/app/api/pos/* and frontend/src/lib/pos/
// orders, checkout, supervisor-pin*).
package sales

import (
	"context"
	"log/slog"
	"time"

	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/modules/possales/offers"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/outbox"
)

// Ports are the cross-context dependencies internal/app wires.
type Ports struct {
	Loyalty     ports.Loyalty
	Wallet      ports.Wallet
	GiftCards   ports.GiftCards
	Tabs        ports.Tabs
	Merchandise ports.Merchandise
	Catalog     ports.Catalog
	Directory   ports.Directory
	Notifier    ports.Notifier
	// Offers is the offer engine and promo-code ledger (stored-value).
	Offers offers.Engine
	// GofoodReady is notifyGofoodFoodReadyForPosOrder (never fails).
	GofoodReady func(ctx context.Context, posOrderID string)
	// Xendit is the QRIS gateway.
	Xendit Gateway
}

// Handler serves the sale routes.
type Handler struct {
	db      database.DB
	auth    *auth.Service
	log     *slog.Logger
	now     func() time.Time
	events  *outbox.Bus
	p       Ports
	limiter *kit.RateLimiter
}

// New builds the handler on deps with the given ports.
func New(deps module.Deps, p Ports) *Handler {
	return newHandler(deps.DB, deps, p)
}

func newHandler(db database.DB, deps module.Deps, p Ports) *Handler {
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	log := deps.Log
	if log == nil {
		log = slog.Default()
	}
	if p.GofoodReady == nil {
		p.GofoodReady = func(context.Context, string) {}
	}
	h := &Handler{db: db, auth: deps.Auth, log: log, now: now, events: deps.Events, p: p, limiter: kit.NewRateLimiter(now)}
	h.subscribe()
	return h
}

// clock is the JS Date the TS stamps rows with: millisecond precision.
func (h *Handler) clock() time.Time { return h.now().Truncate(time.Millisecond) }
