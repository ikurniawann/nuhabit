package desktop

import "nuhabit/backend/internal/platform/module"

// Name is the MODULES key.
const Name = "desktop"

type mod struct{ handlers }

func (mod) Name() string { return Name }

// New builds the module from its dependencies.
func New(deps module.Deps) module.Module {
	return mod{handlers{svc: NewService(NewPostgres(deps.DB), deps.Auth, deps.Log, deps.Now)}}
}
