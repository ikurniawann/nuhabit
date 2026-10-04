// Package scope is frontend/src/lib/api/scope.ts: the business scope
// (holding, company or branch) of a signed-in staff user, and the rules that
// filter and check rows against it. Modules use it instead of reading
// configuration.users themselves.
package scope

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Scope is UserScope.
type Scope struct {
	UserID        string
	Role          *string
	BusinessScope *string // "holding" | "company" | "branch" | nil
	HoldingID     *string
	CompanyID     *string
	BranchID      *string
	// Unscoped is true for super_admin or a user without a business scope.
	Unscoped bool
}

// New applies getApiUserScope's isUnscoped rule.
func New(userID string, role, businessScope, holdingID, companyID, branchID *string) *Scope {
	return &Scope{
		UserID: userID, Role: role, BusinessScope: businessScope,
		HoldingID: holdingID, CompanyID: companyID, BranchID: branchID,
		Unscoped: (role != nil && *role == "super_admin") || empty(businessScope),
	}
}

// Load reads the user's scope from configuration.users. A user without a
// profile row gets an unscoped Scope with nil fields, as the TS does.
func Load(ctx context.Context, q database.Querier, userID string) (*Scope, error) {
	var role, level, holding, company, branch *string
	err := q.QueryRow(ctx, `
SELECT role::text, business_scope::text, holding_id::text, company_id::text, branch_id::text
  FROM configuration.users WHERE id = $1`, userID).Scan(&role, &level, &holding, &company, &branch)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return New(userID, role, level, holding, company, branch), nil
}

// Level is the business scope level, "" when none.
func (s *Scope) Level() string {
	if s == nil || s.BusinessScope == nil {
		return ""
	}
	return *s.BusinessScope
}

func empty(p *string) bool { return p == nil || *p == "" }

func eq(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// EffectiveCompanyID is effectiveCompanyId: the company a scoped user writes
// master data under; nil for unscoped users (global templates).
func EffectiveCompanyID(s *Scope) *string {
	if s == nil || s.Unscoped {
		return nil
	}
	return s.CompanyID
}

// EffectiveBranchID is effectiveBranchId: only branch-scoped users have one.
func EffectiveBranchID(s *Scope) *string {
	if s == nil || s.Unscoped || s.Level() != "branch" {
		return nil
	}
	return s.BranchID
}

// ImportBusinessIDs is importBusinessIds: CSV imports use the profile's
// company even for super_admin, and its branch only at branch level.
func ImportBusinessIDs(s *Scope) (companyID, branchID *string) {
	if s == nil {
		return nil, nil
	}
	if s.Level() == "branch" {
		branchID = s.BranchID
	}
	return s.CompanyID, branchID
}

// CompanyFilter is companyScopeOr: the company_id a list is restricted to
// (strict, no global templates), or nil for no filter.
func CompanyFilter(s *Scope) *string {
	if s == nil || s.Unscoped || s.Level() == "holding" || empty(s.CompanyID) {
		return nil
	}
	return s.CompanyID
}

// BranchFilter is branchScopeOr.
func BranchFilter(s *Scope) *string {
	if b := EffectiveBranchID(s); !empty(b) {
		return b
	}
	return nil
}

// RowInScope is isRowInBusinessScope, the strict master-data check.
func RowInScope(s *Scope, companyID, branchID *string) bool {
	if s == nil || s.Unscoped {
		return true
	}
	switch s.Level() {
	case "branch":
		return !empty(s.BranchID) && eq(branchID, s.BranchID) && !empty(s.CompanyID) && eq(companyID, s.CompanyID)
	case "company":
		return !empty(s.CompanyID) && eq(companyID, s.CompanyID)
	}
	return true
}

// OperationalRowInScope is isOperationalRowInBusinessScope: legacy documents
// with NULL company/branch inherit the user's scope instead of being hidden.
func OperationalRowInScope(s *Scope, companyID, branchID *string) bool {
	if s == nil || s.Unscoped {
		return true
	}
	switch s.Level() {
	case "branch":
		if !empty(s.CompanyID) && !empty(companyID) && *companyID != *s.CompanyID {
			return false
		}
		return empty(branchID) || empty(s.BranchID) || *branchID == *s.BranchID
	case "company":
		return empty(s.CompanyID) || empty(companyID) || *companyID == *s.CompanyID
	}
	return true
}

// WarehouseBranchFilter is resolveWarehouseBranchFilter: a branch-scoped user
// always sees their branch; others see the transaction's branch, if any.
func WarehouseBranchFilter(s *Scope, contextBranchID *string) *string {
	if s != nil && !s.Unscoped && s.Level() == "branch" && !empty(s.BranchID) {
		return s.BranchID
	}
	return contextBranchID
}

// WarehouseCompanyFilter is resolveWarehouseCompanyFilter.
func WarehouseCompanyFilter(s *Scope) *string {
	if s != nil && !s.Unscoped && s.Level() == "company" && !empty(s.CompanyID) {
		return s.CompanyID
	}
	return nil
}
