package gymscheduling

import (
	"context"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/localtime"
)

// Gate check-in: QR scan, the booking pipeline (membership, waiver, re-entry
// and anti-passback, booking or open gym, balance) and manual front-desk
// check-in. Every outcome is written to gym.access_logs. Port of
// gym-checkin-server.ts.

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

// gatePoint is where a scan happened: the branch, the staff member or
// device that scanned, and the access log source (gate, pos, manual, device).
type gatePoint struct {
	BranchID, ScannedBy, DeviceID *string
	Source                        string
}

// logAccess records the outcome; bookingID or ptParticipantID names what
// the member was admitted for.
func (s *Service) logAccess(ctx context.Context, q Q, res CheckInResult, bookingID, ptParticipantID *string, at gatePoint) error {
	return s.repo.LogAccess(ctx, q, AccessEntry{
		CustomerID: res.CustomerID, BookingID: bookingID, PTParticipantID: ptParticipantID, BranchID: at.BranchID,
		Decision: res.Decision, Reason: strPtr(res.Reason), EntryKind: strPtr(res.EntryKind),
		CreditsDeducted: res.CreditsDeducted, Source: at.Source, ScannedBy: at.ScannedBy, DeviceID: at.DeviceID,
	})
}

// lockPTCandidate is the PT session the gate may check the member in to,
// when gym-coaching is wired and no class booking starts sooner.
func (s *Service) lockPTCandidate(ctx context.Context, q Q, customerID string, at gatePoint, now time.Time, early, late time.Duration, class *Candidate) (*PTCandidate, error) {
	if s.PT == nil {
		return nil, nil
	}
	pt, err := s.PT.LockGateCandidate(ctx, q, customerID, at.BranchID, now, early, late)
	if err != nil || pt == nil || (class != nil && !pt.StartsAt.Before(class.StartsAt)) {
		return nil, err
	}
	return pt, nil
}

// openGymVisit gathers the open gym facts for a member without a booking
// around now: the branch hours, a pass covering now, whether they already
// entered open gym today (in the branch zone) and, when they would pay, the
// balance.
func (s *Service) openGymVisit(ctx context.Context, q Q, customerID string, branchID *string, zone *time.Location, rules domain.Rules, now time.Time) (*domain.OpenGymVisit, *ActivePass, int, error) {
	var hours []domain.OpenHours
	if branchID != nil {
		var err error
		if hours, err = s.repo.OpenGymHours(ctx, q, *branchID); err != nil {
			return nil, nil, 0, err
		}
	}
	pass, err := s.Passes.ActivePassAt(ctx, q, customerID, now)
	if err != nil {
		return nil, nil, 0, err
	}
	paid, err := s.repo.EnteredOpenGymSince(ctx, q, customerID, localtime.DayStart(now, zone))
	if err != nil {
		return nil, nil, 0, err
	}
	visit := &domain.OpenGymVisit{Open: domain.IsOpenGymTime(hours, now, zone), HasPass: pass != nil, PaidToday: paid}
	balance := 0
	if pass == nil && !paid && rules.OpenGymCreditCost > 0 {
		if balance, err = s.Credits.GetBalance(ctx, q, customerID); err != nil {
			return nil, nil, 0, err
		}
	}
	return visit, pass, balance, nil
}

