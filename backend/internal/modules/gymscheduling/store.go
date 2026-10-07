package gymscheduling

import (
	"context"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
)

// Shared steps of the write paths. Port of booking-store.ts.

func (s *Service) lockSession(ctx context.Context, q Q, id string) (*SessionRow, error) {
	session, err := s.repo.LockSession(ctx, q, id)
	if err == nil && session == nil {
		err = schedulingError("Sesi tidak ditemukan", 404)
	}
	return session, err
}

// lockBookingWithSession locks the session first, then the booking, always in
// that order (as bookSession and completeSession do) so two transactions
// never wait on each other. customerID, when set, must own the booking.
func (s *Service) lockBookingWithSession(ctx context.Context, q Q, id, customerID string) (*BookingRow, *SessionRow, error) {
	sessionID, owner, err := s.repo.BookingRef(ctx, q, id)
	if err != nil {
		return nil, nil, err
	}
	if sessionID == "" || (customerID != "" && owner != customerID) {
		return nil, nil, schedulingError("Booking tidak ditemukan", 404)
	}
	session, err := s.lockSession(ctx, q, sessionID)
	if err != nil {
		return nil, nil, err
	}
	booking, err := s.repo.LockBooking(ctx, q, id)
	return booking, session, err
}

// syncSessionSeats keeps published and full in step with the seats held now.
func (s *Service) syncSessionSeats(ctx context.Context, q Q, session *SessionRow) error {
	held, err := s.repo.SeatsHeld(ctx, q, session.ID)
	if err != nil {
		return err
	}
	next := domain.SessionStatusForSeats(session.Status, held, session.Capacity)
	if next == session.Status {
		return nil
	}
	if err := s.repo.SetSessionStatus(ctx, q, session.ID, next); err != nil {
		return err
	}
	session.Status = next
	return nil
}

// chargePenalty deducts penalty credits (late cancel, no-show). A short
// balance never goes negative: at most the current balance is taken.
func (s *Service) chargePenalty(ctx context.Context, q Q, customerID string, amount int, sourceType, bookingID, note string) (int, error) {
	if amount <= 0 {
		return 0, nil
	}
	balance, err := s.Credits.GetBalance(ctx, q, customerID)
	if err != nil {
		return 0, err
	}
	amount = min(amount, balance)
	if amount <= 0 {
		return 0, nil
	}
	res, err := s.Credits.Deduct(ctx, q, CreditMovement{
		CustomerID:     customerID,
		Amount:         amount,
		SourceType:     sourceType,
		SourceID:       bookingID,
		IdempotencyKey: "gym:" + sourceType + ":" + bookingID,
		Note:           note,
	})
	if err != nil || !res.OK {
		return 0, err
	}
	return amount, nil
}

// applyNoShow marks the booking no-show and charges per the no-show policy:
// credits, or a strike when a pass covered the class.
func (s *Service) applyNoShow(ctx context.Context, q Q, booking *BookingRow, session *SessionRow) (int, error) {
	rules, err := s.Rules.ForBranch(ctx, q, session.BranchID)
	if err != nil {
		return 0, err
	}
	pass, err := s.Passes.ActivePassAt(ctx, q, booking.CustomerID, session.StartsAt)
	if err != nil {
		return 0, err
	}
	if err := s.repo.MarkNoShow(ctx, q, booking.ID); err != nil {
		return 0, err
	}
	penalty, strike := domain.NoShowPenalty(session.CreditCost, pass != nil, rules)
	if strike {
		return 0, s.repo.MarkPassStrike(ctx, q, booking.ID)
	}
	return s.chargePenalty(ctx, q, booking.CustomerID, penalty, "no_show", booking.ID, "Tidak hadir: "+session.label())
}

// branchRules reads the rules once per branch for the length of one operation.
func (s *Service) branchRules(q Q) func(ctx context.Context, branchID *string) (domain.Rules, error) {
	cache := map[string]domain.Rules{}
	return func(ctx context.Context, branchID *string) (domain.Rules, error) {
		key := ""
		if branchID != nil {
			key = *branchID
		}
		if r, ok := cache[key]; ok {
			return r, nil
		}
		r, err := s.Rules.ForBranch(ctx, q, branchID)
		if err == nil {
			cache[key] = r
		}
		return r, err
	}
}
