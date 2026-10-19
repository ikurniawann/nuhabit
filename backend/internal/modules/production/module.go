package production

import (
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "production"

type productionModule struct{ routes []module.Route }

func (m productionModule) Name() string           { return Name }
func (m productionModule) Routes() []module.Route { return m.routes }

// New mounts the module on the shared pool. internal/app passes the
// inventory and POS adapters as ports.
func New(deps module.Deps, ports Ports) module.Module {
	return NewOn(deps, deps.DB, ports)
}

// NewOn mounts the module on db (a test transaction in integration tests).
func NewOn(deps module.Deps, db database.DB, ports Ports) module.Module {
	h := &Handler{svc: NewService(db, Postgres{}, ports, deps.Now, deps.Log), auth: deps.Auth, db: db}
	return productionModule{routes: h.Routes()}
}
