// Package domain holds the pure gym credit rules (port of
// frontend/src/lib/gym/credits.ts and rules.ts): no database, no HTTP.
//
//   - The balance is always derived from the ledger, SUM(amount), never stored.
//   - A lot is one batch of credits with an expiry date. Credits enter a lot
//     through top_up, bonus or a positive adjustment.
//   - Usage (class_deduction, negative adjustment) is a shared pool allocated
//     FIFO to the lot that expires first. Class refunds and positive reversals
//     give credits back to that pool.
//   - Negative entries that point at a lot (expiration, top-up reversal) cut
//     that lot directly instead of the pool.
package domain

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// EntryType is a credit ledger entry type (CHECK constraint on gym.credit_ledger).
type EntryType string

const (
	TopUp          EntryType = "top_up"
	ClassDeduction EntryType = "class_deduction"
	Refund         EntryType = "refund"
	Bonus          EntryType = "bonus"
	Expiration     EntryType = "expiration"
	Adjustment     EntryType = "adjustment"
	Reversal       EntryType = "reversal"
)

// Entry is one ledger row. Empty LotID / SourceType / SourceID mean NULL.
type Entry struct {
	ID              string
	Type            EntryType
	Amount          int
	LotID           string
	ReversesEntryID string
	SourceType      string
	SourceID        string
	CreatedAt       time.Time
}

// Lot is one batch of credits. Empty PackageID means a bonus or adjustment lot.
type Lot struct {
	ID        string
	PackageID string
	Credits   int
	ExpiresAt time.Time
	CreatedAt time.Time
}

// LotRemainder is a lot with the credits still left in it.
type LotRemainder struct {
	Lot       Lot
	Remaining int
}

const day = 24 * time.Hour

// Balance sums the signed amounts.
func Balance(entries []Entry) int {
	sum := 0
	for _, e := range entries {
		sum += e.Amount
	}
	return sum
}

// LotExpiry is from + validityDays whole days.
func LotExpiry(from time.Time, validityDays int) time.Time {
	return from.Add(time.Duration(validityDays) * day)
}

// isPinnedDebit: a negative entry cut directly from its lot, not the FIFO pool.
func isPinnedDebit(e Entry) bool {
	return e.Amount < 0 && e.LotID != "" && (e.Type == Expiration || e.Type == Reversal)
}

// createsLot: a positive entry that owns its lot (does not refill the pool).
func createsLot(e Entry) bool { return e.Amount > 0 && e.LotID != "" }

// LotRemainders returns the credits left per lot, earliest expiry first. Pool
// usage is allocated FIFO; pinned debits come off their own lot first.
func LotRemainders(lots []Lot, entries []Entry) []LotRemainder {
	sorted := append([]Lot(nil), lots...)
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if !a.ExpiresAt.Equal(b.ExpiresAt) {
			return a.ExpiresAt.Before(b.ExpiresAt)
		}
		return a.CreatedAt.Before(b.CreatedAt)
	})

	pinned := map[string]int{}
	consumed := 0
	for _, e := range entries {
		switch {
		case isPinnedDebit(e):
			pinned[e.LotID] -= e.Amount
		case e.Amount < 0, !createsLot(e):
			consumed -= e.Amount
		}
	}
	consumed = max(0, consumed)

	out := make([]LotRemainder, 0, len(sorted))
	for _, lot := range sorted {
		available := max(0, lot.Credits-pinned[lot.ID])
		take := min(available, consumed)
		consumed -= take
		out = append(out, LotRemainder{Lot: lot, Remaining: available - take})
	}
	return out
}

// ExpirationDraft is an expiration entry to write for a lapsed lot.
type ExpirationDraft struct {
	Amount int
	LotID  string
	// IdempotencyKey stops two concurrent reads writing the same expiration twice.
	IdempotencyKey string
	Note           string
}

