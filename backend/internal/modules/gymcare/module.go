// Package gymcare is member care for coaches and the front desk: member
// flags (general and medical), the PAR-Q health declaration members fill in
// the member app, and the notes coaches write after a class or PT session.
//
// Medical detail (medical flags, PAR-Q answers, coach notes) reaches only
// gym managers (read_medical on gym.member-flags) and the coaches of the
// member's sessions today or later. The queries apply that rule, so a list
// never carries a row the caller may not read.
//
// It owns gym.member_flag_types, gym.member_flags, gym.health_declarations
// and gym.member_session_notes, and reads the gym session, booking and PT
// tables directly.
package gymcare

import (
	"net/http"
	"time"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "gym-care"

// Guard checks staff grants and resolves member sessions.
type Guard interface {
	auth.Granter
	RequireMember(r *http.Request) (string, error)
}

// Service runs the member care use cases on db (a pool, or a transaction
// in tests).
type Service struct {
	db  database.DB
	now func() time.Time
}

// NewService builds the service; now nil is time.Now.
func NewService(db database.DB, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{db: db, now: now}
}

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module.
func New(deps module.Deps) module.Module {
	return mod{h: &handler{svc: NewService(deps.DB, deps.Now), guard: deps.Auth}}
}