// checkInBooking runs the gate for a member whose QR is already valid:
// membership, waiver, re-entry/anti-passback, a confirmed booking at this
// branch inside the check-in window, or open gym, then the balance. On
// success the credits are deducted and the booking checked in within the
// same transaction. token is consumed when set.
func (s *Service) checkInBooking(ctx context.Context, q Q, customerID string, at gatePoint, token string, now time.Time) (CheckInResult, error) {
	var res CheckInResult
	member, err := s.Members.Get(ctx, q, customerID)
	if err != nil {
		return res, err
	}
	rules, err := s.Rules.ForBranch(ctx, q, at.BranchID)
	if err != nil {
		return res, err
	}
	zone, err := localtime.BranchZone(ctx, q, at.BranchID)
	if err != nil {
		return res, err
	}
	lastEntry, err := s.repo.LastAllowedEntry(ctx, q, customerID)
	if err != nil {
		return res, err
	}
	early, late := domain.CheckInWindow(rules)
	candidate, err := s.repo.LockCheckInCandidate(ctx, q, customerID, at.BranchID, now, early, late)
	if err != nil {
		return res, err
	}
	pt, err := s.lockPTCandidate(ctx, q, customerID, at, now, early, late, candidate)
	if err != nil {
		return res, err
	}
	if pt != nil {
		candidate = nil
	}
	// A pass covers the class; otherwise credits from a package that does
	// not cover this class cannot pay for it.
	var pass *ActivePass
	var openGym *domain.OpenGymVisit
	covered := true
	balance := 0
	switch {
	case pt != nil:
		if !pt.Covered {
			if balance, err = s.usableBalance(ctx, q, customerID, pt.ClassTypeID); err != nil {
				return res, err
			}
		}
	case candidate != nil:
		if pass, err = s.Passes.ActivePassAt(ctx, q, customerID, candidate.StartsAt); err != nil {
			return res, err
		}
		if pass == nil {
			ids, err := s.Credits.CoveredClassTypeIDs(ctx, q, customerID)
			if err != nil {
				return res, err
			}
			covered = domain.IsClassTypeCovered(ids, candidate.ClassTypeID)
		}
		if covered && pass == nil {
			if balance, err = s.Credits.GetBalance(ctx, q, customerID); err != nil {
				return res, err
			}
		}
	case rules.OpenGymEnabled:
		if openGym, pass, balance, err = s.openGymVisit(ctx, q, customerID, at.BranchID, zone, rules, now); err != nil {
			return res, err
		}
	}

	in := domain.GateScanInput{
		MemberActive:       member.Active(),
		WaiverMissing:      s.waiverMissing(rules, member),
		LastAllowedEntryAt: lastEntry,
		OpenGym:            openGym,
		Balance:            balance,
		Rules:              rules,
		Now:                now,
	}
	if candidate != nil {
		in.Candidate = &domain.GateCandidate{BookingID: candidate.ID, CreditCost: candidate.CreditCost, HasPass: pass != nil}
	}
	if pt != nil {
		in.Candidate = &domain.GateCandidate{BookingID: pt.ParticipantID, CreditCost: pt.CreditCost, HasPass: pt.Covered, Personal: true}
	}
	eval := domain.EvaluateGateScan(in)

	decision, reason := eval.Decision, eval.Reason
	creditsDeducted := 0
	balanceAfter := balance
effects:
	for _, effect := range eval.Effects {
		var charge *CreditMovement
		switch effect.Kind {
		case domain.EffectConsumeToken:
			if token != "" {
				if err := s.Qr.Consume(ctx, q, token, now); err != nil {
					return res, err
				}
			}
		case domain.EffectDeductCredits:
			charge = &CreditMovement{
				SourceType:     "class_booking",
				SourceID:       candidate.ID,
				IdempotencyKey: domain.ChargeKey("checkin", candidate.ID, candidate.CorrectionSeq),
				Note:           "Check-in " + candidate.ClassName + ", " + localtime.Format(candidate.StartsAt, zone),
			}
		case domain.EffectChargeOpenGym:
			day := localtime.DayKey(now, zone)
			charge = &CreditMovement{
				SourceType:     "open_gym",
				IdempotencyKey: "gym:open_gym:" + customerID + ":" + day,
				Note:           "Open gym " + day,
			}
		case domain.EffectCheckIn:
			if err := s.repo.MarkCheckedIn(ctx, q, effect.BookingID, now); err != nil {
				return res, err
			}
		case domain.EffectCheckInPT:
			charged, ok, err := s.PT.GateCheckIn(ctx, q, effect.BookingID, now)
			if err != nil {
				return res, err
			}
			if !ok {
				decision, reason = domain.Denied, domain.GateInsufficientCredits
				break effects
			}
			if creditsDeducted = charged; charged > 0 {
				if balanceAfter, err = s.Credits.GetBalance(ctx, q, customerID); err != nil {
					return res, err
				}
			}
		}
		if charge == nil {
			continue
		}
		charge.CustomerID, charge.Amount = customerID, effect.Amount
		charged, err := s.Credits.Deduct(ctx, q, *charge)
		if err != nil {
			return res, err
		}
		// The balance can change between read and charge: the gate stays shut.
		if !charged.OK {
			decision, reason = domain.Denied, domain.GateInsufficientCredits
			break effects
		}
		creditsDeducted, balanceAfter = effect.Amount, charged.BalanceAfter
	}

	var entryKind domain.GateEntryKind
	if decision == domain.Allowed {
		entryKind = eval.EntryKind
	}
	className, passCovered := "", pass != nil
	var bookingID, ptID *string
	switch {
	case candidate != nil:
		className, bookingID = candidate.ClassName, &candidate.ID
	case pt != nil:
		className, ptID, passCovered = pt.ClassName, &pt.ParticipantID, pt.Covered
	}
	res = CheckInResult{
		Decision:  decision,
		Reason:    nonEmpty(reason),
		EntryKind: nonEmpty(entryKind),
		Message: domain.DescribeGateDecision(decision, reason, entryKind,
			domain.GateDetail{ClassName: className, Credits: creditsDeducted, BalanceAfter: &balanceAfter, Pass: passCovered}),
		CustomerID:      &customerID,
		CreditsDeducted: creditsDeducted,
		BalanceAfter:    &balanceAfter,
	}
	if member != nil {
		res.MemberName = member.Name
	}
	switch entryKind {
	case domain.EntryBooking:
		res.Booking = &CheckInBookingRef{ID: candidate.ID, SessionID: candidate.SessionID, ClassName: candidate.ClassName, StartsAt: candidate.StartsAt}
	case domain.EntryPT:
		res.Booking = &CheckInBookingRef{ID: pt.ParticipantID, SessionID: pt.AppointmentID, ClassName: pt.ClassName, StartsAt: pt.StartsAt}
	}
	if err := s.logAccess(ctx, q, res, bookingID, ptID, at); err != nil {
		return res, err
	}
	switch {
	case entryKind == domain.EntryBooking || entryKind == domain.EntryPT:
		body := strconv.Itoa(creditsDeducted) + " kredit dipotong. Sisa " + strconv.Itoa(balanceAfter) + " kredit. Selamat berlatih!"
		if passCovered {
			body = "Pass aktif, tanpa potong kredit. Selamat berlatih!"
		}
		title := "Check-in: " + className
		if entryKind == domain.EntryPT {
			title = "Check-in PT: " + className
		}
		if err := s.Notifier.NotifyMember(ctx, q, customerID, Notification{Type: "gym_checked_in", Title: title, Body: body}); err != nil {
			return res, err
		}
	case entryKind == domain.EntryOpenGym && creditsDeducted > 0:
		s.notify(ctx, q, customerID, Notification{
			Type: "gym_checked_in", Title: "Open gym",
			Body: strconv.Itoa(creditsDeducted) + " kredit dipotong untuk open gym hari ini. Sisa " + strconv.Itoa(balanceAfter) +
				" kredit. Masuk lagi hari ini gratis.",
		})
	}
	return res, nil
}

