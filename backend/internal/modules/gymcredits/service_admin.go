package gymcredits

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

/* ── Package catalog ─────────────────────────────────────────────────── */

// PackagesView is GET /api/gym/packages.
type PackagesView struct {
	Packages   []PackageRow `json:"packages"`
	ClassTypes []ClassType  `json:"class_types"`
	Branches   []Branch     `json:"branches"`
}

// ListPackages returns every package (active first), the active class
// types offered as coverage and the active branches for per-branch prices.
func (s *Service) ListPackages(ctx context.Context) (*PackagesView, error) {
	packages, err := s.repo.Packages(ctx, s.db)
	if err != nil {
		return nil, err
	}
	var branchIDs []string
	for _, p := range packages {
		if p.BranchID != nil {
			branchIDs = append(branchIDs, *p.BranchID)
		}
	}
	names, err := s.ports.Directory.BranchNames(ctx, s.db, branchIDs)
	if err != nil {
		return nil, err
	}
	for i := range packages {
		if id := packages[i].BranchID; id != nil {
			if name, ok := names[*id]; ok {
				packages[i].BranchName = &name
			}
		}
	}
	classTypes, err := s.ports.Directory.ActiveClassTypes(ctx, s.db)
	if err != nil {
		return nil, err
	}
	branches, err := s.ports.Directory.ActiveBranches(ctx, s.db)
	if err != nil {
		return nil, err
	}
	if branches == nil {
		branches = []Branch{}
	}
	return &PackagesView{Packages: packages, ClassTypes: classTypes, Branches: branches}, nil
}

// IDResult is { id }.
type IDResult struct {
	ID string `json:"id"`
}

// SavePackage creates or updates a package and its branch prices. Earlier
// purchases keep the credits and price they were bought with.
func (s *Service) SavePackage(ctx context.Context, p PackageInput, actorID string) (*IDResult, error) {
	var id string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		if id, err = s.repo.SavePackage(ctx, tx, p, actorID); err != nil || id == "" {
			return err
		}
		return s.repo.ReplaceBranchPrices(ctx, tx, id, p.BranchPrices)
	})
	if err != nil {
		return nil, err
	}
	if id == "" {
		return nil, fail(http.StatusNotFound, "Paket tidak ditemukan")
	}
	return &IDResult{ID: id}, nil
}

// PublicPlans is the public price list for a branch (slug, code or id).
// Without a branch the base prices apply.
func (s *Service) PublicPlans(ctx context.Context, branchKey string) (*PublicPlansView, error) {
	var branch *PublicBranch
	var branchID *string
	if branchKey != "" {
		var err error
		if branch, err = s.ports.Directory.PublicBranch(ctx, s.db, branchKey); err != nil {
			return nil, err
		}
		if branch == nil {
			return nil, fail(http.StatusNotFound, "Cabang tidak ditemukan")
		}
		branchID = &branch.ID
	}
	plans, err := s.repo.PublicPackages(ctx, s.db, branchID)
	if err != nil {
		return nil, err
	}
	return &PublicPlansView{Branch: branch, Plans: plans}, nil
}

// PackageStatus is { id, status }.
type PackageStatus struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// SetPackageStatus archives (stops selling) or reactivates a package.
func (s *Service) SetPackageStatus(ctx context.Context, id, status string) (*PackageStatus, error) {
	row, err := s.repo.SetPackageStatus(ctx, s.db, id, status)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fail(http.StatusNotFound, "Paket tidak ditemukan")
	}
	return row, nil
}

// DeletePackage deletes a package never bought; one with history can only
// be archived so old records stay readable.
func (s *Service) DeletePackage(ctx context.Context, id string) error {
	deleted, exists, err := s.repo.DeleteUnusedPackage(ctx, s.db, id)
	switch {
	case err != nil:
		return err
	case deleted:
		return nil
	case exists:
		return fail(http.StatusConflict, "Paket sudah pernah dibeli. Arsipkan saja agar riwayat tetap utuh.")
	}
	return fail(http.StatusNotFound, "Paket tidak ditemukan")
}

/* ── Rules admin ─────────────────────────────────────────────────────── */

// BranchRules is one active branch and its override.
type BranchRules struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Override domain.RulesPatch `json:"override"`
}

