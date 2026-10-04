// Package shop owns the online shop context (/api/shop/** and
// /api/public/shop/**): the public storefront (catalog, server-priced
// checkout with stock reservations and a Xendit invoice, order status),
// back-office orders and shipments, courier rates through Biteship or
// RajaOngkir, the Xendit and Biteship webhooks, and the Shopee marketplace
// sync. Port of frontend/src/lib/shop.
package shop

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// Service holds the shop use cases.
type Service struct {
	db    database.DB
	ports Ports
	now   func() time.Time
	log   *slog.Logger
	http  *http.Client
	// Provider base URLs; tests point them at httptest servers.
	biteshipBase   string
	rajaongkirBase string
	// async runs best-effort work after the response (the TS `void
	// promise`); tests run it inline.
	async func(func())
}

// NewService builds the service on a pool (or a test transaction).
func NewService(db database.DB, ports Ports, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	if ports.Getenv == nil {
		ports.Getenv = os.Getenv
	}
	return &Service{
		db: db, ports: ports, now: now, log: log,
		http:           &http.Client{},
		biteshipBase:   "https://api.biteship.com",
		rajaongkirBase: "https://rajaongkir.komerce.id/api/v1",
		async:          func(fn func()) { go fn() },
	}
}

// background detaches ctx from the request so best-effort work outlives it.
func (s *Service) background(ctx context.Context, fn func(ctx context.Context)) {
	ctx = context.WithoutCancel(ctx)
	s.async(func() { fn(ctx) })
}

// releaseExpiredReservations is releaseExpiredReservations: opportunistic,
// a failure is only logged.
func (s *Service) releaseExpiredReservations(ctx context.Context) {
	if _, err := s.db.Exec(ctx, `SELECT shop.release_expired_reservations()`); err != nil {
		s.log.Error("[shop] release expired reservations failed", "error", err)
	}
}
