// Package gymdesk is the staff side of gym membership: the member list and
// the member 360 page, staff notes, front desk registration, the gym reports
// and the check-in log with a date range.
//
// Like insights it is a read model: it reads the gym tables of gym-scheduling
// and gym-credits and the member rows of pos.pos_customers directly, and owns
// one table, gym.member_notes. Writes to other contexts go through Ports.
package gymdesk

import (
	"context"
	"encoding/json"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "gym-desk"

// NewMember is a member registered at the front desk.
type NewMember struct {
	Name, Phone, Email string
}

// ProfilePatch is a staff edit of a member. Nil fields keep their value; an
// empty Email or BirthDate clears it. With EmergencyContactSet, a nil
// EmergencyContact clears the contact.
type ProfilePatch struct {
	Name, Phone, Email, BirthDate *string
	EmergencyContactSet           bool
	EmergencyContact              map[string]any
}

// Accounts creates and edits members (owned by the member portal). Errors
// that are *httpx.Error carry the status and message for the desk.
type Accounts interface {
	Register(ctx context.Context, db database.DB, m NewMember) (string, error)
	UpdateProfile(ctx context.Context, db database.DB, customerID string, p ProfilePatch) error
}

// CreditExpiry is the credits of one member that lapse within a horizon:
// the sum left on the lots expiring in it and the earliest of their expiries.
type CreditExpiry struct {
	CustomerID string
	Credits    int
	ExpiresAt  time.Time
}

// Credits reads gym-credits: the staff credit view of a member (balance,
// lots, passes, ledger and package purchases, as JSON) and the members
// whose credits lapse within withinDays days of now, earliest first.
type Credits interface {
	MemberCredits(ctx context.Context, customerID string) (json.RawMessage, error)
	Expiring(ctx context.Context, q database.Querier, now time.Time, withinDays int) ([]CreditExpiry, error)
}

// Ports are the adapters internal/app wires in.
type Ports struct {
	Accounts Accounts
	Credits  Credits
	// WaiverVersion is the waiver text members accept today.
	WaiverVersion string
}

type mod struct{ h *handler }

func (mod) Name() string             { return Name }
func (m mod) Routes() []module.Route { return m.h.Routes() }

// New builds the module.
func New(deps module.Deps, ports Ports) module.Module {
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	return mod{h: &handler{svc: &Service{db: deps.DB, ports: ports, now: now}, guard: deps.Auth}}
}
