package domain

import (
	"math"
	"sort"
	"time"
)

// ARK Coin wallet ledger rules (lib/wallet/ledger.ts).
//
// pos.pos_wallet_transactions is inconsistent about the sign of amount: the
// update_ark_coin_balance RPC stores ABS(amount), other writers sign it. The
// direction therefore comes from the type, then from the balance change.
//
// A lot is one credit (topup, bonus, refund, positive adjustment) with its
// own expiry. Spending is allocated FIFO to the soonest-expiring lot.

var (
	creditTypes = map[string]bool{"topup": true, "topup_bonus": true, "bonus": true, "refund": true}
	debitTypes  = map[string]bool{"payment": true, "withdrawal": true, "redeem": true, "expiration": true, "topup_refund": true}
	signedTypes = map[string]bool{"adjustment": true, "reversal": true}
)

// LotTypes are the types whose credit becomes an expiring lot.
var LotTypes = []string{"topup", "topup_bonus", "bonus", "refund", "adjustment"}

// LowBalanceNudgeCooldownDays is LOW_BALANCE_NUDGE_COOLDOWN_DAYS.
const LowBalanceNudgeCooldownDays = 7

const day = 24 * time.Hour

// LedgerRow is the part of a wallet row the ledger rules read.
type LedgerRow struct {
	ID            string
	Type          string
	Status        string // "" counts as completed
	Amount        float64
	BalanceBefore float64
	BalanceAfter  float64
	CreatedAt     time.Time
	ExpiresAt     *time.Time
	Metadata      map[string]any
}

// LotAllocation pins part of a debit to one lot.
type LotAllocation struct {
	LotID  string  `json:"lot_id"`
	Amount float64 `json:"amount"`
}

// Lot is one credit with its own expiry.
type Lot struct {
	ID        string
	Type      string
	Amount    float64
	CreatedAt time.Time
	ExpiresAt *time.Time
}

// LotRemainder is the unspent part of a lot.
type LotRemainder struct {
	Lot       Lot
	Remaining float64
}

// IsCompleted is `(status ?? "completed") === "completed"`.
func IsCompleted(status string) bool { return status == "" || status == "completed" }

// SignedDelta is the balance change of a row: positive adds, negative spends.
func SignedDelta(r LedgerRow) float64 {
	amount := math.Abs(r.Amount)
	switch {
	case creditTypes[r.Type]:
		return amount
	case debitTypes[r.Type]:
		return -amount
	}
	if diff := r.BalanceAfter - r.BalanceBefore; diff != 0 {
		return RoundIdr(diff)
	}
	return r.Amount
}

// IsCreditEntry reports whether a row adds to the balance (for display).
func IsCreditEntry(kind string, amount float64) bool {
	if creditTypes[kind] {
		return true
	}
	if signedTypes[kind] {
		return amount > 0
	}
	return false
}

func isLotType(kind string) bool {
	for _, t := range LotTypes {
		if t == kind {
			return true
		}
	}
	return false
}

// IsLotRow reports a completed credit that forms a lot.
func IsLotRow(r LedgerRow) bool {
	return IsCompleted(r.Status) && isLotType(r.Type) && SignedDelta(r) > 0
}

func readAllocations(metadata map[string]any) []LotAllocation {
	raw, isList := metadata["lot_allocations"].([]any)
	if !isList {
		return nil
	}
	var out []LotAllocation
	for _, item := range raw {
		entry, _ := item.(map[string]any)
		a := LotAllocation{LotID: JSString(entry["lot_id"]), Amount: ToNumber(entry["amount"])}
		if a.LotID != "" && a.Amount > 0 {
			out = append(out, a)
		}
	}
	return out
}

// lotLess orders the soonest expiry first, never-expiring last, then by
// creation and id.
func lotLess(a, b Lot) bool {
	ea, eb := math.Inf(1), math.Inf(1)
	if a.ExpiresAt != nil {
		ea = float64(a.ExpiresAt.UnixMilli())
	}
	if b.ExpiresAt != nil {
		eb = float64(b.ExpiresAt.UnixMilli())
	}
	if ea != eb {
		return ea < eb
	}
	if !a.CreatedAt.Equal(b.CreatedAt) {
		return a.CreatedAt.Before(b.CreatedAt)
	}
	return a.ID < b.ID
}

