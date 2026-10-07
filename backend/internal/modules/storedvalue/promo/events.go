package promo

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/ticketing"
	"nuhabit/backend/internal/platform/outbox"
)

// Subscribe registers the promo handlers: a cancelled or expired ticket
// booking gives its promo use back (releasePromoRedemption(client,
// "ticket_booking", id) in cancelBooking and expireBookingIfDue).
func Subscribe(bus *outbox.Bus, svc *Service) {
	bus.Subscribe(ticketing.TopicBookingCancelled, "stored-value.promo-release-cancelled-booking", svc.releaseBooking)
	bus.Subscribe(ticketing.TopicBookingExpired, "stored-value.promo-release-expired-booking", svc.releaseBooking)
}

// releaseBooking is idempotent: released redemptions are left alone, so a
// redelivery or a booking without a promo changes nothing.
func (s *Service) releaseBooking(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var b ticketing.BookingReleased
	if err := e.Decode(&b); err != nil {
		return err
	}
	contextType := b.PromoContextType
	if contextType == "" {
		contextType = ticketing.PromoContextTicketBooking
	}
	_, err := s.ReleasePromoRedemption(ctx, tx, contextType, b.BookingID)
	return err
}
