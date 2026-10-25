package gymcomplaints

import "nuhabit/backend/internal/platform/module"

// Name is the MODULES key.
const Name = "gym-complaints"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module. ports come from internal/app.
func New(deps module.Deps, ports Ports) module.Module {
	return mod{h: &handler{svc: NewService(deps.DB, ports, deps.Now, deps.Log), guard: deps.Auth}}
}
