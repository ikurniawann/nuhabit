package gymcredits

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// Ledger operations run on the caller's transaction (q) so they compose with
// other writes, e.g. booking + deduction. The per-member advisory lock lasts
// until that transaction ends; it is what stops two concurrent deductions
// from both passing the balance check. The lock key matches the TS code, so
// both stacks serialize against each other during the migration.

type ledgerState struct {
	lots    []domain.Lot
	entries []domain.Entry
}

func (s *Service) loadState(ctx context.Context, q database.Querier, customerID string) (ledgerState, error) {
	lots, err := s.repo.Lots(ctx, q, customerID)
	if err != nil {
		return ledgerState{}, err
	}
	entries, err := s.repo.Entries(ctx, q, customerID)
	if err != nil {
		return ledgerState{}, err
	}
	return ledgerState{lots: lots, entries: entries}, nil
}

// expireLapsedLots writes expiration entries for lapsed lots (with their
// breakage journals), then returns the current state and how many it wrote.
func (s *Service) expireLapsedLots(ctx context.Context, q database.Querier, customerID string, now time.Time) (ledgerState, int, error) {
	state, err := s.loadState(ctx, q, customerID)
	if err != nil {
		return state, 0, err
	}
	drafts := domain.ExpirationEntries(state.lots, state.entries, now)
	if len(drafts) == 0 {
		return state, 0, nil
	}
	remainders := domain.LotRemainders(state.lots, state.entries)
	moves := make([]lotMove, 0, len(drafts))
	for _, d := range drafts {
		id, err := s.repo.InsertEntry(ctx, q, NewEntry{
			CustomerID: customerID, Type: domain.Expiration, Amount: d.Amount, LotID: d.LotID,
			SourceType: "system", Note: d.Note, IdempotencyKey: d.IdempotencyKey,
		})
		if err != nil {
			return state, 0, err
		}
		moves = append(moves, lotMove{EntryID: id, LotID: d.LotID, Type: domain.Expiration, Amount: d.Amount,
			UsedBefore: domain.UsedIn(remainders, d.LotID)})
	}
	if err := s.publishLotJournals(ctx, q, moves, "", now); err != nil {
		return state, 0, err
	}
	state, err = s.loadState(ctx, q, customerID)
	return state, len(drafts), err
}

// Balance is the ledger sum after lapsed credits are expired.
func (s *Service) Balance(ctx context.Context, q database.Querier, customerID string) (int, error) {
	state, _, err := s.expireLapsedLots(ctx, q, customerID, s.clock())
	return domain.Balance(state.entries), err
}

// UsableBalance is the credits that may pay for a class of classTypeID
// (after lapsed credits are expired): lots restricted to other class types
// do not count. Booking checks it before reserving a seat.
func (s *Service) UsableBalance(ctx context.Context, q database.Querier, customerID, classTypeID string) (int, error) {
	now := s.clock()
	state, _, err := s.expireLapsedLots(ctx, q, customerID, now)
	if err != nil {
		return 0, err
	}
	coverage, err := s.repo.PackageCoverage(ctx, q)
	if err != nil {
		return 0, err
	}
	return domain.UsableBalance(domain.LotRemainders(state.lots, state.entries), coverage, classTypeID, now), nil
}

// CreditMove is a deduction or class refund from another context (booking).
// ClassTypeID is the class the credits pay for; when empty, a SourceID that
// is a booking supplies it.
type CreditMove struct {
	CustomerID     string
	Amount         int
	ClassTypeID    string
	SourceType     string
	SourceID       string
	IdempotencyKey string
	Note           string
	CreatedBy      string
}

// classTypeOf is the class type a move pays for, "" when unknown.
func (s *Service) classTypeOf(ctx context.Context, q database.Querier, in CreditMove) (string, error) {
	if in.ClassTypeID != "" || in.SourceID == "" {
		return in.ClassTypeID, nil
	}
	return s.ports.Directory.BookingClassType(ctx, q, in.SourceID)
}

// splitKey is the idempotency key of the i-th entry of a move split over
// lots: the first keeps the move's key.
func splitKey(key string, i int) string {
	if key == "" || i == 0 {
		return key
	}
	return fmt.Sprintf("%s#%d", key, i+1)
}

