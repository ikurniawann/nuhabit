package gymscheduling

import (
	"context"
	"strconv"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
)

// Booking writes: take a seat or a waitlist place, cancel (with the late
// cancel rule), promote the waitlist, accept an offered seat, no-show. Port of
// booking-actions-server.ts. Credits are not charged at booking.

type BookResult struct {
	BookingID        string               `json:"bookingId"`
	Status           domain.BookingStatus `json:"status"`
	WaitlistPosition *int                 `json:"waitlistPosition"`
}

func denial(reason domain.BookingDenialReason) error {
	return schedulingError(domain.BookingDenialLabel[reason])
}

// BookSession takes a seat or a waitlist place. The session row is locked, so
// two requests for the last seat run in turn: one confirmed, the next waitlisted.
func (s *Service) BookSession(ctx context.Context, customerID, sessionID, source string) (out BookResult, err error) {
	now := s.now()
	err = s.inTx(ctx, func(q Q) error {
		session, err := s.lockSession(ctx, q, sessionID)
		if err != nil {
			return err
		}
		member, err := s.Members.Get(ctx, q, customerID)
		if err != nil {
			return err
		}
		if member == nil {
			return schedulingError("Member tidak ditemukan", 404)
		}
		stats, err := s.repo.BookingStats(ctx, q, session.ID, customerID)
		if err != nil {
			return err
		}
		balance, err := s.Credits.GetBalance(ctx, q, customerID)
		if err != nil {
			return err
		}
		pass, err := s.Passes.ActivePassAt(ctx, q, customerID, session.StartsAt)
		if err != nil {
			return err
		}
		decision := domain.EvaluateBookingEligibility(domain.EligibilityInput{
			MemberActive: member.Active(),
			Session: domain.BookableSession{
				Status: session.Status, Capacity: session.Capacity, CreditCost: session.CreditCost,
				BookingOpensAt: session.BookingOpensAt, BookingClosesAt: session.BookingClosesAt,
			},
			Balance:              balance,
			HasPass:              pass != nil,
			ConfirmedCount:       stats.Confirmed,
			LastWaitlistPosition: stats.LastWaitlist,
			HasActiveBooking:     stats.Mine,
			Now:                  now,
		})
		if decision.Kind == domain.DecisionDeny {
			return denial(decision.Reason)
		}
		// A package may limit class types: the balance exists but not for
		// this class. A pass covers every class.
		if pass == nil {
			covered, err := s.Credits.CoveredClassTypeIDs(ctx, q, customerID)
			if err != nil {
				return err
			}
			if !domain.IsClassTypeCovered(covered, session.ClassTypeID) {
				return schedulingError("Paket kredit Anda tidak mencakup kelas ini")
			}
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
		if pass != nil {
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
		if err := s.Notifier.NotifyMember(ctx, q, customerID, n); err != nil {
			return err
		}
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
// members cancel their own.
func (s *Service) CancelBooking(ctx context.Context, bookingID, customerID string) (out CancelResult, err error) {
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
		if err := s.repo.CancelBooking(ctx, q, booking.ID, outcome.Late, now); err != nil {
			return err
		}
		if outcome.PassStrike {
			if err := s.repo.MarkPassStrike(ctx, q, booking.ID); err != nil {
				return err
			}
		}
		penalty, err := s.chargePenalty(ctx, q, booking.CustomerID, outcome.PenaltyCredits, "late_cancel", booking.ID,
			"Batal terlambat: "+session.label())
		if err != nil {
			return err
		}

		var promoted *Promoted
		if booking.Status == domain.BookingConfirmed {
			if promoted, err = s.promoteWaitlist(ctx, q, session, rules.WaitlistAutoPromote, now); err != nil {
				return err
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
			if err := s.Notifier.NotifyMember(ctx, q, booking.CustomerID, Notification{
				Type: "gym_booking_cancelled", Title: "Booking dibatalkan: " + session.ClassTypeName, Body: body,
			}); err != nil {
				return err
			}
		}
		out = CancelResult{Late: outcome.Late, Deadline: outcome.Deadline, PenaltyCredits: penalty, PassStrike: outcome.PassStrike, Promoted: promoted}
		return nil
	})
	return out, err
}

// promoteWaitlist hands the freed seat to the head of the queue: confirmed
// at once (auto) or offered (offer).
func (s *Service) promoteWaitlist(ctx context.Context, q Q, session *SessionRow, autoPromote bool, now time.Time) (*Promoted, error) {
	rows, err := s.repo.LockWaitlist(ctx, q, session.ID)
	if err != nil {
		return nil, err
	}
	entries := make([]domain.WaitlistEntry, len(rows))
	for i, r := range rows {
		entries[i] = r.waitlistEntry()
	}
	booking, mode := domain.PlanWaitlistPromotion(entries, autoPromote)
	if booking == nil {
		return nil, nil
	}
	n := Notification{
		Type:  "gym_waitlist_promoted",
		Title: "Kursi tersedia: " + session.ClassTypeName,
		Body:  "Anda naik dari waitlist dan sudah terdaftar untuk " + domain.FormatWib(session.StartsAt) + ".",
	}
	if mode == domain.PromoteAuto {
		err = s.repo.AutoPromote(ctx, q, booking.ID)
	} else {
		err = s.repo.OfferPromotion(ctx, q, booking.ID, now)
		n = Notification{
			Type:  "gym_waitlist_offer",
			Title: "Kursi ditawarkan: " + session.ClassTypeName,
			Body: "Ada kursi kosong untuk " + domain.FormatWib(session.StartsAt) +
				". Konfirmasi di portal sebelum diambil member lain.",
		}
	}
	if err != nil {
		return nil, err
	}
	if err := s.Notifier.NotifyMember(ctx, q, booking.CustomerID, n); err != nil {
		return nil, err
	}
	return &Promoted{CustomerID: booking.CustomerID, Mode: mode}, nil
}

// ConfirmWaitlistOffer: the member accepts a seat offered from the waitlist.
func (s *Service) ConfirmWaitlistOffer(ctx context.Context, bookingID, customerID string) error {
	return s.inTx(ctx, func(q Q) error {
		booking, session, err := s.lockBookingWithSession(ctx, q, bookingID, customerID)
		if err != nil {
			return err
		}
		if booking.Status != domain.BookingWaitlist || booking.PromotionOfferedAt == nil {
			return schedulingError("Belum ada kursi yang ditawarkan untuk Anda di kelas ini")
		}
		held, err := s.repo.SeatsHeld(ctx, q, session.ID)
		if err != nil {
			return err
		}
		if held >= session.Capacity {
			return schedulingError("Kursi itu sudah diambil member lain")
		}
		if err := s.repo.ConfirmFromWaitlist(ctx, q, booking.ID); err != nil {
			return err
		}
		return s.syncSessionSeats(ctx, q, session)
	})
}

// NoShowResult is {penaltyCredits}.
type NoShowResult struct {
	PenaltyCredits int `json:"penaltyCredits"`
}

// MarkNoShow marks an absent member; the credits are forfeited under the forfeit policy.
func (s *Service) MarkNoShow(ctx context.Context, bookingID string) (out NoShowResult, err error) {
	err = s.inTx(ctx, func(q Q) error {
		booking, session, err := s.lockBookingWithSession(ctx, q, bookingID, "")
		if err != nil {
			return err
		}
		if !domain.CanTransitionBooking(booking.Status, domain.BookingNoShow) {
			return schedulingError("Hanya booking terkonfirmasi yang bisa ditandai tidak hadir")
		}
		out.PenaltyCredits, err = s.applyNoShow(ctx, q, booking, session)
		return err
	})
	return out, err
}
