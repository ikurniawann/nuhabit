package gymscheduling

import (
	"context"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// CreditDemand is what one booking will draw from the ledger at check-in.
type CreditDemand struct {
	ClassTypeID string
	Credits     int
	At          time.Time
}

// CreditCoverer is an optional CreditLedger method: whether the member's
// lots pay for the upcoming bookings (pending) plus next, class type
// restrictions and expiry included. Without it booking subtracts the
// reserved credits from the usable balance.
type CreditCoverer interface {
	CanCover(ctx context.Context, q database.Querier, customerID string, pending []CreditDemand, next CreditDemand) (bool, error)
}

// creditsFit asks the ledger whether the member can pay for session on top
// of pending; nil when the ledger cannot tell (no CreditCoverer).
func (s *Service) creditsFit(ctx context.Context, q Q, customerID string, session *SessionRow, pending []CreditDemand) (*bool, error) {
	cover, ok := s.Credits.(CreditCoverer)
	if !ok {
		return nil, nil
	}
	next := CreditDemand{ClassTypeID: session.ClassTypeID, Credits: session.CreditCost, At: session.StartsAt}
	fits, err := cover.CanCover(ctx, q, customerID, pending, next)
	if err != nil {
		return nil, err
	}
	return &fits, nil
}
