package recruitment

import (
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "recruitment"

type mod struct {
	h *handler
	f *fileHandler
}

func (mod) Name() string { return Name }
func (m mod) Routes() []module.Route {
	return append(append(m.h.Routes(), m.h.portalRoutes()...), m.f.routes()...)
}

// New builds the module; ports come from internal/app.
func New(deps module.Deps, ports Ports) module.Module {
	return newModule(deps, deps.DB, ports)
}

// newModule lets tests run the module on a rolled-back transaction.
func newModule(deps module.Deps, db database.DB, ports Ports) mod {
	h := &handler{svc: NewService(db, ports, deps.Now, deps.Log), guard: deps.Auth}
	return mod{h: h, f: newFileHandler(h)}
}
