package gymscheduling

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
)

// Booking writes: take a seat or a waitlist place, cancel (with the late
// cancel rule), promote the waitlist, accept an offered seat, no-show, and
// the sweep that lapses unanswered offers. Port of booking-actions-server.ts.
// Credits are not charged at booking; they are reserved against the
// member's other upcoming bookings.

type BookResult struct {
	BookingID        string               `json:"bookingId"`
	Status           domain.BookingStatus `json:"status"`
	WaitlistPosition *int                 `json:"waitlistPosition"`
}

func denial(reason domain.BookingDenialReason) error {
	return schedulingError(domain.BookingDenialLabel[reason])
}

func (s *SessionRow) bookable() domain.BookableSession {
	return domain.BookableSession{
		Status: s.Status, Capacity: s.Capacity, CreditCost: s.CreditCost, StartsAt: s.StartsAt,
		BookingOpensAt: s.BookingOpensAt, BookingClosesAt: s.BookingClosesAt,
	}
}

// usableBalance is the balance that may pay for the class type: the ledger's
// UsableBalance when it has one, else the whole balance.
func (s *Service) usableBalance(ctx context.Context, q Q, customerID, classTypeID string) (int, error) {
	if ub, ok := s.Credits.(UsableBalancer); ok {
		return ub.UsableBalance(ctx, q, customerID, classTypeID)
	}
	return s.Credits.GetBalance(ctx, q, customerID)
}

// memberFacts gathers what EvaluateMemberEligibility needs for one member
// and session: membership, pass, the balance and the credits the member's
// other upcoming bookings reserve, package coverage, the booking caps and
// pass strikes. found is false when the customer does not exist.
func (s *Service) memberFacts(ctx context.Context, q Q, customerID string, session *SessionRow, rules domain.Rules, now time.Time) (in domain.EligibilityInput, found bool, err error) {
	member, err := s.Members.Get(ctx, q, customerID)
	if err != nil || member == nil {
		return in, false, err
	}
	pass, err := s.Passes.ActivePassAt(ctx, q, customerID, session.StartsAt)
	if err != nil {
		return in, true, err
	}
	balance, err := s.usableBalance(ctx, q, customerID, session.ClassTypeID)
	if err != nil {
		return in, true, err
	}
	strikes, err := s.repo.PassStrikeTimes(ctx, q, customerID)
	if err != nil {
		return in, true, err
	}
	in = domain.EligibilityInput{
		MemberActive:   member.Active(),
		Session:        session.bookable(),
		Balance:        balance,
		HasPass:        pass != nil,
		MaxConcurrent:  rules.MaxConcurrentBookings,
		MaxPerDay:      rules.MaxBookingsPerDay,
		SuspendedUntil: domain.EvaluatePassStrikes(strikes, rules, now).SuspendedUntil,
		Now:            now,
	}
	dayStart, dayEnd := domain.WibDayBounds(session.StartsAt)
	commitments, err := s.repo.MemberCommitments(ctx, q, customerID, session.ID, dayStart, dayEnd, now)
	if err != nil {
		return in, true, err
	}
	for _, c := range commitments {
		if !c.StartsAt.Before(dayStart) && c.StartsAt.Before(dayEnd) {
			in.SameDayBookings++
		}
		if c.Status != domain.BookingConfirmed || !c.StartsAt.After(now) {
			continue
		}
		in.UpcomingConfirmed++
		// A booking a pass covers is charged nothing at check-in.
		covering, err := s.Passes.ActivePassAt(ctx, q, customerID, c.StartsAt)
		if err != nil {
			return in, true, err
		}
		if covering == nil {
			in.Reserved += c.CreditCost
		}
	}
	// A package may limit class types: the balance exists but not for this
	// class. A pass covers every class.
	if pass == nil {
		covered, err := s.Credits.CoveredClassTypeIDs(ctx, q, customerID)
		if err != nil {
			return in, true, err
		}
		in.ClassNotCovered = !domain.IsClassTypeCovered(covered, session.ClassTypeID)
	}
	return in, true, nil
}

