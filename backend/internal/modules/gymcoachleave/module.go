// Package gymcoachleave is coach leave at the gym: the Program Director's
// queue, substitutes (covers) for the classes and PT sessions a leave
// touches, blackout dates, the time off an approved leave creates, coach
// discipline incidents with warning letter (SP) proposals, and the schedule
// change report. The leave itself stays in HRIS (hris.leaves); HRIS calls
// this module through its CoachLeaves port (Hooks) when a coach's leave is
// submitted, decided or cancelled.
package gymcoachleave

import (
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "gym-coach-leave"

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module. ports come from internal/app.
func New(deps module.Deps, ports Ports) module.Module {
	return mod{h: &handler{svc: NewService(deps.DB, ports, deps.Now, deps.Log), guard: deps.Auth}}
}
