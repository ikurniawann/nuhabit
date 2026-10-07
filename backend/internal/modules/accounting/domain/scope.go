package domain

import "nuhabit/backend/internal/platform/scope"

// RecordScopeMessages are assertRecordInScope's messages; Global is set for
// mutations (a global record may only be changed by an unscoped user).
type RecordScopeMessages struct {
	NotFound, OutOfScope, Global string
}

// AssertRecordInScope is assertRecordInScope for a record with a company
// column (branch is always absent on accounting records).
func AssertRecordInScope(s *scope.Scope, found bool, companyID *string, m RecordScopeMessages) error {
	if !found {
		return &Rejection{Status: 404, Message: m.NotFound}
	}
	if m.Global != "" && companyID == nil && !s.Unscoped {
		return &Rejection{Status: 403, Message: m.Global}
	}
	if companyID != nil && !scope.RowInScope(s, companyID, nil) {
		return &Rejection{Status: 403, Message: m.OutOfScope}
	}
	return nil
}

// CompanyMissing is requireAccountingCompanyId's default message.
const CompanyMissing = "Akun Anda belum terikat company. Data accounting hanya tampil untuk company user yang login."

// RequireCompany is requireAccountingCompanyId.
func RequireCompany(s *scope.Scope, msg string) (string, error) {
	if s.CompanyID == nil || *s.CompanyID == "" {
		if msg == "" {
			msg = CompanyMissing
		}
		return "", &Rejection{Status: 400, Message: msg}
	}
	return *s.CompanyID, nil
}
