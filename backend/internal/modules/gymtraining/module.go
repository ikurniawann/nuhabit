package gymtraining

import "nuhabit/backend/internal/platform/module"

// Name is the MODULES key.
const Name = "gym-training"

// Ports are the reads this module needs from other contexts.
type Ports struct {
	Scheduling Scheduling
	Customers  Customers
}

type mod struct{ handlers }

func (mod) Name() string { return Name }

// New builds the module from its dependencies and ports.
func New(deps module.Deps, ports Ports) module.Module {
	svc := NewService(newPgRepo(deps.DB), ports.Scheduling, ports.Customers, deps.Now)
	return mod{handlers{svc: svc, auth: deps.Auth}}
}
