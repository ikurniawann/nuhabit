// Package gofood ports pos/gofood: the cashier's GoFood order list and the
// accept / reject / food-ready / create-POS-order actions, which call the
// GoBiz API (lib/gobiz/client.ts) and turn an accepted GoFood order into a
// paid delivery pos_orders row (lib/gobiz/service.ts).
package gofood

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Guard is the IAM check the routes need (*auth.Service satisfies it).
type Guard interface {
	RequireMenuPrefix(r *http.Request, prefixes ...string) (*auth.User, error)
}

// Handler serves the routes of this package.
type Handler struct {
	svc   *Service
	guard Guard
	log   *slog.Logger
}

// New builds the handler on the pool with the stopgap settings and venue
// adapters and a process-wide GoBiz client (one token cache per process,
// like the TS module).
func New(deps module.Deps) *Handler {
	return NewHandler(deps.DB, deps.Auth, Ports{Config: SettingsSQL{}, Venues: CrmVenueSQL{}}, NewClient(nil, nil), deps.Now, deps.Log)
}

// NewHandler builds the handler on any pool or transaction; tests pass a
// rolled-back transaction and a client aimed at an httptest.Server.
func NewHandler(db database.DB, guard Guard, ports Ports, api *Client, now func() time.Time, log *slog.Logger) *Handler {
	svc := NewService(db, ports, api, now, log)
	return &Handler{svc: svc, guard: guard, log: svc.log}
}

// NotifyFoodReadyForPosOrder is notifyGofoodFoodReadyForPosOrder for the KDS
// hook of PATCH /api/pos/orders/{id}/status. It never fails: errors are
// logged and stored in gofood_orders.last_error.
func (h *Handler) NotifyFoodReadyForPosOrder(ctx context.Context, posOrderID string) {
	h.svc.NotifyFoodReadyForPosOrder(ctx, posOrderID)
}
