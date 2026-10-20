package gymscheduling

import (
	"context"
	"net/http"
	"strconv"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/auth"
)

// Staff corrections: undo a check-in or a no-show within the branch's
// correctionWindowDays. The credits taken are refunded through the ledger,
// a no-show pass strike is cleared, and the booking is confirmed again. Each
// correction writes an audit row with the staff member's reason and tells
// the member.

// CorrectionResult says what a correction gave back.
type CorrectionResult struct {
	Status          domain.BookingStatus `json:"status"`
	RefundedCredits int                  `json:"refundedCredits"`
	StrikeCleared   bool                 `json:"strikeCleared"`
}

// chargeKind is the ledger charge each correction undoes.
var chargeKind = map[domain.Correction]string{
	domain.UndoCheckIn: "checkin",
	domain.UndoNoShow:  "no_show",
}

// CorrectBooking undoes a check-in or no-show. reason is required.
func (s *Service) CorrectBooking(ctx context.Context, bookingID string, c domain.Correction, reason string, staff *auth.User, r *http.Request) (out CorrectionResult, err error) {
	now := s.now()
	err = s.inTx(ctx, func(q Q) error {
		booking, session, err := s.lockBookingWithSession(ctx, q, bookingID, "")
		if err != nil {
			return err
		}
		rules, err := s.Rules.ForBranch(ctx, q, session.BranchID)
		if err != nil {
			return err
		}
		if msg := domain.CheckCorrection(c, booking.Status, session.Status, session.StartsAt, rules, now); msg != "" {
			return schedulingError(msg)
		}
		key := domain.ChargeKey(chargeKind[c], booking.ID, booking.CorrectionSeq)
		charged, err := s.repo.ChargedAmount(ctx, q, key)
		if err != nil {
			return err
		}
		if charged > 0 {
			if err := s.Credits.Refund(ctx, q, CreditMovement{
				CustomerID: booking.CustomerID, Amount: charged, SourceType: "class_booking", SourceID: booking.ID,
				IdempotencyKey: domain.CorrectionRefundKey(key), Note: "Koreksi staf: " + session.label(),
			}); err != nil {
				return err
			}
		}
		strikeCleared, err := s.repo.ReopenBooking(ctx, q, booking.ID)
		if err != nil {
			return err
		}
		if err := s.syncSessionSeats(ctx, q, session); err != nil {
			return err
		}
		out = CorrectionResult{Status: domain.BookingConfirmed, RefundedCredits: charged, StrikeCleared: strikeCleared}

		label := session.label()
		if err := audit.Write(ctx, q, audit.Entry{
			ActorID: staff.ID, ActorName: nullIfEmpty(staff.FullName), Action: "gym.booking." + string(c), Entity: "gym.bookings",
			EntityID: &booking.ID, EntityLabel: &label, Reason: &reason,
			Before: map[string]any{"status": booking.Status}, After: out,
		}.WithRequest(r)); err != nil {
			return err
		}
		s.notify(ctx, q, booking.CustomerID, correctionNotice(c, session, out))
		return nil
	})
	return out, err
}

func correctionNotice(c domain.Correction, session *SessionRow, out CorrectionResult) Notification {
	when := domain.FormatWib(session.StartsAt)
	n := Notification{Type: "gym_booking_corrected", Title: "Koreksi booking: " + session.ClassTypeName}
	if c == domain.UndoCheckIn {
		n.Body = "Check-in kelas " + when + " dibatalkan oleh staf. Booking Anda kembali terdaftar."
	} else {
		n.Body = "Status tidak hadir untuk kelas " + when + " dihapus oleh staf."
	}
	if out.RefundedCredits > 0 {
		n.Body += " " + strconv.Itoa(out.RefundedCredits) + " kredit dikembalikan ke saldo Anda."
	}
	if out.StrikeCleared {
		n.Body += " Strike pass untuk kelas ini dihapus."
	}
	return n
}
