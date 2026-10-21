package domain

import "time"

// A transfer reclaim takes a transfer back while the receiver has not used
// the credits: what is still unused in the receiver's linked lot returns to
// the sender's lot it came from. The ledger records a transfer_out on the
// receiver's lot and a refund on the sender's lot, both with source
// transfer_reclaim and the transfer's id, so the original transfer entries
// stay as written and a transfer can be reclaimed more than once as its
// credits come back (a cancelled class, say).

// TransferLotState is one lot a transfer moved, with the credits a
// reclaim already took back.
type TransferLotState struct {
	ID          string
	SourceLotID string
	TargetLotID string
	Credits     int
	Reclaimed   int
}

// ReclaimLot is credits going back from the receiver's lot to the sender's.
type ReclaimLot struct {
	TransferLotState
	Credits int
}

// TransferReclaimNothing is the message when no credit of the transfer is
// left unused at the receiver.
const TransferReclaimNothing = "Kredit transfer ini sudah terpakai atau kedaluwarsa di penerima, tidak ada yang bisa ditarik kembali."

// PlanReclaim picks what a reclaim can take back now: per moved lot, the
// credits still unused in the receiver's live linked lot, at most what the
// transfer moved minus what earlier reclaims took. Empty when nothing can.
func PlanReclaim(lots []TransferLotState, receiver []LotRemainder, now time.Time) []ReclaimLot {
	var out []ReclaimLot
	for _, l := range lots {
		left := l.Credits - l.Reclaimed
		if left <= 0 {
			continue
		}
		for _, r := range receiver {
			if r.Lot.ID != l.TargetLotID || !r.Lot.ExpiresAt.After(now) {
				continue
			}
			if take := min(r.Remaining, left); take > 0 {
				out = append(out, ReclaimLot{TransferLotState: l, Credits: take})
			}
		}
	}
	return out
}

// ReclaimTotal sums the credits of a plan.
func ReclaimTotal(plan []ReclaimLot) int {
	total := 0
	for _, p := range plan {
		total += p.Credits
	}
	return total
}
