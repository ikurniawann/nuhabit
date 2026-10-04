// Package resort ports /api/resort/** (lib/resort): room types and rooms,
// availability and rate quotes, reservations with their folio, and the
// front office board and status transitions.
package resort

import (
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "resort"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module; venues comes from internal/app.
func New(deps module.Deps, venues Venues) module.Module {
	svc := NewService(deps.DB, deps.Now)
	return mod{h: &handler{svc: svc, guard: deps.Auth, venues: venues, now: svc.now}}
}
