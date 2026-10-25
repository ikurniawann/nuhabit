package gymtraining

import (
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "gym-training"

// Ports are what this module needs from other contexts.
type Ports struct {
	Scheduling Scheduling
	Customers  Customers
	Payroll    Payroll
	Notifier   Notifier
	// Commission feeds revenue-share commission; Discipline cuts it (nil
	// cuts nothing).
	Commission CommissionSources
	Discipline Discipline
}

type mod struct{ handlers }

func (mod) Name() string { return Name }

// New builds the module from its dependencies and ports.
func New(deps module.Deps, ports Ports) module.Module {
	svc := NewService(newPgRepo(deps.DB), ports, deps.Now)
	return mod{handlers{svc: svc, auth: deps.Auth, guard: deps.Auth}}
}

// NewOn builds the module on db, an open transaction in tests: every use
// case runs inside it, each transaction of its own in a savepoint.
func NewOn(deps module.Deps, db database.DB, ports Ports) module.Module {
	svc := NewService(&pgRepo{db: db, outer: db}, ports, deps.Now)
	return mod{handlers{svc: svc, auth: deps.Auth, guard: deps.Auth}}
}