// Deduct takes credits for a booking from the lots that cover its class
// type, one entry per lot. ok=false means those lots hold too few credits.
// A repeated idempotency key returns ok with the current balance.
func (s *Service) Deduct(ctx context.Context, q database.Querier, in CreditMove) (ok bool, balanceAfter int, err error) {
	if in.Amount <= 0 {
		return false, 0, fail(http.StatusBadRequest, "Potongan kredit harus bilangan bulat positif")
	}
	if err := s.repo.LockMemberCredits(ctx, q, in.CustomerID); err != nil {
		return false, 0, err
	}
	now := s.clock()
	state, _, err := s.expireLapsedLots(ctx, q, in.CustomerID, now)
	if err != nil {
		return false, 0, err
	}
	balance := domain.Balance(state.entries)
	existing, err := s.repo.EntryIDByKey(ctx, q, in.IdempotencyKey)
	if err != nil {
		return false, 0, err
	}
	if existing != "" {
		return true, balance, nil
	}
	classTypeID, err := s.classTypeOf(ctx, q, in)
	if err != nil {
		return false, 0, err
	}
	coverage, err := s.repo.PackageCoverage(ctx, q)
	if err != nil {
		return false, 0, err
	}
	remainders := domain.LotRemainders(state.lots, state.entries)
	allocations, enough := domain.AllocateDeduction(remainders, coverage, classTypeID, in.Amount, now)
	if !enough {
		return false, 0, nil
	}
	moves, err := s.writeMoves(ctx, q, in, domain.ClassDeduction, -1, allocations, remainders)
	if err != nil {
		return false, 0, err
	}
	return true, balance - in.Amount, s.publishLotJournals(ctx, q, moves, "", now)
}

// writeMoves writes one entry of type t per allocation, sign giving the
// direction, and returns them as lot moves valued against remainders, the
// lots as they were before the entries.
func (s *Service) writeMoves(ctx context.Context, q database.Querier, in CreditMove, t domain.EntryType, sign int, allocations []domain.Allocation, remainders []domain.LotRemainder) ([]lotMove, error) {
	moves := make([]lotMove, 0, len(allocations))
	for i, a := range allocations {
		id, err := s.repo.InsertEntry(ctx, q, NewEntry{
			CustomerID: in.CustomerID, Type: t, Amount: sign * a.Credits, LotID: a.LotID,
			SourceType: in.SourceType, SourceID: in.SourceID, Note: in.Note, IdempotencyKey: splitKey(in.IdempotencyKey, i),
			CreatedBy: in.CreatedBy,
		})
		if err != nil {
			return nil, err
		}
		moves = append(moves, lotMove{EntryID: id, LotID: a.LotID, Type: t, Amount: sign * a.Credits,
			UsedBefore: domain.UsedIn(remainders, a.LotID)})
	}
	return moves, nil
}

// RefundClass gives credits back (cancelled booking) to the lots the
// booking's deductions drew from. Credits returned to a lot that has lapsed
// since expire again at once. Idempotent by key.
func (s *Service) RefundClass(ctx context.Context, q database.Querier, in CreditMove) error {
	if in.Amount <= 0 {
		return fail(http.StatusBadRequest, "Refund kredit harus bilangan bulat positif")
	}
	if err := s.repo.LockMemberCredits(ctx, q, in.CustomerID); err != nil {
		return err
	}
	existing, err := s.repo.EntryIDByKey(ctx, q, in.IdempotencyKey)
	if err != nil || existing != "" {
		return err
	}
	state, err := s.loadState(ctx, q, in.CustomerID)
	if err != nil {
		return err
	}
	moves, err := s.writeMoves(ctx, q, in, domain.Refund, 1, domain.AllocateClassRefund(state.entries, in.SourceID, in.Amount),
		domain.LotRemainders(state.lots, state.entries))
	if err != nil {
		return err
	}
	now := s.clock()
	if err := s.publishLotJournals(ctx, q, moves, "", now); err != nil {
		return err
	}
	_, _, err = s.expireLapsedLots(ctx, q, in.CustomerID, now)
	return err
}

// Grant is a new batch of credits with its lot (purchase top_up, bonus,
// positive adjustment). Empty strings are NULL.
type Grant struct {
	CustomerID     string
	Type           domain.EntryType
	Credits        int
	ExpiresAt      time.Time
	PackageID      string
	PurchaseID     string
	SourceType     string
	SourceID       string
	Note           string
	IdempotencyKey string
	CreatedBy      string
}

