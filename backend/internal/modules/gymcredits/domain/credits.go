// Package domain holds the pure gym credit rules (port of
// frontend/src/lib/gym/credits.ts and rules.ts): no database, no HTTP.
//
//   - The balance is always derived from the ledger, SUM(amount), never stored.
//   - A lot is one batch of credits with an expiry date. Credits enter a lot
//     through top_up, bonus or a positive adjustment.
//   - Every other entry that names a lot moves credits of that lot only:
//     class deductions record the lot they drew from, class refunds and
//     reversals give credits back to it, expirations and top-up reversals
//     cut it.
//   - Entries without a lot (negative adjustments, and deductions or refunds
//     written before deductions recorded their lot) form a shared pool
//     allocated FIFO to the lot that expires first.
package domain

import (
	"fmt"
	"math"
	"slices"
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

// createsLot: the positive entry that brought its lot into being (top_up,
// bonus, positive adjustment). The lot's credits already count it.
func createsLot(e Entry) bool {
	return e.Amount > 0 && e.LotID != "" && (e.Type == TopUp || e.Type == Bonus || e.Type == Adjustment)
}

// LotRemainders returns the credits left per lot, earliest expiry first.
// Entries pinned to a lot come off (or back onto) that lot; the pool is
// then allocated FIFO.
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
		case createsLot(e):
		case e.LotID != "":
			pinned[e.LotID] -= e.Amount
		default:
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

// RemainingIn is the credits left in lotID (0 when unknown).
func RemainingIn(remainders []LotRemainder, lotID string) int {
	for _, r := range remainders {
		if r.Lot.ID == lotID {
			return r.Remaining
		}
	}
	return 0
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

// PersonalOnly is the coverage entry that lists the personal training class
// types. Only lots whose package names such a type may pay for it: an
// unrestricted lot covers every class type except these.
const PersonalOnly = "personal"

// lotCoverage reports whether lot may pay for classTypeID and whether its
// package restricts it to a list of class types. A lot without a package,
// or whose package is unknown or has no list, is unrestricted.
func lotCoverage(lot Lot, coverage map[string][]string, classTypeID string) (covers, restricted bool) {
	ids, ok := coverage[lot.PackageID]
	if lot.PackageID == "" || !ok || ids == nil {
		return !slices.Contains(coverage[PersonalOnly], classTypeID), false
	}
	return slices.Contains(ids, classTypeID), true
}

// CoveredClassTypeIDs lists the class types the member's live credits may
// book; nil means unrestricted (some live lot is).
func CoveredClassTypeIDs(remainders []LotRemainder, coverage map[string][]string, now time.Time) []string {
	var covered []string
	seen := map[string]bool{}
	for _, r := range remainders {
		if r.Remaining <= 0 || !r.Lot.ExpiresAt.After(now) {
			continue
		}
		if _, restricted := lotCoverage(r.Lot, coverage, ""); !restricted {
			return nil
		}
		for _, id := range coverage[r.Lot.PackageID] {
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
	return covered == nil || slices.Contains(covered, classTypeID)
}

// Allocation is a number of credits drawn from, or given back to, one lot.
// An empty LotID is the shared pool.
type Allocation struct {
	LotID   string
	Credits int
}

// usableLots are the live lots with credits left that may pay for
// classTypeID, in the order a deduction draws them: lots restricted to a list
// that names the class, then unrestricted lots, each earliest expiry first.
// An empty classTypeID (class unknown) takes any live lot, earliest expiry
// first.
func usableLots(remainders []LotRemainder, coverage map[string][]string, classTypeID string, now time.Time) []LotRemainder {
	var restricted, open []LotRemainder
	for _, r := range remainders {
		if r.Remaining <= 0 || !r.Lot.ExpiresAt.After(now) {
			continue
		}
		if classTypeID == "" {
			open = append(open, r)
			continue
		}
		covers, isRestricted := lotCoverage(r.Lot, coverage, classTypeID)
		switch {
		case !covers:
		case isRestricted:
			restricted = append(restricted, r)
		default:
			open = append(open, r)
		}
	}
	return append(restricted, open...)
}

// UsableBalance is the credits that may pay for a class of classTypeID.
func UsableBalance(remainders []LotRemainder, coverage map[string][]string, classTypeID string, now time.Time) int {
	sum := 0
	for _, r := range usableLots(remainders, coverage, classTypeID, now) {
		sum += r.Remaining
	}
	return sum
}

// AllocateDeduction splits amount over the lots usable for classTypeID;
// ok=false when they hold less than amount.
func AllocateDeduction(remainders []LotRemainder, coverage map[string][]string, classTypeID string, amount int, now time.Time) ([]Allocation, bool) {
	var out []Allocation
	left := amount
	for _, r := range usableLots(remainders, coverage, classTypeID, now) {
		if left == 0 {
			break
		}
		take := min(r.Remaining, left)
		out = append(out, Allocation{LotID: r.Lot.ID, Credits: take})
		left -= take
	}
	return out, left == 0
}

// AllocateClassRefund gives amount back to the lots the class deductions of
// sourceID drew from, net of what refunds and reversals already returned,
// the last lot drawn first. A lot that has lapsed since gets its credits
// back too and expires again, as if they had never been used. What no lot
// can take (deductions written before they recorded their lot) goes to the
// pool.
func AllocateClassRefund(entries []Entry, sourceID string, amount int) []Allocation {
	drawn := map[string]int{}
	lotOf := map[string]string{}
	var order []string
	for _, e := range entries {
		if e.Type != ClassDeduction || e.LotID == "" || e.SourceID != sourceID {
			continue
		}
		if _, seen := drawn[e.LotID]; !seen {
			order = append(order, e.LotID)
		}
		drawn[e.LotID] -= e.Amount
		lotOf[e.ID] = e.LotID
	}
	for _, e := range entries {
		switch {
		case e.Type == Refund && e.LotID != "" && e.SourceID == sourceID:
			drawn[e.LotID] -= e.Amount
		case e.Type == Reversal && lotOf[e.ReversesEntryID] != "":
			drawn[lotOf[e.ReversesEntryID]] -= e.Amount
		}
	}
	var out []Allocation
	left := amount
	for i := len(order) - 1; i >= 0 && left > 0; i-- {
		if give := min(max(0, drawn[order[i]]), left); give > 0 {
			out = append(out, Allocation{LotID: order[i], Credits: give})
			left -= give
		}
	}
	if left > 0 {
		out = append(out, Allocation{Credits: left})
	}
	return out
}

/* ── Reversal ────────────────────────────────────────────────────────── */

// ReversalProblem is why an entry cannot be reversed.
type ReversalProblem string

const (
	CannotReverseReversal   ReversalProblem = "cannot_reverse_reversal"
	CannotReverseExpiration ReversalProblem = "cannot_reverse_expiration"
	AlreadyReversed         ReversalProblem = "already_reversed"
	InsufficientBalance     ReversalProblem = "insufficient_balance"
	LotPartlyUsed           ReversalProblem = "lot_partly_used"
	PurchaseTopUp           ReversalProblem = "purchase_top_up"
)

// ReversalProblemMessages are the user-facing messages per problem.
var ReversalProblemMessages = map[ReversalProblem]string{
	CannotReverseReversal:   "Entri pembatalan tidak bisa dibatalkan lagi.",
	CannotReverseExpiration: "Kredit yang sudah kedaluwarsa tidak bisa dikembalikan lewat pembatalan. Pakai penyesuaian.",
	AlreadyReversed:         "Entri ini sudah pernah dibatalkan.",
	InsufficientBalance:     "Saldo kredit member tidak cukup untuk membatalkan entri ini.",
	LotPartlyUsed:           "Sebagian kredit lot ini sudah terpakai atau kedaluwarsa.",
	PurchaseTopUp:           "Kredit dari pembelian dibatalkan lewat refund pembelian, agar uang dan kredit tetap cocok.",
}

// ReversalDraft is the reversing entry to write.
type ReversalDraft struct {
	Amount int
	// LotID is the original's lot: the reversal cuts it (bonus, adjustment,
	// refund) or gives credits back to it (deduction).
	LotID           string
	ReversesEntryID string
	SourceType      string
	SourceID        string
	Note            string
}

// BuildReversal drafts the entry that reverses original, or names the
// problem. lotRemaining is the credits left in the original's lot.
func BuildReversal(original Entry, reason string, alreadyReversed bool, balance, lotRemaining int) (ReversalDraft, ReversalProblem) {
	switch {
	case original.Type == Reversal:
		return ReversalDraft{}, CannotReverseReversal
	case original.Type == Expiration:
		return ReversalDraft{}, CannotReverseExpiration
	case original.Type == TopUp:
		return ReversalDraft{}, PurchaseTopUp
	case alreadyReversed:
		return ReversalDraft{}, AlreadyReversed
	}
	amount := -original.Amount
	if balance+amount < 0 {
		return ReversalDraft{}, InsufficientBalance
	}
	if original.LotID != "" && lotRemaining+amount < 0 {
		return ReversalDraft{}, LotPartlyUsed
	}
	return ReversalDraft{
		Amount:          amount,
		LotID:           original.LotID,
		ReversesEntryID: original.ID,
		SourceType:      original.SourceType,
		SourceID:        original.SourceID,
		Note:            strings.TrimSpace(reason),
	}, ""
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
	PurchaseBranchRequired: "Paket ini khusus satu cabang. Pilih cabang penjualan.",
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

// PurchaseBranchRequired: a front desk sale of a branch-only package names no branch.
const PurchaseBranchRequired PurchaseProblem = "branch_required"

// CheckFrontDeskSale is CheckPackagePurchase for a sale at the desk, which
// always sells at a branch: a branch-only package needs that branch named.
func CheckFrontDeskSale(pkg PurchasablePackage, purchaseCount int, memberActive bool, branchID string) PurchaseProblem {
	if problem := CheckPackagePurchase(pkg, purchaseCount, memberActive, branchID); problem != "" {
		return problem
	}
	if pkg.BranchID != "" && branchID == "" {
		return PurchaseBranchRequired
	}
	return ""
}

// PurchaseTotal caps the discount at the price: total = price - discount.
// The discount is rounded half up like Math.round.
func PurchaseTotal(priceIdr, discountIdr float64) (discount, total float64) {
	discount = math.Min(math.Max(0, math.Floor(discountIdr+0.5)), priceIdr)
	return discount, priceIdr - discount
}

// PurchaseRefundIdr is what refunding a credit purchase pays back: the
// share of totalIdr of the credits still unused, in whole rupiah. All
// credits unused returns totalIdr exactly.
func PurchaseRefundIdr(totalIdr float64, credits, unused int) float64 {
	switch {
	case credits <= 0 || unused <= 0:
		return 0
	case unused >= credits:
		return totalIdr
	}
	return math.Round(totalIdr * float64(unused) / float64(credits))
}
