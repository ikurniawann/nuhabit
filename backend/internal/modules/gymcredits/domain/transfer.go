package domain

import "time"

// Credit transfers move live credits from one member to another lot by lot.
// The sender's lot is cut by a transfer_out entry; the receiver gets a new
// lot with the same package (so the same class types) and the same expiry,
// created by a transfer_in entry. No money moves.

const (
	TransferIn  EntryType = "transfer_in"
	TransferOut EntryType = "transfer_out"
)

// TransferPick asks for Credits out of one of the sender's lots.
type TransferPick struct {
	LotID   string
	Credits int
}

// TransferLot is credits leaving one lot of the sender.
type TransferLot struct {
	Lot     Lot
	Credits int
}

// TransferProblem is why a transfer cannot go ahead.
type TransferProblem string

const (
	TransferNoCredits  TransferProblem = "no_credits"
	TransferToSelf     TransferProblem = "to_self"
	TransferLotUnknown TransferProblem = "lot_unknown"
	TransferLotLapsed  TransferProblem = "lot_lapsed"
	TransferLotShort   TransferProblem = "lot_short"
	TransferShort      TransferProblem = "short"
	TransferMonthlyCap TransferProblem = "monthly_cap"
	TransferReserved   TransferProblem = "reserved"
	TransferDisabled   TransferProblem = "disabled"
)

// TransferProblemMessages are the user-facing messages per problem.
var TransferProblemMessages = map[TransferProblem]string{
	TransferNoCredits:  "Jumlah kredit yang dikirim harus lebih dari nol.",
	TransferToSelf:     "Pengirim dan penerima harus member yang berbeda.",
	TransferLotUnknown: "Lot kredit tidak ditemukan pada member pengirim.",
	TransferLotLapsed:  "Lot kredit ini sudah kedaluwarsa.",
	TransferLotShort:   "Sisa kredit di lot ini kurang dari jumlah yang dikirim.",
	TransferShort:      "Saldo kredit aktif tidak cukup untuk transfer ini.",
	TransferMonthlyCap: "Batas transfer kredit bulan ini sudah tercapai.",
	TransferReserved:   "Kredit ini sudah dipesan untuk booking kelas mendatang. Batalkan booking dulu atau kirim lebih sedikit.",
	TransferDisabled:   "Transfer kredit antar member belum diaktifkan.",
}

// PlanTransfer picks the lots a transfer draws from. With picks, each names
// a live lot with enough credits left (a lot named twice adds up). Without
// picks, credits come from the live lots earliest expiry first. The result
// follows the order of remainders.
func PlanTransfer(remainders []LotRemainder, picks []TransferPick, credits int, now time.Time) ([]TransferLot, TransferProblem) {
	want := map[string]int{}
	if len(picks) > 0 {
		credits = 0
		for _, p := range picks {
			if p.Credits <= 0 {
				return nil, TransferNoCredits
			}
			want[p.LotID] += p.Credits
			credits += p.Credits
		}
	}
	if credits <= 0 {
		return nil, TransferNoCredits
	}
	var out []TransferLot
	if len(picks) > 0 {
		found := 0
		for _, r := range remainders {
			n, ok := want[r.Lot.ID]
			if !ok {
				continue
			}
			found++
			switch {
			case !r.Lot.ExpiresAt.After(now):
				return nil, TransferLotLapsed
			case r.Remaining < n:
				return nil, TransferLotShort
			}
			out = append(out, TransferLot{Lot: r.Lot, Credits: n})
		}
		if found < len(want) {
			return nil, TransferLotUnknown
		}
		return out, ""
	}
	left := credits
	for _, r := range remainders {
		if left == 0 {
			break
		}
		if r.Remaining <= 0 || !r.Lot.ExpiresAt.After(now) {
			continue
		}
		take := min(r.Remaining, left)
		out = append(out, TransferLot{Lot: r.Lot, Credits: take})
		left -= take
	}
	if left > 0 {
		return nil, TransferShort
	}
	return out, ""
}

// WithinTransferCap reports whether sending credits keeps the month's
// transfers at or under limit; 0 means no cap.
func WithinTransferCap(limit, sentThisMonth, credits int) bool {
	return limit == 0 || sentThisMonth+credits <= limit
}

// AfterTransfer is remainders with the transferred credits taken out.
func AfterTransfer(remainders []LotRemainder, moved []TransferLot) []LotRemainder {
	out := make([]LotRemainder, len(remainders))
	copy(out, remainders)
	for _, m := range moved {
		for i := range out {
			if out[i].Lot.ID == m.Lot.ID {
				out[i].Remaining -= m.Credits
			}
		}
	}
	return out
}