// ScanQr validates the member QR at the gate or front desk, then runs the
// check-in pipeline.
func (s *Service) ScanQr(ctx context.Context, rawToken string, branchID, scannedBy *string) (CheckInResult, error) {
	return s.scan(ctx, rawToken, gatePoint{BranchID: branchID, ScannedBy: scannedBy, Source: "gate"})
}

func (s *Service) scan(ctx context.Context, rawToken string, at gatePoint) (res CheckInResult, err error) {
	now := s.now()
	token := strings.ToLower(strings.TrimSpace(rawToken))
	err = s.inTx(ctx, func(q Q) error {
		row, err := s.Qr.Lock(ctx, q, token)
		if err != nil {
			return err
		}
		problem := domain.CheckQrToken(row, now)
		if problem == "" {
			res, err = s.checkInBooking(ctx, q, row.CustomerID, at, token, now)
			return err
		}
		reason := domain.TokenDenial[problem]
		res = CheckInResult{Decision: domain.Denied, Reason: &reason, Message: domain.GateDenialLabel[reason]}
		if row != nil {
			res.CustomerID = &row.CustomerID
		}
		return s.logAccess(ctx, q, res, nil, nil, at)
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
		res, err = s.checkInBooking(ctx, q, customerID, gatePoint{ScannedBy: scannedBy, Source: source}, "", now)
		return err
	})
	return res, err
}

