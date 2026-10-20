package gymscheduling

import (
	"context"
	"strconv"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
)

// Lapsed and declined waitlist offers.

// requeueLapsed handles offers that lapsed unanswered: a first lapse puts
// the member back in the queue at their old position (or at the end when
// another entry holds it now); a second lapse removes them from the waitlist.
func (s *Service) requeueLapsed(ctx context.Context, q Q, session *SessionRow, lapsed []BookingRow, now time.Time) error {
	when := session.when()
	for _, b := range lapsed {
		n := Notification{Type: "gym_waitlist_offer_expired", Title: "Tawaran kursi berakhir: " + session.ClassTypeName}
		if domain.RequeueAfterLapse(b.OfferLapses) {
			position, err := s.repo.RequeueOffer(ctx, q, b.ID)
			if err != nil {
				return err
			}
			n.Body = "Kursi untuk " + when + " tidak dikonfirmasi tepat waktu. " +
				"Anda kembali ke waitlist di posisi #" + strconv.Itoa(position) + "."
		} else {
			if err := s.repo.CancelBooking(ctx, q, b.ID, false, now); err != nil {
				return err
			}
			n.Body = "Kursi untuk " + when + " dua kali tidak dikonfirmasi tepat waktu, jadi tempat Anda di waitlist dilepas."
		}
		s.notify(ctx, q, b.CustomerID, n)
	}
	return nil
}

// DeclineWaitlistOffer: the member turns down a seat offered from the
// waitlist. They leave the waitlist and the seat goes to the next member.
func (s *Service) DeclineWaitlistOffer(ctx context.Context, bookingID, customerID string) error {
	now := s.now()
	return s.inTx(ctx, func(q Q) error {
		booking, session, err := s.lockBookingWithSession(ctx, q, bookingID, customerID)
		if err != nil {
			return err
		}
		if booking.Status != domain.BookingWaitlist || booking.PromotionOfferedAt == nil {
			return denial(domain.DenyNoOffer)
		}
		if err := s.repo.CancelBooking(ctx, q, booking.ID, false, now); err != nil {
			return err
		}
		rules, err := s.Rules.ForBranch(ctx, q, session.BranchID)
		if err != nil {
			return err
		}
		if _, err := s.promoteWaitlist(ctx, q, session, rules, now); err != nil {
			return err
		}
		return s.syncSessionSeats(ctx, q, session)
	})
}