// ExpirationEntries drafts expirations for lots past their expiry that still
// have credits left.
func ExpirationEntries(lots []Lot, entries []Entry, now time.Time) []ExpirationDraft {
	prior := map[string]int{}
	for _, e := range entries {
		if e.Type == Expiration && e.LotID != "" {
			prior[e.LotID]++
		}
	}
	var drafts []ExpirationDraft
	for _, r := range LotRemainders(lots, entries) {
		if r.Remaining <= 0 || r.Lot.ExpiresAt.After(now) {
			continue
		}
		drafts = append(drafts, ExpirationDraft{
			Amount:         -r.Remaining,
			LotID:          r.Lot.ID,
			IdempotencyKey: fmt.Sprintf("gym-expire:%s:%d", r.Lot.ID, prior[r.Lot.ID]),
			Note:           fmt.Sprintf("%d kredit kedaluwarsa", r.Remaining),
		})
	}
	return drafts
}

// ExpiringLots are lots with credits left that expire within withinDays days.
func ExpiringLots(lots []Lot, entries []Entry, now time.Time, withinDays int) []LotRemainder {
	horizon := now.Add(time.Duration(withinDays) * day)
	out := []LotRemainder{}
	for _, r := range LotRemainders(lots, entries) {
		if r.Remaining > 0 && r.Lot.ExpiresAt.After(now) && !r.Lot.ExpiresAt.After(horizon) {
			out = append(out, r)
		}
	}
	return out
}

// CoveredClassTypeIDs lists the class types the member's live credits may
// book; nil means unrestricted. A live lot without a package, or whose
// package has no restriction (nil coverage or unknown package), lifts it.
func CoveredClassTypeIDs(remainders []LotRemainder, coverage map[string][]string, now time.Time) []string {
	var covered []string
	seen := map[string]bool{}
	for _, r := range remainders {
		if r.Remaining <= 0 || !r.Lot.ExpiresAt.After(now) {
			continue
		}
		ids, ok := coverage[r.Lot.PackageID]
		if r.Lot.PackageID == "" || !ok || ids == nil {
			return nil
		}
		for _, id := range ids {
			if !seen[id] {
				seen[id] = true
				covered = append(covered, id)
			}
		}
	}
	return covered
}

// IsClassTypeCovered reports whether classTypeID is bookable under covered.
func IsClassTypeCovered(covered []string, classTypeID string) bool {
	if covered == nil {
		return true
	}
	for _, id := range covered {
		if id == classTypeID {
			return true
		}
	}
	return false
}

/* ── Reversal ────────────────────────────────────────────────────────── */

// ReversalProblem is why an entry cannot be reversed.
type ReversalProblem string

const (
	CannotReverseReversal   ReversalProblem = "cannot_reverse_reversal"
	CannotReverseExpiration ReversalProblem = "cannot_reverse_expiration"
	AlreadyReversed         ReversalProblem = "already_reversed"
	InsufficientBalance     ReversalProblem = "insufficient_balance"
)

// ReversalProblemMessages are the user-facing messages per problem.
var ReversalProblemMessages = map[ReversalProblem]string{
	CannotReverseReversal:   "Entri pembatalan tidak bisa dibatalkan lagi.",
	CannotReverseExpiration: "Kredit yang sudah kedaluwarsa tidak bisa dikembalikan lewat pembatalan. Pakai penyesuaian.",
	AlreadyReversed:         "Entri ini sudah pernah dibatalkan.",
	InsufficientBalance:     "Saldo kredit member tidak cukup untuk membatalkan entri ini.",
}

// ReversalDraft is the reversing entry to write.
type ReversalDraft struct {
	Amount int
	// LotID is set when the original created a lot: the reversal cuts that lot.
	LotID           string
	ReversesEntryID string
	SourceType      string
	SourceID        string
	Note            string
}