// GrantCredits writes the lot and its entry. A repeated idempotency key
// returns "" ids and no error.
func (s *Service) GrantCredits(ctx context.Context, q database.Querier, g Grant) (entryID, lotID string, err error) {
	if err := s.repo.LockMemberCredits(ctx, q, g.CustomerID); err != nil {
		return "", "", err
	}
	if g.IdempotencyKey != "" {
		existing, err := s.repo.EntryIDByKey(ctx, q, g.IdempotencyKey)
		if err != nil || existing != "" {
			return "", "", err
		}
	}
	lotID, err = s.repo.InsertLot(ctx, q, NewLot{
		CustomerID: g.CustomerID, PackageID: g.PackageID, PurchaseID: g.PurchaseID, Credits: g.Credits, ExpiresAt: g.ExpiresAt,
	})
	if err != nil {
		return "", "", err
	}
	entryID, err = s.repo.InsertEntry(ctx, q, NewEntry{
		CustomerID: g.CustomerID, Type: g.Type, Amount: g.Credits, LotID: lotID, SourceType: g.SourceType,
		SourceID: g.SourceID, Note: g.Note, IdempotencyKey: g.IdempotencyKey, CreatedBy: g.CreatedBy,
	})
	if err != nil {
		return "", "", err
	}
	if entryID == "" {
		return "", "", fail(http.StatusConflict, "Kredit sudah tercatat")
	}
	return entryID, lotID, nil
}

// AdjustResult is the body of POST /api/gym/credits/{customerId}/adjust.
type AdjustResult struct {
	EntryID      string `json:"entryId"`
	BalanceAfter int    `json:"balanceAfter"`
}

// Adjust is a manual staff correction. A positive amount becomes a new lot
// that expires by the gym rules of branchID (global when nil). A negative
// amount comes off the live lots earliest expiry first, like a deduction,
// and posts GYM_CREDIT_ADJUSTMENT at each lot's unit price.
func (s *Service) Adjust(ctx context.Context, q database.Querier, customerID string, amount int, reason, actorID string, branchID *string) (*AdjustResult, error) {
	if err := s.repo.LockMemberCredits(ctx, q, customerID); err != nil {
		return nil, err
	}
	now := s.clock()
	state, _, err := s.expireLapsedLots(ctx, q, customerID, now)
	if err != nil {
		return nil, err
	}
	balance := domain.Balance(state.entries)
	if problem := domain.ValidateAdjustment(amount, reason, balance); problem != "" {
		return nil, fail(http.StatusBadRequest, problem)
	}
	note := strings.TrimSpace(reason)
	if amount > 0 {
		rules, err := s.Rules(ctx, q, branchID)
		if err != nil {
			return nil, err
		}
		entryID, _, err := s.GrantCredits(ctx, q, Grant{
			CustomerID: customerID, Type: domain.Adjustment, Credits: amount,
			ExpiresAt: domain.LotExpiry(now, rules.CreditExpiryDays), SourceType: "admin", Note: note, CreatedBy: actorID,
		})
		if err != nil {
			return nil, err
		}
		return &AdjustResult{EntryID: entryID, BalanceAfter: balance + amount}, nil
	}
	coverage, err := s.repo.PackageCoverage(ctx, q)
	if err != nil {
		return nil, err
	}
	remainders := domain.LotRemainders(state.lots, state.entries)
	allocations, enough := domain.AllocateDeduction(remainders, coverage, "", -amount, now)
	if !enough {
		// Credits outside any live lot (a legacy pool): the entry stays unpinned.
		allocations = []domain.Allocation{{Credits: -amount}}
	}
	moves, err := s.writeMoves(ctx, q, CreditMove{CustomerID: customerID, SourceType: "admin", Note: note, CreatedBy: actorID},
		domain.Adjustment, -1, allocations, remainders)
	if err != nil {
		return nil, err
	}
	if err := s.publishLotJournals(ctx, q, moves, actorID, now); err != nil {
		return nil, err
	}
	return &AdjustResult{EntryID: moves[0].EntryID, BalanceAfter: balance + amount}, nil
}

// ReverseResult is the body of POST /api/gym/credits/reverse.
type ReverseResult struct {
	EntryID    string `json:"entryId"`
	CustomerID string `json:"customerId"`
	Amount     int    `json:"amount"`
}

