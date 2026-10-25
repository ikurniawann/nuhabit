package gymsop

import (
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/storage"
)

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module; msg sends the WhatsApp copy of reminders.
func New(deps module.Deps, msg Messenger) module.Module {
	return mod{h: &handler{svc: NewService(deps.DB, storage.FromEnv(), msg, deps.Now, deps.Log), guard: deps.Auth}}
}
