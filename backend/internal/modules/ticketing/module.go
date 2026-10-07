package ticketing

import (
	"log/slog"

	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/ratelimit"
)

// Name is the MODULES key.
const Name = "ticketing"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return append(m.h.Routes(), m.h.publicRoutes()...) }

// New builds the module; ports come from internal/app.
func New(deps module.Deps, ports Ports) module.Module {
	log := deps.Log
	if log == nil {
		log = slog.Default()
	}
	svc := NewService(deps.DB, ports, deps.Now, log)
	return mod{h: newHandler(svc, deps.Auth, ports.Venues)}
}

func newHandler(svc *Service, guard Guard, venues Venues) *handler {
	return &handler{svc: svc, guard: guard, venues: venues, limiter: ratelimit.New(svc.db), now: svc.now}
}