// Reverse writes the entry that cancels entryID; the original never changes.
// A reversed deduction gives its credits back to the lot it drew from.
func (s *Service) Reverse(ctx context.Context, q database.Querier, entryID, reason, actorID string) (*ReverseResult, error) {
	if len([]rune(strings.TrimSpace(reason))) < domain.MinReasonLength {
		return nil, fail(http.StatusBadRequest, "Alasan pembatalan wajib diisi")
	}
	original, err := s.repo.Entry(ctx, q, entryID)
	if err != nil {
		return nil, err
	}
	if original == nil {
		return nil, fail(http.StatusNotFound, "Entri kredit tidak ditemukan")
	}
	if err := s.repo.LockMemberCredits(ctx, q, original.CustomerID); err != nil {
		return nil, err
	}
	reversed, err := s.repo.IsReversed(ctx, q, original.ID)
	if err != nil {
		return nil, err
	}
	now := s.clock()
	state, _, err := s.expireLapsedLots(ctx, q, original.CustomerID, now)
	if err != nil {
		return nil, err
	}
	remainders := domain.LotRemainders(state.lots, state.entries)
	lotRemaining := domain.RemainingIn(remainders, original.LotID)
	draft, problem := domain.BuildReversal(original.Entry, reason, reversed, domain.Balance(state.entries), lotRemaining)
	if problem != "" {
		return nil, fail(http.StatusConflict, domain.ReversalProblemMessages[problem])
	}
	id, err := s.repo.InsertEntry(ctx, q, NewEntry{
		CustomerID: original.CustomerID, Type: domain.Reversal, Amount: draft.Amount, LotID: draft.LotID,
		SourceType: draft.SourceType, SourceID: draft.SourceID, ReversesEntryID: draft.ReversesEntryID,
		Note: draft.Note, CreatedBy: actorID,
	})
	if err != nil {
		return nil, err
	}
	move := lotMove{EntryID: id, LotID: draft.LotID, Type: domain.Reversal, Amount: draft.Amount, UsedBefore: domain.UsedIn(remainders, draft.LotID)}
	if err := s.publishLotJournals(ctx, q, []lotMove{move}, actorID, now); err != nil {
		return nil, err
	}
	return &ReverseResult{EntryID: id, CustomerID: original.CustomerID, Amount: draft.Amount}, nil
}

// CoveredClassTypeIDs lists the class types the member's credits may book;
// nil means every class.
func (s *Service) CoveredClassTypeIDs(ctx context.Context, q database.Querier, customerID string) ([]string, error) {
	now := s.clock()
	state, _, err := s.expireLapsedLots(ctx, q, customerID, now)
	if err != nil {
		return nil, err
	}
	coverage, err := s.repo.PackageCoverage(ctx, q)
	if err != nil {
		return nil, err
	}
	return domain.CoveredClassTypeIDs(domain.LotRemainders(state.lots, state.entries), coverage, now), nil
}

