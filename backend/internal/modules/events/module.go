// Package events is the event calendar: one read model over CRM events,
// site events, class sessions and PT appointments, the conflict check the
// CRM and site writers run before saving, the notices the involved parties
// get, the per-event checklist, and the ICS and CSV exports.
package events

import (
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "events"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New mounts the module on the shared pool.
func New(deps module.Deps, ports Ports) module.Module { return NewOn(deps, deps.DB, ports) }

// NewOn mounts the module on db: a rolled-back transaction in tests.
func NewOn(deps module.Deps, db database.DB, ports Ports) module.Module {
	return mod{h: &handler{svc: NewService(db, ports, deps.Now, deps.Log), guard: deps.Auth}}
}