// BookSession takes a seat or a waitlist place. The session row is locked, so
// two requests for the last seat run in turn: one confirmed, the next
// waitlisted. A seat offered to the waitlist counts as taken.
func (s *Service) BookSession(ctx context.Context, customerID, sessionID, source string) (out BookResult, err error) {
	now := s.now()
	err = s.inTx(ctx, func(q Q) error {
		session, err := s.lockSession(ctx, q, sessionID)
		if err != nil {
			return err
		}
		rules, err := s.Rules.ForBranch(ctx, q, session.BranchID)
		if err != nil {
			return err
		}
		in, found, err := s.memberFacts(ctx, q, customerID, session, rules, now)
		if err != nil {
			return err
		}
		if !found {
			return schedulingError("Member tidak ditemukan", 404)
		}
		stats, err := s.repo.BookingStats(ctx, q, session.ID, customerID, now)
		if err != nil {
			return err
		}
		in.ConfirmedCount, in.LastWaitlistPosition, in.HasActiveBooking = stats.Confirmed+stats.Offered, stats.LastWaitlist, stats.Mine
		decision := domain.EvaluateBookingEligibility(in)
		if decision.Kind == domain.DecisionDeny {
			return schedulingError(in.DenialMessage(decision.Reason))
		}

		status := domain.BookingConfirmed
		var position *int
		if decision.Kind == domain.DecisionWaitlist {
			status, position = domain.BookingWaitlist, &decision.Position
		}
		id, err := s.repo.InsertBooking(ctx, q, session.ID, customerID, status, position, source)
		if database.IsUniqueViolation(err) {
			return denial(domain.DenyAlreadyBooked)
		}
		if err != nil {
			return err
		}
		if status == domain.BookingConfirmed {
			if err := s.syncSessionSeats(ctx, q, session); err != nil {
				return err
			}
		}
		charge := strconv.Itoa(session.CreditCost) + " kredit dipotong saat check-in."
		if in.HasPass {
			charge = "Pass aktif, tanpa potong kredit."
		}
		n := Notification{
			Type:  "gym_booking_confirmed",
			Title: "Terdaftar: " + session.ClassTypeName,
			Body:  "Sampai jumpa " + domain.FormatWib(session.StartsAt) + ". " + charge,
		}
		if status == domain.BookingWaitlist {
			n = Notification{
				Type:  "gym_booking_waitlist",
				Title: "Masuk waitlist: " + session.ClassTypeName,
				Body:  "Posisi Anda #" + strconv.Itoa(*position) + ". Kami kabari bila ada kursi kosong.",
			}
		}
		s.notify(ctx, q, customerID, n)
		out = BookResult{BookingID: id, Status: status, WaitlistPosition: position}
		return nil
	})
	return out, err
}

// Promoted names who got the freed seat and how.
type Promoted struct {
	CustomerID string               `json:"customerId"`
	Mode       domain.PromotionMode `json:"mode"`
}

// CancelResult: PenaltyCredits were actually deducted for the late cancel,
// or PassStrike recorded against a pass holder.
type CancelResult struct {
	Late           bool
	Deadline       time.Time
	PenaltyCredits int
	PassStrike     bool
	Promoted       *Promoted
}

// MarshalJSON keeps the field order of the TS object with a JS-style deadline.
func (c CancelResult) MarshalJSON() ([]byte, error) {
	return marshalNoEscape(struct {
		Late           bool      `json:"late"`
		Deadline       jsTime    `json:"deadline"`
		PenaltyCredits int       `json:"penaltyCredits"`
		PassStrike     bool      `json:"passStrike"`
		Promoted       *Promoted `json:"promoted"`
	}{c.Late, jsTime(c.Deadline), c.PenaltyCredits, c.PassStrike, c.Promoted})
}