// Wallet is the balance, lots, credits expiring soon and the latest
// entryLimit entries (writing pending expirations first).
func (s *Service) Wallet(ctx context.Context, q database.Querier, customerID string, entryLimit int) (*WalletView, error) {
	now := s.clock()
	state, _, err := s.expireLapsedLots(ctx, q, customerID, now)
	if err != nil {
		return nil, err
	}
	rules, err := s.Rules(ctx, q, nil)
	if err != nil {
		return nil, err
	}
	names, err := s.repo.PackageNames(ctx, q)
	if err != nil {
		return nil, err
	}
	recent, err := s.repo.RecentEntries(ctx, q, customerID, entryLimit)
	if err != nil {
		return nil, err
	}
	staff, err := s.ports.Directory.StaffNames(ctx, q, recentCreators(recent))
	if err != nil {
		return nil, err
	}
	passes, freeze, err := s.passViews(ctx, q, customerID, rules)
	if err != nil {
		return nil, err
	}
	sent, err := s.repo.CreditsSentSince(ctx, q, customerID, monthStart(now))
	if err != nil {
		return nil, err
	}

	toView := func(r domain.LotRemainder) LotView {
		v := LotView{
			ID: r.Lot.ID, Credits: r.Lot.Credits, Remaining: r.Remaining,
			ExpiresAt: JSTime(r.Lot.ExpiresAt), CreatedAt: JSTime(r.Lot.CreatedAt), Expired: !r.Lot.ExpiresAt.After(now),
		}
		if r.Lot.PackageID != "" {
			pkg := r.Lot.PackageID
			v.PackageID = &pkg
			if name, ok := names[pkg]; ok {
				v.PackageName = &name
			}
		}
		return v
	}
	balance := domain.Balance(state.entries)
	view := &WalletView{
		Balance:             balance,
		ExpiryReminderDays:  rules.ExpiryReminderDays,
		LowBalance:          balance <= rules.LowBalanceThreshold,
		LowBalanceThreshold: rules.LowBalanceThreshold,
		Lots:                []LotView{},
		ExpiringLots:        []LotView{},
		Passes:              passes,
		Freeze:              freeze,
		Transfer:            TransferAllowance{MemberEnabled: rules.AllowMemberCreditTransfer, MonthlyCap: rules.MaxTransferCreditsPerMonth, SentThisMonth: sent},
		Entries:             make([]EntryView, 0, len(recent)),
	}
	for _, r := range domain.LotRemainders(state.lots, state.entries) {
		view.Lots = append(view.Lots, toView(r))
	}
	for _, r := range domain.ExpiringLots(state.lots, state.entries, now, rules.ExpiryReminderDays) {
		view.ExpiringCredits += r.Remaining
		view.ExpiringLots = append(view.ExpiringLots, toView(r))
	}
	for _, e := range recent {
		var createdByName *string
		if e.CreatedBy != nil {
			createdByName = staff[*e.CreatedBy]
		}
		view.Entries = append(view.Entries, EntryView{
			ID: e.ID, Type: e.Type, Amount: e.Amount, LotID: e.LotID, SourceType: e.SourceType, SourceID: e.SourceID,
			ReversesEntryID: e.ReversesEntryID, Reversed: e.Reversed, Note: e.Note, CreatedByName: createdByName,
			CreatedAt: JSTime(e.CreatedAt),
		})
	}
	return view, nil
}

// passViews lists the member's passes, live ones first in the order they
// run, and the freeze allowance under the rules of the branch the current
// pass was bought at.
func (s *Service) passViews(ctx context.Context, q database.Querier, customerID string, global domain.Rules) ([]PassView, domain.FreezeAllowance, error) {
	now := s.clock()
	rows, err := s.passRows(ctx, q, customerID, now)
	if err != nil {
		return nil, domain.FreezeAllowance{}, err
	}
	rules := global
	if len(rows) > 0 && isLive(&rows[0]) && rows[0].BranchID != nil {
		if rules, err = s.Rules(ctx, q, rows[0].BranchID); err != nil {
			return nil, domain.FreezeAllowance{}, err
		}
	}
	allowance, err := s.freezeAllowance(ctx, q, customerID, rules)
	if err != nil {
		return nil, allowance, err
	}
	out := make([]PassView, 0, len(rows))
	for _, p := range rows {
		out = append(out, passView(p, now))
	}
	return out, allowance, nil
}

// ActivePass is a pass that covers one instant (booking or check-in time).
type ActivePass struct {
	ID     string
	EndsAt time.Time
}

// ActivePassAt returns the member's pass covering at, nil when none. Other
// contexts (scheduling) call it on their own transaction.
func (s *Service) ActivePassAt(ctx context.Context, q database.Querier, customerID string, at time.Time) (*ActivePass, error) {
	row, err := s.repo.ActivePassAt(ctx, q, customerID, at)
	if err != nil || row == nil {
		return nil, err
	}
	return &ActivePass{ID: row.ID, EndsAt: row.EndsAt}, nil
}

func recentCreators(entries []RecentEntry) []string {
	var ids []string
	for _, e := range entries {
		if e.CreatedBy != nil {
			ids = append(ids, *e.CreatedBy)
		}
	}
	return ids
}

// Rules are the effective gym rules for a branch (global when nil).
func (s *Service) Rules(ctx context.Context, q database.Querier, branchID *string) (domain.Rules, error) {
	rows, err := s.repo.RulesFor(ctx, q, branchID)
	if err != nil {
		return domain.Rules{}, err
	}
	var global, branch any
	for _, row := range rows {
		switch {
		case row.BranchID == nil:
			global = row.Rules
		case branchID != nil && *row.BranchID == *branchID:
			branch = row.Rules
		}
	}
	return domain.ResolveRules(global, branch), nil
}
