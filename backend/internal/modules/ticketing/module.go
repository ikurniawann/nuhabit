package ticketing

import (
	"log/slog"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "ticketing"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module; ports come from internal/app.
func New(deps module.Deps, ports Ports) module.Module {
	log := deps.Log
	if log == nil {
		log = slog.Default()
	}
	svc := NewService(deps.DB, ports, deps.Now, log)
	return mod{h: &handler{svc: svc, guard: deps.Auth, venues: ports.Venues, limiter: domain.NewRateLimiter(), now: svc.now}}
}
