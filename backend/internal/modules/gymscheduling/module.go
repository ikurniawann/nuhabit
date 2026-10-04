package gymscheduling

import (
	"log/slog"

	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "gym-scheduling"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module. ports come from internal/app, which owns the
// adapters to other contexts.
func New(deps module.Deps, ports Ports) module.Module {
	log := deps.Log
	if log == nil {
		log = slog.Default()
	}
	svc := NewService(deps.DB, Postgres{}, ports, deps.Now)
	return mod{h: &handler{svc: svc, guard: deps.Auth, log: log}}
}