// BuildReversal drafts the entry that reverses original, or names the problem.
func BuildReversal(original Entry, reason string, alreadyReversed bool, balance int) (ReversalDraft, ReversalProblem) {
	switch {
	case original.Type == Reversal:
		return ReversalDraft{}, CannotReverseReversal
	case original.Type == Expiration:
		return ReversalDraft{}, CannotReverseExpiration
	case alreadyReversed:
		return ReversalDraft{}, AlreadyReversed
	}
	amount := -original.Amount
	if balance+amount < 0 {
		return ReversalDraft{}, InsufficientBalance
	}
	draft := ReversalDraft{
		Amount:          amount,
		ReversesEntryID: original.ID,
		SourceType:      original.SourceType,
		SourceID:        original.SourceID,
		Note:            strings.TrimSpace(reason),
	}
	if createsLot(original) {
		draft.LotID = original.LotID
	}
	return draft, ""
}

/* ── Manual adjustment ───────────────────────────────────────────────── */

// MinReasonLength is the shortest accepted reason.
const MinReasonLength = 3

// ValidateAdjustment returns the problem message, or "" when allowed.
func ValidateAdjustment(amount int, reason string, balance int) string {
	switch {
	case amount == 0:
		return "Jumlah penyesuaian harus bilangan bulat dan tidak nol."
	case amount > 1000 || amount < -1000:
		return "Jumlah penyesuaian maksimal 1.000 kredit."
	case len([]rune(strings.TrimSpace(reason))) < MinReasonLength:
		return "Alasan penyesuaian wajib diisi."
	case balance+amount < 0:
		return "Saldo kredit tidak boleh minus."
	}
	return ""
}

/* ── Package purchase eligibility ────────────────────────────────────── */

// PurchasablePackage is the part of a package that decides eligibility.
type PurchasablePackage struct {
	ID     string
	Status string
	// PurchaseLimitPerMember nil means unlimited.
	PurchaseLimitPerMember *int
	// BranchID "" means sold at every branch.
	BranchID string
}

// PurchaseProblem is why a member cannot buy a package.
type PurchaseProblem string

const (
	PurchaseArchived       PurchaseProblem = "archived"
	PurchaseLimitReached   PurchaseProblem = "limit_reached"
	PurchaseBranchMismatch PurchaseProblem = "branch_mismatch"
	PurchaseMemberInactive PurchaseProblem = "member_inactive"
)

// PurchaseProblemMessages are the user-facing messages per problem.
var PurchaseProblemMessages = map[PurchaseProblem]string{
	PurchaseArchived:       "Paket ini sudah tidak dijual.",
	PurchaseLimitReached:   "Batas pembelian paket ini per member sudah tercapai.",
	PurchaseBranchMismatch: "Paket ini tidak dijual di cabang ini.",
	PurchaseMemberInactive: "Keanggotaan tidak aktif, tidak bisa membeli kredit.",
}

// CheckPackagePurchase returns the problem, or "" when the purchase is allowed.
// purchaseCount counts the member's paid or still-pending purchases of the
// package. branchID "" is a channel without a branch (the member portal).
func CheckPackagePurchase(pkg PurchasablePackage, purchaseCount int, memberActive bool, branchID string) PurchaseProblem {
	switch {
	case !memberActive:
		return PurchaseMemberInactive
	case pkg.Status != "active":
		return PurchaseArchived
	case pkg.BranchID != "" && branchID != "" && pkg.BranchID != branchID:
		return PurchaseBranchMismatch
	case pkg.PurchaseLimitPerMember != nil && purchaseCount >= *pkg.PurchaseLimitPerMember:
		return PurchaseLimitReached
	}
	return ""
}

// PurchaseTotal caps the discount at the price: total = price - discount.
// The discount is rounded half up like Math.round.
func PurchaseTotal(priceIdr, discountIdr float64) (discount, total float64) {
	discount = math.Min(math.Max(0, math.Floor(discountIdr+0.5)), priceIdr)
	return discount, priceIdr - discount
}