// RulesAdminView is GET /api/gym/rules.
type RulesAdminView struct {
	Defaults domain.Rules  `json:"defaults"`
	Global   domain.Rules  `json:"global"`
	Branches []BranchRules `json:"branches"`
}

// RulesAdmin returns the defaults, the effective global rules and each
// active branch with its override.
func (s *Service) RulesAdmin(ctx context.Context) (*RulesAdminView, error) {
	rows, err := s.repo.AllRules(ctx, s.db)
	if err != nil {
		return nil, err
	}
	branches, err := s.ports.Directory.ActiveBranches(ctx, s.db)
	if err != nil {
		return nil, err
	}
	var global any
	byBranch := map[string]any{}
	for _, row := range rows {
		if row.BranchID == nil {
			global = row.Rules
		} else {
			byBranch[*row.BranchID] = row.Rules
		}
	}
	view := &RulesAdminView{Defaults: domain.RuleDefaults, Global: domain.ResolveRules(global, nil), Branches: []BranchRules{}}
	for _, b := range branches {
		view.Branches = append(view.Branches, BranchRules{ID: b.ID, Name: b.Name, Override: domain.SanitizeStoredRules(byBranch[b.ID])})
	}
	return view, nil
}

// SaveRules validates and stores rules. Without a branch it stores the full
// global rule set; with a branch only the override ({} = follow global).
// It returns the validation message, or "" when stored.
func (s *Service) SaveRules(ctx context.Context, branchID *string, input []domain.KV, actorID string) (string, error) {
	if branchID != nil {
		patch, msg := domain.ValidateRulesPatch(input)
		if msg != "" {
			return msg, nil
		}
		if patch.IsEmpty() {
			return "", s.repo.DeleteBranchRules(ctx, s.db, *branchID)
		}
		raw, err := json.Marshal(patch)
		if err != nil {
			return "", err
		}
		return "", s.repo.SaveBranchRules(ctx, s.db, *branchID, raw, actorID)
	}
	rules, msg := domain.ValidateRules(input)
	if msg != "" {
		return msg, nil
	}
	raw, err := json.Marshal(rules)
	if err != nil {
		return "", err
	}
	return "", s.repo.SaveGlobalRules(ctx, s.db, raw, actorID)
}

/* ── Staff credit desk ───────────────────────────────────────────────── */

// SearchMembers finds members (name/phone/email) with their credit balance.
// A term shorter than 2 characters lists the 20 members with the latest
// credit activity.
func (s *Service) SearchMembers(ctx context.Context, term string) ([]CreditMember, error) {
	var members []MemberSummary
	if len([]rune(term)) >= 2 {
		found, err := s.ports.Members.Search(ctx, s.db, term, 20)
		if err != nil {
			return nil, err
		}
		members = found
	} else {
		ids, err := s.repo.RecentlyActive(ctx, s.db, 20)
		if err != nil {
			return nil, err
		}
		found, err := s.ports.Members.ByIDs(ctx, s.db, ids)
		if err != nil {
			return nil, err
		}
		rank := map[string]int{}
		for i, id := range ids {
			rank[id] = i
		}
		sort.SliceStable(found, func(i, j int) bool { return rank[found[i].ID] < rank[found[j].ID] })
		members = found
	}
	ids := make([]string, len(members))
	for i, m := range members {
		ids[i] = m.ID
	}
	balances, err := s.repo.Balances(ctx, s.db, ids)
	if err != nil {
		return nil, err
	}
	out := make([]CreditMember, len(members))
	for i, m := range members {
		out[i] = CreditMember{MemberSummary: m, Balance: balances[m.ID]}
	}
	return out, nil
}

// MemberCredits is the staff credit page: profile, wallet and purchases.
func (s *Service) MemberCredits(ctx context.Context, customerID string) (*MemberCreditsView, error) {
	profile, err := s.ports.Members.Profile(ctx, s.db, customerID)
	if err != nil {
		return nil, err
	}
	if profile == nil {
		return nil, fail(http.StatusNotFound, "Member tidak ditemukan")
	}
	var wallet *WalletView
	if err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		wallet, err = s.Wallet(ctx, tx, customerID, 200)
		return err
	}); err != nil {
		return nil, err
	}
	purchases, err := s.repo.PurchasesOf(ctx, s.db, customerID, 50)
	if err != nil {
		return nil, err
	}
	return &MemberCreditsView{Member: profile, WalletView: *wallet, Purchases: purchases}, nil
}