// CancelBooking frees the seat. Cancelling after the free deadline forfeits
// the session credits under the forfeit policy (a strike for pass holders);
// the freed seat goes to the head of the waitlist. customerID is set when
// members cancel their own. waivePenalty lets staff cancel without the
// penalty or strike; it is ignored for members.
func (s *Service) CancelBooking(ctx context.Context, bookingID, customerID string, waivePenalty bool) (out CancelResult, err error) {
	now := s.now()
	err = s.inTx(ctx, func(q Q) error {
		booking, session, err := s.lockBookingWithSession(ctx, q, bookingID, customerID)
		if err != nil {
			return err
		}
		if !domain.CanTransitionBooking(booking.Status, domain.BookingCancelled) {
			return schedulingError("Booking ini tidak bisa dibatalkan lagi")
		}
		rules, err := s.Rules.ForBranch(ctx, q, session.BranchID)
		if err != nil {
			return err
		}
		pass, err := s.Passes.ActivePassAt(ctx, q, booking.CustomerID, session.StartsAt)
		if err != nil {
			return err
		}
		outcome := domain.EvaluateCancellation(booking.Status, session.StartsAt, session.CreditCost, pass != nil, rules, now)
		outcome = domain.WaiveLateCancelForMove(outcome, session.Move(), booking.CreatedAt, rules, now)
		if waivePenalty && customerID == "" {
			outcome = outcome.Waived()
		}
		freesSeat := domain.HoldsSeat(booking.Status, booking.PromotionExpiresAt, now)
		if err := s.repo.CancelBooking(ctx, q, booking.ID, outcome.Late, now); err != nil {
			return err
		}
		if outcome.PassStrike {
			if err := s.repo.MarkPassStrike(ctx, q, booking.ID, now); err != nil {
				return err
			}
		}
		penalty, err := s.chargePenalty(ctx, q, booking.CustomerID, outcome.PenaltyCredits, "late_cancel", booking.ID,
			"Batal terlambat: "+session.label())
		if err != nil {
			return err
		}

		var promoted *Promoted
		if freesSeat {
			moved, err := s.promoteWaitlist(ctx, q, session, rules, now)
			if err != nil {
				return err
			}
			if len(moved) > 0 {
				promoted = &moved[0]
			}
			if err := s.syncSessionSeats(ctx, q, session); err != nil {
				return err
			}
		}

		// A member cancelling their own booking already sees the result on screen.
		if customerID == "" {
			body := "Booking " + domain.FormatWib(session.StartsAt) + " dibatalkan."
			switch {
			case penalty > 0:
				body = "Booking " + domain.FormatWib(session.StartsAt) + " dibatalkan setelah batas gratis; " +
					strconv.Itoa(penalty) + " kredit hangus."
			case outcome.PassStrike:
				body = "Booking " + domain.FormatWib(session.StartsAt) + " dibatalkan setelah batas gratis; tercatat satu strike pada pass Anda."
			}
			s.notify(ctx, q, booking.CustomerID, Notification{
				Type: "gym_booking_cancelled", Title: "Booking dibatalkan: " + session.ClassTypeName, Body: body,
			})
		}
		out = CancelResult{Late: outcome.Late, Deadline: outcome.Deadline, PenaltyCredits: penalty, PassStrike: outcome.PassStrike, Promoted: promoted}
		return nil
	})
	return out, err
}

