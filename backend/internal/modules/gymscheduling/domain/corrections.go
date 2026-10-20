package domain

import (
	"slices"
	"strconv"
	"time"
)

// ── Staff corrections ───────────────────────────────────────────────────────

// Correction is a staff undo of a booking outcome.
type Correction string

const (
	UndoCheckIn Correction = "undo_check_in"
	UndoNoShow  Correction = "undo_no_show"
)

// correctable lists the booking statuses each correction undoes. A check-in
// stays undoable after the session closes it as completed.
var correctable = map[Correction][]BookingStatus{
	UndoCheckIn: {BookingCheckedIn, BookingCompleted},
	UndoNoShow:  {BookingNoShow},
}

// CheckCorrection returns why the correction cannot run, or "" when it can:
// the booking holds the outcome being undone, the session was not cancelled
// (its charges were already refunded) and the class started at most
// CorrectionWindowDays ago.
func CheckCorrection(c Correction, status BookingStatus, session SessionStatus, startsAt time.Time, rules Rules, now time.Time) string {
	switch {
	case !slices.Contains(correctable[c], status):
		if c == UndoCheckIn {
			return "Hanya booking yang sudah check-in yang bisa dibatalkan check-in-nya"
		}
		return "Hanya booking tidak hadir yang bisa dikoreksi"
	case session == SessionCancelled:
		return "Sesi sudah dibatalkan dan kreditnya sudah dikembalikan"
	case now.After(startsAt.Add(time.Duration(rules.CorrectionWindowDays) * 24 * time.Hour)):
		return "Koreksi hanya bisa dalam " + strconv.Itoa(rules.CorrectionWindowDays) + " hari setelah kelas"
	}
	return ""
}

// ChargeKey is the ledger idempotency key of a booking charge (kind
// checkin, late_cancel or no_show). seq counts the corrections on the
// booking, so a charge after an undo is a new one.
func ChargeKey(kind, bookingID string, seq int) string {
	key := "gym:" + kind + ":" + bookingID
	if seq > 0 {
		key += ":" + strconv.Itoa(seq)
	}
	return key
}

// CorrectionRefundKey is the idempotency key of the refund that undoes the
// charge keyed chargeKey.
func CorrectionRefundKey(chargeKey string) string { return "gym:correction:" + chargeKey }

// ── Lapsed waitlist offers ──────────────────────────────────────────────────

// MaxOfferLapses: a member whose offers lapse this many times leaves the waitlist.
const MaxOfferLapses = 2

// RequeueAfterLapse: an offer that lapses unanswered sends the member back to
// the waitlist, unless earlier offers already lapsed MaxOfferLapses-1 times.
func RequeueAfterLapse(earlierLapses int) bool { return earlierLapses+1 < MaxOfferLapses }
