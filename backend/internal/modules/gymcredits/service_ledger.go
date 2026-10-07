package gymcredits

import (
	"context"
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

// expireLapsedLots writes expiration entries for lapsed lots, then returns
// the current state.
func (s *Service) expireLapsedLots(ctx context.Context, q database.Querier, customerID string, now time.Time) (ledgerState, error) {
	state, err := s.loadState(ctx, q, customerID)
	if err != nil {
		return state, err
	}
	drafts := domain.ExpirationEntries(state.lots, state.entries, now)
	if len(drafts) == 0 {
		return state, nil
	}
	for _, d := range drafts {
		if _, err := s.repo.InsertEntry(ctx, q, NewEntry{
			CustomerID: customerID, Type: domain.Expiration, Amount: d.Amount, LotID: d.LotID,
			SourceType: "system", Note: d.Note, IdempotencyKey: d.IdempotencyKey,
		}); err != nil {
			return state, err
		}
	}
	return s.loadState(ctx, q, customerID)
}

// Balance is the ledger sum after lapsed credits are expired.
func (s *Service) Balance(ctx context.Context, q database.Querier, customerID string) (int, error) {
	state, err := s.expireLapsedLots(ctx, q, customerID, s.clock())
	return domain.Balance(state.entries), err
}

// CreditMove is a deduction or class refund from another context (booking).
type CreditMove struct {
	CustomerID     string
	Amount         int
	SourceType     string
	SourceID       string
	IdempotencyKey string
	Note           string
}

// Deduct takes credits for a booking. ok=false means insufficient balance.
// A repeated idempotency key returns ok with the current balance.
func (s *Service) Deduct(ctx context.Context, q database.Querier, in CreditMove) (ok bool, balanceAfter int, err error) {
	if in.Amount <= 0 {
		return false, 0, fail(http.StatusBadRequest, "Potongan kredit harus bilangan bulat positif")
	}
	if err := s.repo.LockMemberCredits(ctx, q, in.CustomerID); err != nil {
		return false, 0, err
	}
	state, err := s.expireLapsedLots(ctx, q, in.CustomerID, s.clock())
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
	if balance < in.Amount {
		return false, 0, nil
	}
	_, err = s.repo.InsertEntry(ctx, q, NewEntry{
		CustomerID: in.CustomerID, Type: domain.ClassDeduction, Amount: -in.Amount,
		SourceType: in.SourceType, SourceID: in.SourceID, Note: in.Note, IdempotencyKey: in.IdempotencyKey,
	})
	return err == nil, balance - in.Amount, err
}

// RefundClass gives credits back (cancelled booking). Idempotent by key.
func (s *Service) RefundClass(ctx context.Context, q database.Querier, in CreditMove) error {
	if in.Amount <= 0 {
		return fail(http.StatusBadRequest, "Refund kredit harus bilangan bulat positif")
	}
	if err := s.repo.LockMemberCredits(ctx, q, in.CustomerID); err != nil {
		return err
	}
	_, err := s.repo.InsertEntry(ctx, q, NewEntry{
		CustomerID: in.CustomerID, Type: domain.Refund, Amount: in.Amount,
		SourceType: in.SourceType, SourceID: in.SourceID, Note: in.Note, IdempotencyKey: in.IdempotencyKey,
	})
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
// with the default validity of the gym rules.
func (s *Service) Adjust(ctx context.Context, q database.Querier, customerID string, amount int, reason, actorID string) (*AdjustResult, error) {
	if err := s.repo.LockMemberCredits(ctx, q, customerID); err != nil {
		return nil, err
	}
	balance, err := s.Balance(ctx, q, customerID)
	if err != nil {
		return nil, err
	}
	if problem := domain.ValidateAdjustment(amount, reason, balance); problem != "" {
		return nil, fail(http.StatusBadRequest, problem)
	}
	note := strings.TrimSpace(reason)
	var entryID string
	if amount > 0 {
		rules, err := s.Rules(ctx, q, nil)
		if err != nil {
			return nil, err
		}
		entryID, _, err = s.GrantCredits(ctx, q, Grant{
			CustomerID: customerID, Type: domain.Adjustment, Credits: amount,
			ExpiresAt: domain.LotExpiry(s.clock(), rules.CreditExpiryDays), SourceType: "admin", Note: note, CreatedBy: actorID,
		})
		if err != nil {
			return nil, err
		}
	} else {
		entryID, err = s.repo.InsertEntry(ctx, q, NewEntry{
			CustomerID: customerID, Type: domain.Adjustment, Amount: amount, SourceType: "admin", Note: note, CreatedBy: actorID,
		})
		if err != nil {
			return nil, err
		}
	}
	return &AdjustResult{EntryID: entryID, BalanceAfter: balance + amount}, nil
}

// ReverseResult is the body of POST /api/gym/credits/reverse.
type ReverseResult struct {
	EntryID    string `json:"entryId"`
	CustomerID string `json:"customerId"`
	Amount     int    `json:"amount"`
}

// Reverse writes the entry that cancels entryID; the original never changes.
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
	balance, err := s.Balance(ctx, q, original.CustomerID)
	if err != nil {
		return nil, err
	}
	draft, problem := domain.BuildReversal(original.Entry, reason, reversed, balance)
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
	return &ReverseResult{EntryID: id, CustomerID: original.CustomerID, Amount: draft.Amount}, nil
}

// CoveredClassTypeIDs lists the class types the member's credits may book;
// nil means every class.
func (s *Service) CoveredClassTypeIDs(ctx context.Context, q database.Querier, customerID string) ([]string, error) {
	now := s.clock()
	state, err := s.expireLapsedLots(ctx, q, customerID, now)
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
	state, err := s.expireLapsedLots(ctx, q, customerID, now)
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
	passes, err := s.Passes(ctx, q, customerID)
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

// Passes lists the member's passes, newest active first, after lapsed
// ones are marked expired.
func (s *Service) Passes(ctx context.Context, q database.Querier, customerID string) ([]PassView, error) {
	now := s.clock()
	if err := s.repo.ExpireLapsedPasses(ctx, q, customerID, now); err != nil {
		return nil, err
	}
	rows, err := s.repo.Passes(ctx, q, customerID)
	if err != nil {
		return nil, err
	}
	out := make([]PassView, 0, len(rows))
	for _, p := range rows {
		out = append(out, passView(p, now))
	}
	return out, nil
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
