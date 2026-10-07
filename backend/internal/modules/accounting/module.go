package accounting

import (
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/storage"
)

// Name is the MODULES key.
const Name = "accounting"

type mod struct{ h *Handler }

func (m mod) Name() string           { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module on the pool and subscribes its journal handlers.
func New(deps module.Deps, ports Ports) module.Module {
	return NewOn(deps, deps.DB, ports)
}

// NewOn builds the module on db (a test transaction in integration tests).
func NewOn(deps module.Deps, db database.DB, ports Ports) module.Module {
	svc := NewService(db, ports, deps.Log, deps.Now)
	if deps.Events != nil {
		svc.subscribe(deps.Events)
	}
	return mod{&Handler{svc: svc, auth: deps.Auth, files: storage.FromEnv()}}
}