// promoteWaitlist fills the free seats from the head of the queue while
// booking is open. Each member is checked again first (credits available,
// pass, coverage, caps, suspension); one who no longer qualifies is told
// why, stays on the waitlist and is skipped. Outside the cutoff a seat is
// confirmed at once; inside it, or with auto promotion off, it is offered
// and held until the offer lapses.
func (s *Service) promoteWaitlist(ctx context.Context, q Q, session *SessionRow, rules domain.Rules, now time.Time) ([]Promoted, error) {
	if !domain.CanPromoteWaitlist(session.bookable(), now) {
		return nil, nil
	}
	held, err := s.repo.SeatsHeld(ctx, q, session.ID)
	if err != nil {
		return nil, err
	}
	offered, err := s.repo.OffersHeld(ctx, q, session.ID, now)
	if err != nil {
		return nil, err
	}
	free := domain.FreeSeats(session.Capacity, held, offered)
	if free == 0 {
		return nil, nil
	}
	rows, err := s.repo.LockWaitlist(ctx, q, session.ID)
	if err != nil {
		return nil, err
	}
	entries := make([]domain.WaitlistEntry, len(rows))
	for i, r := range rows {
		entries[i] = r.waitlistEntry()
	}
	mode := domain.WaitlistPromotionMode(rules, session.StartsAt, now)
	var promoted []Promoted
	for _, e := range domain.WaitlistQueue(entries) {
		if free == 0 {
			break
		}
		in, _, err := s.memberFacts(ctx, q, e.CustomerID, session, rules, now)
		if err != nil {
			return nil, err
		}
		if reason := domain.EvaluateMemberEligibility(in); reason != "" {
			s.notify(ctx, q, e.CustomerID, Notification{
				Type:  "gym_waitlist_skipped",
				Title: "Kursi tersedia: " + session.ClassTypeName,
				Body: "Ada kursi kosong untuk " + domain.FormatWib(session.StartsAt) + ", tetapi Anda belum bisa naik dari waitlist: " +
					in.DenialMessage(reason) + ". Anda tetap di waitlist.",
			})
			continue
		}
		n := Notification{
			Type:  "gym_waitlist_promoted",
			Title: "Kursi tersedia: " + session.ClassTypeName,
			Body:  "Anda naik dari waitlist dan sudah terdaftar untuk " + domain.FormatWib(session.StartsAt) + ".",
		}
		if mode == domain.PromoteAuto {
			err = s.repo.AutoPromote(ctx, q, e.ID)
		} else {
			expires := domain.OfferExpiry(rules, session.BookingClosesAt, now)
			err = s.repo.OfferPromotion(ctx, q, e.ID, now, expires)
			n = Notification{
				Type:  "gym_waitlist_offer",
				Title: "Kursi ditawarkan: " + session.ClassTypeName,
				Body: "Ada kursi kosong untuk " + domain.FormatWib(session.StartsAt) +
					". Konfirmasi di portal sebelum " + domain.FormatWib(expires) + " atau kursi ditawarkan ke member berikutnya.",
			}
		}
		if err != nil {
			return nil, err
		}
		s.notify(ctx, q, e.CustomerID, n)
		promoted = append(promoted, Promoted{CustomerID: e.CustomerID, Mode: mode})
		free--
	}
	return promoted, nil
}

// PromoteFromWaitlist fills the session's free seats from the waitlist, on
// the caller's transaction. Call it after anything that frees seats, such
// as a capacity increase.
func (s *Service) PromoteFromWaitlist(ctx context.Context, q Q, sessionID string) ([]Promoted, error) {
	session, err := s.lockSession(ctx, q, sessionID)
	if err != nil {
		return nil, err
	}
	rules, err := s.Rules.ForBranch(ctx, q, session.BranchID)
	if err != nil {
		return nil, err
	}
	promoted, err := s.promoteWaitlist(ctx, q, session, rules, s.now())
	if err != nil {
		return nil, err
	}
	return promoted, s.syncSessionSeats(ctx, q, session)
}