// AdjustTx is Adjust in a new transaction.
func (s *Service) AdjustTx(ctx context.Context, customerID string, amount int, reason, actorID string) (res *AdjustResult, err error) {
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		res, err = s.Adjust(ctx, tx, customerID, amount, reason, actorID)
		return err
	})
	return res, err
}

// ReverseTx is Reverse in a new transaction.
func (s *Service) ReverseTx(ctx context.Context, entryID, reason, actorID string) (res *ReverseResult, err error) {
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		res, err = s.Reverse(ctx, tx, entryID, reason, actorID)
		return err
	})
	return res, err
}

// RefundPurchaseTx is RefundPurchase in a new transaction.
func (s *Service) RefundPurchaseTx(ctx context.Context, purchaseID, reason, actorID string) (res *Purchase, err error) {
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		res, err = s.RefundPurchase(ctx, tx, purchaseID, reason, actorID)
		return err
	})
	return res, err
}

// ArkCoinEnabled is the CRM switch that gates paying with ARK Coin.
func (s *Service) ArkCoinEnabled(ctx context.Context) bool {
	return s.ports.Wallet.Enabled(ctx, s.db)
}

/* ── Member portal ───────────────────────────────────────────────────── */

// MemberWallet is GET /api/member-portal/gym/credits: live lots only and no
// staff names.
func (s *Service) MemberWallet(ctx context.Context, customerID string) (*WalletView, error) {
	var wallet *WalletView
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		wallet, err = s.Wallet(ctx, tx, customerID, 50)
		return err
	})
	if err != nil {
		return nil, err
	}
	live := []LotView{}
	for _, lot := range wallet.Lots {
		if lot.Remaining > 0 && !lot.Expired {
			live = append(live, lot)
		}
	}
	wallet.Lots = live
	for i := range wallet.Entries {
		wallet.Entries[i].CreatedByName = nil
	}
	return wallet, nil
}

// PortalPackages lists packages for sale with per-member eligibility plus
// the ARK Coin balance for paying with it.
func (s *Service) PortalPackages(ctx context.Context, customerID string) (*PortalPackagesView, error) {
	packages, err := s.repo.ActivePackages(ctx, s.db)
	if err != nil {
		return nil, err
	}
	active, err := s.ports.Members.IsActive(ctx, s.db, customerID)
	if err != nil {
		return nil, err
	}
	balance, err := s.ports.Wallet.Balance(ctx, s.db, customerID)
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.LivePurchaseCounts(ctx, s.db, customerID)
	if err != nil {
		return nil, err
	}
	rate, err := s.ports.Wallet.Rate(ctx, s.db)
	if err != nil {
		return nil, err
	}
	view := &PortalPackagesView{
		Packages:      make([]PortalPackage, 0, len(packages)),
		ArkEnabled:    s.ports.Wallet.Enabled(ctx, s.db),
		ArkBalanceIdr: balance,
		ArkRate:       rate,
		CanSimulate:   s.canSimulate(),
	}
	for _, p := range packages {
		problem := domain.CheckPackagePurchase(domain.PurchasablePackage{
			ID: p.ID, Status: p.Status, PurchaseLimitPerMember: p.PurchaseLimitPerMember, BranchID: deref(p.BranchID),
		}, counts[p.ID], active, "")
		var reason *string
		if problem != "" {
			msg := domain.PurchaseProblemMessages[problem]
			reason = &msg
		}
		view.Packages = append(view.Packages, PortalPackage{
			ID: p.ID, Name: p.Name, Description: p.Description, Kind: p.Kind, Credits: p.Credits, PriceIdr: p.PriceIdr,
			ValidityDays: p.ValidityDays, PurchaseLimitPerMember: p.PurchaseLimitPerMember, Badge: p.Badge,
			Restricted: p.ApplicableClassTypeIDs != nil, CanBuy: problem == "", BlockedReason: reason,
		})
	}
	return view, nil
}