// ComputeLotRemainders is what is left of each lot after spending. Debits
// that carry metadata.lot_allocations (expiry, credit reversal, top-up
// refund) are pinned to those lots; the excess and every other debit is
// general consumption allocated FIFO. Non-lot credits (a reversed debit)
// give general consumption back.
func ComputeLotRemainders(rows []LedgerRow) []LotRemainder {
	var lots []Lot
	pinned := map[string]float64{}
	var pinnedOrder []string
	pool := 0.0

	for _, r := range rows {
		if !IsCompleted(r.Status) {
			continue
		}
		if IsLotRow(r) {
			lots = append(lots, Lot{ID: r.ID, Type: r.Type, Amount: SignedDelta(r), CreatedAt: r.CreatedAt, ExpiresAt: r.ExpiresAt})
			continue
		}
		delta := SignedDelta(r)
		if delta >= 0 {
			pool -= delta
			continue
		}
		left := -delta
		for _, a := range readAllocations(r.Metadata) {
			take := math.Min(a.Amount, left)
			if _, seen := pinned[a.LotID]; !seen {
				pinnedOrder = append(pinnedOrder, a.LotID)
			}
			pinned[a.LotID] += take
			left -= take
		}
		pool += left
	}

	lotIDs := map[string]bool{}
	for _, l := range lots {
		lotIDs[l.ID] = true
	}
	for _, id := range pinnedOrder {
		if !lotIDs[id] {
			pool += pinned[id]
		}
	}

	sort.SliceStable(lots, func(i, j int) bool { return lotLess(lots[i], lots[j]) })
	afterPinned := make([]float64, len(lots))
	for i, l := range lots {
		rest := l.Amount - pinned[l.ID]
		if rest < 0 {
			pool += -rest
		}
		afterPinned[i] = math.Max(0, rest)
	}

	pool = math.Max(0, pool)
	out := make([]LotRemainder, len(lots))
	for i, l := range lots {
		take := math.Min(afterPinned[i], pool)
		pool -= take
		out[i] = LotRemainder{Lot: l, Remaining: RoundIdr(afterPinned[i] - take)}
	}
	return out
}

// ExpirationDraft is one planned expiration row.
type ExpirationDraft struct {
	LotID         string
	Amount        float64 // positive rupiah that expires
	BalanceBefore float64
	BalanceAfter  float64
}

// PlanExpirySweep plans one member's expiry sweep: the remainder of every
// lot past its expiry expires, never more than the stored balance (old
// balances may not match the history). ProcessedLotIDs lists every due
// lot, including those with nothing left, so the hourly sweep skips them.
func PlanExpirySweep(rows []LedgerRow, balance float64, now time.Time, alreadyExpired map[string]bool) (entries []ExpirationDraft, processedLotIDs []string) {
	bal := math.Max(0, balance)
	for _, lr := range ComputeLotRemainders(rows) {
		if lr.Lot.ExpiresAt == nil || lr.Lot.ExpiresAt.After(now) {
			continue
		}
		processedLotIDs = append(processedLotIDs, lr.Lot.ID)
		if alreadyExpired[lr.Lot.ID] {
			continue
		}
		amount := RoundIdr(math.Min(lr.Remaining, bal))
		if amount <= 0 {
			continue
		}
		entries = append(entries, ExpirationDraft{LotID: lr.Lot.ID, Amount: amount, BalanceBefore: bal, BalanceAfter: RoundIdr(bal - amount)})
		bal = RoundIdr(bal - amount)
	}
	return entries, processedLotIDs
}

// ExpiringLot is a lot to remind the member about.
type ExpiringLot struct {
	LotID     string
	Remaining float64
	ExpiresAt time.Time
}

// SelectExpiryReminders picks lots expiring within withinDays that still
// hold credit and were not reminded yet.
func SelectExpiryReminders(rows []LedgerRow, now time.Time, withinDays int, reminded map[string]bool) []ExpiringLot {
	if withinDays <= 0 {
		return nil
	}
	horizon := now.Add(time.Duration(withinDays) * day)
	var out []ExpiringLot
	for _, lr := range ComputeLotRemainders(rows) {
		at := lr.Lot.ExpiresAt
		if at != nil && at.After(now) && !at.After(horizon) && lr.Remaining > 0 && !reminded[lr.Lot.ID] {
			out = append(out, ExpiringLot{LotID: lr.Lot.ID, Remaining: lr.Remaining, ExpiresAt: *at})
		}
	}
	return out
}

// ShouldNudgeLowBalance: the balance just dropped below the threshold
// (crossedAt), is still below it, and the member was not nudged in the last
// 7 days or since this drop.
func ShouldNudgeLowBalance(threshold, balance float64, crossedAt, lastNudgeAt *time.Time, now time.Time) bool {
	if threshold <= 0 || balance >= threshold || crossedAt == nil {
		return false
	}
	if lastNudgeAt == nil {
		return true
	}
	cooledDown := now.Sub(*lastNudgeAt) >= LowBalanceNudgeCooldownDays*day
	return cooledDown && crossedAt.After(*lastNudgeAt)
}

// ExpiresAtFor adds validity days to from; nil means no expiry.
func ExpiresAtFor(validityDays *float64, from time.Time) *time.Time {
	if validityDays == nil || !(*validityDays > 0) {
		return nil
	}
	t := from.Add(time.Duration(*validityDays * float64(day)))
	return &t
}