// ConfirmWaitlistOffer: the member accepts a seat offered from the waitlist,
// while the offer is open and booking has not closed, and only if they still
// qualify.
func (s *Service) ConfirmWaitlistOffer(ctx context.Context, bookingID, customerID string) error {
	now := s.now()
	return s.inTx(ctx, func(q Q) error {
		booking, session, err := s.lockBookingWithSession(ctx, q, bookingID, customerID)
		if err != nil {
			return err
		}
		held, err := s.repo.SeatsHeld(ctx, q, session.ID)
		if err != nil {
			return err
		}
		offered, err := s.repo.OffersHeld(ctx, q, session.ID, now)
		if err != nil {
			return err
		}
		if domain.HoldsSeat(booking.Status, booking.PromotionExpiresAt, now) {
			offered-- // this member's own offer
		}
		if reason := domain.EvaluateOfferAcceptance(domain.OfferInput{
			Status: booking.Status, OfferedAt: booking.PromotionOfferedAt, ExpiresAt: booking.PromotionExpiresAt,
			Session: session.bookable(), SeatsTaken: held + offered, Now: now,
		}); reason != "" {
			return denial(reason)
		}
		rules, err := s.Rules.ForBranch(ctx, q, session.BranchID)
		if err != nil {
			return err
		}
		in, _, err := s.memberFacts(ctx, q, booking.CustomerID, session, rules, now)
		if err != nil {
			return err
		}
		if reason := domain.EvaluateMemberEligibility(in); reason != "" {
			return schedulingError(in.DenialMessage(reason))
		}
		if err := s.repo.ConfirmFromWaitlist(ctx, q, booking.ID); err != nil {
			return err
		}
		return s.syncSessionSeats(ctx, q, session)
	})
}

// SweepWaitlistOffers cancels the waitlist offers that lapsed by now, tells
// those members, and passes each freed seat to the next eligible member.
// Each session runs in its own transaction, so one failure does not hold up
// the others. A job runner calls it every minute.
func (s *Service) SweepWaitlistOffers(ctx context.Context, now time.Time) error {
	ids, err := s.repo.SessionsWithLapsedOffers(ctx, s.db, now)
	if err != nil {
		return err
	}
	var errs []error
	for _, id := range ids {
		if err := s.inTx(ctx, func(q Q) error { return s.lapseOffers(ctx, q, id, now) }); err != nil {
			errs = append(errs, fmt.Errorf("gym waitlist sweep, session %s: %w", id, err))
		}
	}
	return errors.Join(errs...)
}

func (s *Service) lapseOffers(ctx context.Context, q Q, sessionID string, now time.Time) error {
	session, err := s.lockSession(ctx, q, sessionID)
	if err != nil {
		return err
	}
	customers, err := s.repo.CancelLapsedOffers(ctx, q, session.ID, now)
	if err != nil {
		return err
	}
	for _, c := range customers {
		s.notify(ctx, q, c, Notification{
			Type:  "gym_waitlist_offer_expired",
			Title: "Tawaran kursi berakhir: " + session.ClassTypeName,
			Body:  "Kursi untuk " + domain.FormatWib(session.StartsAt) + " tidak dikonfirmasi tepat waktu, jadi tempat Anda di waitlist dilepas.",
		})
	}
	rules, err := s.Rules.ForBranch(ctx, q, session.BranchID)
	if err != nil {
		return err
	}
	if _, err := s.promoteWaitlist(ctx, q, session, rules, now); err != nil {
		return err
	}
	return s.syncSessionSeats(ctx, q, session)
}

// NoShowResult is {penaltyCredits}.
type NoShowResult struct {
	PenaltyCredits int `json:"penaltyCredits"`
}

// MarkNoShow marks an absent member once the class has started; the credits
// are forfeited under the forfeit policy.
func (s *Service) MarkNoShow(ctx context.Context, bookingID string) (out NoShowResult, err error) {
	err = s.inTx(ctx, func(q Q) error {
		booking, session, err := s.lockBookingWithSession(ctx, q, bookingID, "")
		if err != nil {
			return err
		}
		if !domain.CanTransitionBooking(booking.Status, domain.BookingNoShow) {
			return schedulingError("Hanya booking terkonfirmasi yang bisa ditandai tidak hadir")
		}
		if !domain.CanMarkNoShow(session.StartsAt, s.now()) {
			return schedulingError("Kelas belum dimulai; tandai tidak hadir setelah kelas mulai")
		}
		out.PenaltyCredits, err = s.applyNoShow(ctx, q, booking, session)
		return err
	})
	return out, err
}
