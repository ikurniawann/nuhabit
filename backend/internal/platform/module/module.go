// Package module defines the contract between internal/app and each
// bounded context under internal/modules.
package module

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/config"
)

// Deps is everything a module may depend on. Modules never reach for
// globals; tests build a Deps by hand.
type Deps struct {
	DB     *pgxpool.Pool
	Auth   *auth.Service
	Log    *slog.Logger
	Now    func() time.Time
	Config config.Config
}

// Route is one ServeMux pattern, e.g. "GET /api/gym/packages/{id}".
type Route struct {
	Pattern string
	Handler http.Handler
}

// Module is a mounted bounded context.
type Module interface {
	Name() string
	Routes() []Route
}
