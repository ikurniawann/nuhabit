package gymscheduling

import (
	"context"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
)

// Gate check-in: QR scan, the booking pipeline (membership, re-entry and
// anti-passback, booking, balance) and manual front-desk check-in. Every
// outcome is written to gym.access_logs. Port of gym-checkin-server.ts.

// CheckInBookingRef is the booking a check-in admitted.
type CheckInBookingRef struct {
	ID        string
	SessionID string
	ClassName string
	StartsAt  time.Time
}

func (b CheckInBookingRef) MarshalJSON() ([]byte, error) {
	return marshalNoEscape(struct {
		ID        string `json:"id"`
		SessionID string `json:"sessionId"`
		ClassName string `json:"className"`
		StartsAt  jsTime `json:"startsAt"`
	}{b.ID, b.SessionID, b.ClassName, jsTime(b.StartsAt)})
}

// CheckInResult is GymCheckInResult.
type CheckInResult struct {
	Decision        domain.Decision          `json:"decision"`
	Reason          *domain.GateDenialReason `json:"reason"`
	EntryKind       *domain.GateEntryKind    `json:"entryKind"`
	Message         string                   `json:"message"`
	CustomerID      *string                  `json:"customerId"`
	MemberName      *string                  `json:"memberName"`
	Booking         *CheckInBookingRef       `json:"booking"`
	CreditsDeducted int                      `json:"creditsDeducted"`
	BalanceAfter    *int                     `json:"balanceAfter"`
}

func nonEmpty[T ~string](v T) *T {
	if v == "" {
		return nil
	}
	return &v
}

func strPtr[T ~string](v *T) *string {
	if v == nil {
		return nil
	}
	s := string(*v)
	return &s
}

func (s *Service) logAccess(ctx context.Context, q Q, res CheckInResult, bookingID, branchID *string, source string, scannedBy *string) error {
	return s.repo.LogAccess(ctx, q, AccessEntry{
		CustomerID: res.CustomerID, BookingID: bookingID, BranchID: branchID,
		Decision: res.Decision, Reason: strPtr(res.Reason), EntryKind: strPtr(res.EntryKind),
		CreditsDeducted: res.CreditsDeducted, Source: source, ScannedBy: scannedBy,
	})
}

// checkInBooking runs the gate for a member whose QR is already valid:
// membership, re-entry/anti-passback, a confirmed booking at this branch
// around now, balance. On success the credits are deducted and the booking
// checked in within the same transaction. token is consumed when set; the
// access log records source.
func (s *Service) checkInBooking(ctx context.Context, q Q, customerID string, branchID, scannedBy *string, token, source string, now time.Time) (CheckInResult, error) {
	var res CheckInResult
	member, err := s.Members.Get(ctx, q, customerID)
	if err != nil {
		return res, err
	}
	lastEntry, err := s.repo.LastAllowedEntry(ctx, q, customerID)
	if err != nil {
		return res, err
	}
	candidate, err := s.repo.LockCheckInCandidate(ctx, q, customerID, branchID, now)
	if err != nil {
		return res, err
	}
	rules, err := s.Rules.ForBranch(ctx, q, branchID)
	if err != nil {
		return res, err
	}
	// Credits from a package that does not cover this class cannot pay for it.
	covered := true
	if candidate != nil {
		ids, err := s.Credits.CoveredClassTypeIDs(ctx, q, customerID)
		if err != nil {
			return res, err
		}
		covered = domain.IsClassTypeCovered(ids, candidate.ClassTypeID)
	}
	balance := 0
	if covered {
		if balance, err = s.Credits.GetBalance(ctx, q, customerID); err != nil {
			return res, err
		}
	}

	in := domain.GateScanInput{
		MemberActive:       member.Active(),
		LastAllowedEntryAt: lastEntry,
		Balance:            balance,
		Rules:              rules,
		Now:                now,
	}
	if candidate != nil {
		in.Candidate = &domain.GateCandidate{BookingID: candidate.ID, CreditCost: candidate.CreditCost}
	}
	eval := domain.EvaluateGateScan(in)

	decision, reason := eval.Decision, eval.Reason
	creditsDeducted := 0
	balanceAfter := balance
effects:
	for _, effect := range eval.Effects {
		switch effect.Kind {
		case domain.EffectConsumeToken:
			if token != "" {
				if err := s.Qr.Consume(ctx, q, token, now); err != nil {
					return res, err
				}
			}
		case domain.EffectDeductCredits:
			charged, err := s.Credits.Deduct(ctx, q, CreditMovement{
				CustomerID:     customerID,
				Amount:         effect.Amount,
				SourceType:     "class_booking",
				SourceID:       candidate.ID,
				IdempotencyKey: "gym:checkin:" + candidate.ID,
				Note:           "Check-in " + candidate.ClassName + ", " + domain.FormatWib(candidate.StartsAt),
			})
			if err != nil {
				return res, err
			}
			// The balance can change between read and charge: the gate stays shut.
			if !charged.OK {
				decision, reason = domain.Denied, domain.GateInsufficientCredits
				break effects
			}
			creditsDeducted, balanceAfter = effect.Amount, charged.BalanceAfter
		case domain.EffectCheckIn:
			if err := s.repo.MarkCheckedIn(ctx, q, effect.BookingID, now); err != nil {
				return res, err
			}
		}
	}

	var entryKind domain.GateEntryKind
	if decision == domain.Allowed {
		entryKind = eval.EntryKind
	}
	className := ""
	if candidate != nil {
		className = candidate.ClassName
	}
	res = CheckInResult{
		Decision:  decision,
		Reason:    nonEmpty(reason),
		EntryKind: nonEmpty(entryKind),
		Message: domain.DescribeGateDecision(decision, reason, entryKind,
			domain.GateDetail{ClassName: className, Credits: creditsDeducted, BalanceAfter: &balanceAfter}),
		CustomerID:      &customerID,
		CreditsDeducted: creditsDeducted,
		BalanceAfter:    &balanceAfter,
	}
	if member != nil {
		res.MemberName = member.Name
	}
	if entryKind == domain.EntryBooking {
		res.Booking = &CheckInBookingRef{ID: candidate.ID, SessionID: candidate.SessionID, ClassName: candidate.ClassName, StartsAt: candidate.StartsAt}
	}
	var bookingID *string
	if candidate != nil {
		bookingID = &candidate.ID
	}
	if err := s.logAccess(ctx, q, res, bookingID, branchID, source, scannedBy); err != nil {
		return res, err
	}
	if entryKind == domain.EntryBooking {
		if err := s.Notifier.NotifyMember(ctx, q, customerID, Notification{
			Type:  "gym_checked_in",
			Title: "Check-in: " + candidate.ClassName,
			Body: strconv.Itoa(creditsDeducted) + " kredit dipotong. Sisa " + strconv.Itoa(balanceAfter) +
				" kredit. Selamat berlatih!",
		}); err != nil {
			return res, err
		}
	}
	return res, nil
}

