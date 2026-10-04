// Package ticketing is the event contract of the ticketing context
// (venue tickets, visits, website bookings, season passes).
package ticketing

// Topics.
const (
	// TopicBookingCancelled is a website booking cancelled by an admin
	// (cancelBooking in lib/ticketing/bookings-admin-server.ts). The promo
	// it used, held or captured, is released.
	TopicBookingCancelled = "ticketing.booking.cancelled"
	// TopicBookingExpired is an unpaid booking lazily expired when the loket
	// looked it up (expireBookingIfDue in lib/ticketing/booking-server.ts).
	// Its promo hold is released.
	TopicBookingExpired = "ticketing.booking.expired"
)

// PromoContextTicketBooking is the promo.promo_redemptions context_type of
// a ticket booking.
const PromoContextTicketBooking = "ticket_booking"

// BookingReleased is the payload of both topics. A subscriber releases the
// promo redemptions of (PromoContextType, BookingID) as
// releasePromoRedemption in lib/promo/promo-server.ts does: redemptions not
// yet released become 'released' and each code's usage_count drops by one
// (never below zero). The release is idempotent.
type BookingReleased struct {
	BookingID        string `json:"booking_id"`
	BookingCode      string `json:"booking_code"`
	CompanyID        string `json:"company_id"`
	BranchID         string `json:"branch_id"`
	PromoContextType string `json:"promo_context_type"`
}