// CheckInManually checks a booking in from the front-desk roster (no QR).
// Credits are charged as at the gate and the waiver rule applies;
// anti-passback and the time window do not, because staff decide.
func (s *Service) CheckInManually(ctx context.Context, bookingID string, scannedBy *string) (res CheckInResult, err error) {
	now := s.now()
	err = s.inTx(ctx, func(q Q) error {
		booking, session, err := s.lockBookingWithSession(ctx, q, bookingID, "")
		if err != nil {
			return err
		}
		if !domain.CanTransitionBooking(booking.Status, domain.BookingCheckedIn) {
			return codedError("CHECKIN_NOT_CONFIRMED", "Hanya booking terkonfirmasi yang bisa check-in", nil)
		}
		if err := s.requireWaiver(ctx, q, booking.CustomerID, session.BranchID); err != nil {
			return err
		}
		pass, err := s.Passes.ActivePassAt(ctx, q, booking.CustomerID, session.StartsAt)
		if err != nil {
			return err
		}
		detail := domain.GateDetail{ClassName: session.ClassTypeName, Pass: pass != nil}
		creditsDeducted := 0
		if pass == nil {
			covered, err := s.Credits.CoveredClassTypeIDs(ctx, q, booking.CustomerID)
			if err != nil {
				return err
			}
			if !domain.IsClassTypeCovered(covered, session.ClassTypeID) {
				return codedError("CHECKIN_CLASS_NOT_COVERED", "Paket kredit member tidak mencakup kelas ini", nil)
			}
			charged, err := s.Credits.Deduct(ctx, q, CreditMovement{
				CustomerID:     booking.CustomerID,
				Amount:         session.CreditCost,
				SourceType:     "class_booking",
				SourceID:       booking.ID,
				IdempotencyKey: domain.ChargeKey("checkin", booking.ID, booking.CorrectionSeq),
				Note:           "Check-in " + session.label() + " (front desk)",
			})
			if err != nil {
				return err
			}
			if !charged.OK {
				return codedError("CHECKIN_INSUFFICIENT_CREDITS", "Kredit member tidak cukup untuk kelas ini",
					map[string]any{"needed": session.CreditCost})
			}
			creditsDeducted = session.CreditCost
			detail.Credits, detail.BalanceAfter = session.CreditCost, &charged.BalanceAfter
		}
		if err := s.repo.MarkCheckedIn(ctx, q, booking.ID, now); err != nil {
			return err
		}
		kind := domain.EntryBooking
		res = CheckInResult{
			Decision:        domain.Allowed,
			EntryKind:       &kind,
			Message:         domain.DescribeGateDecision(domain.Allowed, "", kind, detail),
			CustomerID:      &booking.CustomerID,
			Booking:         &CheckInBookingRef{ID: booking.ID, SessionID: session.ID, ClassName: session.ClassTypeName, StartsAt: session.StartsAt},
			CreditsDeducted: creditsDeducted,
			BalanceAfter:    detail.BalanceAfter,
		}
		return s.logAccess(ctx, q, res, &booking.ID, nil, gatePoint{BranchID: session.BranchID, ScannedBy: scannedBy, Source: "manual"})
	})
	return res, err
}