// ScanQr validates the member QR at the gate or front desk, then runs the
// check-in pipeline.
func (s *Service) ScanQr(ctx context.Context, rawToken string, branchID, scannedBy *string) (res CheckInResult, err error) {
	now := s.now()
	token := strings.ToLower(strings.TrimSpace(rawToken))
	err = s.inTx(ctx, func(q Q) error {
		row, err := s.Qr.Lock(ctx, q, token)
		if err != nil {
			return err
		}
		problem := domain.CheckQrToken(row, now)
		if problem == "" {
			res, err = s.checkInBooking(ctx, q, row.CustomerID, branchID, scannedBy, token, "gate", now)
			return err
		}
		reason := domain.TokenDenial[problem]
		res = CheckInResult{Decision: domain.Denied, Reason: &reason, Message: domain.GateDenialLabel[reason]}
		if row != nil {
			res.CustomerID = &row.CustomerID
		}
		return s.logAccess(ctx, q, res, nil, branchID, "gate", scannedBy)
	})
	return res, err
}

// CheckInBooking is checkInBooking(client, {customerId, scannedBy, source})
// for a member whose QR another channel already accepted (the POS till
// passes source "pos"). It runs in its own transaction on the service's DB,
// a savepoint when that DB is the caller's transaction.
func (s *Service) CheckInBooking(ctx context.Context, customerID string, scannedBy *string, source string) (res CheckInResult, err error) {
	now := s.now()
	err = s.inTx(ctx, func(q Q) error {
		res, err = s.checkInBooking(ctx, q, customerID, nil, scannedBy, "", source, now)
		return err
	})
	return res, err
}

// CheckInManually checks a booking in from the front-desk roster (no QR).
// Credits are charged as at the gate; anti-passback and the time window do
// not apply because staff decide.
func (s *Service) CheckInManually(ctx context.Context, bookingID string, scannedBy *string) (res CheckInResult, err error) {
	now := s.now()
	err = s.inTx(ctx, func(q Q) error {
		booking, session, err := s.lockBookingWithSession(ctx, q, bookingID, "")
		if err != nil {
			return err
		}
		if !domain.CanTransitionBooking(booking.Status, domain.BookingCheckedIn) {
			return schedulingError("Hanya booking terkonfirmasi yang bisa check-in")
		}
		covered, err := s.Credits.CoveredClassTypeIDs(ctx, q, booking.CustomerID)
		if err != nil {
			return err
		}
		if !domain.IsClassTypeCovered(covered, session.ClassTypeID) {
			return schedulingError("Paket kredit member tidak mencakup kelas ini")
		}
		charged, err := s.Credits.Deduct(ctx, q, CreditMovement{
			CustomerID:     booking.CustomerID,
			Amount:         session.CreditCost,
			SourceType:     "class_booking",
			SourceID:       booking.ID,
			IdempotencyKey: "gym:checkin:" + booking.ID,
			Note:           "Check-in " + session.label() + " (front desk)",
		})
		if err != nil {
			return err
		}
		if !charged.OK {
			return schedulingError("Kredit member tidak cukup untuk kelas ini")
		}
		if err := s.repo.MarkCheckedIn(ctx, q, booking.ID, now); err != nil {
			return err
		}
		kind := domain.EntryBooking
		res = CheckInResult{
			Decision:  domain.Allowed,
			EntryKind: &kind,
			Message: domain.DescribeGateDecision(domain.Allowed, "", kind, domain.GateDetail{
				ClassName: session.ClassTypeName, Credits: session.CreditCost, BalanceAfter: &charged.BalanceAfter,
			}),
			CustomerID:      &booking.CustomerID,
			Booking:         &CheckInBookingRef{ID: booking.ID, SessionID: session.ID, ClassName: session.ClassTypeName, StartsAt: session.StartsAt},
			CreditsDeducted: session.CreditCost,
			BalanceAfter:    &charged.BalanceAfter,
		}
		return s.logAccess(ctx, q, res, &booking.ID, session.BranchID, "manual", scannedBy)
	})
	return res, err
}
