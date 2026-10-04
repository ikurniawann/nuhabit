package domain

// Scope is getApiUserScope: the signed-in user's business scope.
type Scope struct {
	UserID        string
	Role          *string
	BusinessScope *string
	HoldingID     *string
	CompanyID     *string
	BranchID      *string
}

// IsUnscoped is true for super_admin or a user without a business scope.
func (s Scope) IsUnscoped() bool {
	return (s.Role != nil && *s.Role == "super_admin") || s.BusinessScope == nil || *s.BusinessScope == ""
}

func eqPtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// InBusinessScope is isRowInBusinessScope.
func (s Scope) InBusinessScope(companyID, branchID *string) bool {
	if s.IsUnscoped() {
		return true
	}
	switch *s.BusinessScope {
	case "branch":
		if s.BranchID == nil || !eqPtr(branchID, s.BranchID) {
			return false
		}
		return s.CompanyID != nil && eqPtr(companyID, s.CompanyID)
	case "company":
		return s.CompanyID != nil && eqPtr(companyID, s.CompanyID)
	}
	return true
}

// RecordScopeMessages are assertRecordInScope's messages; Global is set for
// mutations (a global record may only be changed by an unscoped user).
type RecordScopeMessages struct {
	NotFound, OutOfScope, Global string
}

// AssertRecordInScope is assertRecordInScope for a record with a company
// column (branch is always absent on accounting records).
func (s Scope) AssertRecordInScope(found bool, companyID *string, m RecordScopeMessages) error {
	if !found {
		return &Rejection{Status: 404, Message: m.NotFound}
	}
	if m.Global != "" && companyID == nil && !s.IsUnscoped() {
		return &Rejection{Status: 403, Message: m.Global}
	}
	if companyID != nil && !s.InBusinessScope(companyID, nil) {
		return &Rejection{Status: 403, Message: m.OutOfScope}
	}
	return nil
}

// CompanyMissing is requireAccountingCompanyId's default message.
const CompanyMissing = "Akun Anda belum terikat company. Data accounting hanya tampil untuk company user yang login."

// RequireCompany is requireAccountingCompanyId.
func (s Scope) RequireCompany(msg string) (string, error) {
	if s.CompanyID == nil || *s.CompanyID == "" {
		if msg == "" {
			msg = CompanyMissing
		}
		return "", &Rejection{Status: 400, Message: msg}
	}
	return *s.CompanyID, nil
}
