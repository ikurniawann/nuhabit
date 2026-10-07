package shop

import "nuhabit/backend/internal/platform/module"

// Name is the MODULES key.
const Name = "shop"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module; ports come from internal/app.
func New(deps module.Deps, ports Ports) module.Module {
	return newModule(deps, NewService(deps.DB, ports, deps.Now, deps.Log))
}

func newModule(deps module.Deps, svc *Service) mod {
	return mod{h: &handler{svc: svc, guard: deps.Auth}}
}
