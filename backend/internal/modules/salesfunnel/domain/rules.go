package domain

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/contracts/salesfunnel"
)

// Vocabularies of lib/sales-funnel/server.ts.
var (
	LeadOrgTypes     = []string{"corporate", "sekolah", "komunitas", "travel-agent", "pemerintah", "perorangan", "lainnya"}
	LeadSources      = salesfunnel.LeadSources
	LeadTemperatures = []string{"panas", "hangat", "dingin"}
	LeadStatuses     = []string{"baru", "dihubungi", "qualified", "tidak-cocok"}
	DealEventTypes   = []string{"gathering", "field-trip", "ulang-tahun", "buyout-venue", "lainnya"}
	ActivityTypes    = []string{"telepon", "wa", "meeting", "catatan", "tugas", "email"}
	// AccountTypes is ACCOUNT_TYPES (= LEAD_ORG_TYPES).
	AccountTypes = LeadOrgTypes
	// SalesFunnelRoles may own leads and deals.
	SalesFunnelRoles = []string{"super_admin", "sales"}
)

// Contains reports whether list holds s.
func Contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// NormalizePhone is normalizePhone: canonical 62… digits.
func NormalizePhone(raw string) string {
	var b strings.Builder
	for _, c := range raw {
		if c >= '0' && c <= '9' {
			b.WriteRune(c)
		}
	}
	digits := b.String()
	switch {
	case strings.HasPrefix(digits, "0"):
		return "62" + digits[1:]
	case strings.HasPrefix(digits, "8"):
		return "62" + digits
	}
	return digits
}

// IsValidNormalizedPhone is isValidNormalizedPhone.
func IsValidNormalizedPhone(phone string) bool {
	return len(phone) >= 10 && strings.HasPrefix(phone, "62")
}

// IsValidCalendarDate is isValidCalendarDate for "YYYY-MM-DD".
func IsValidCalendarDate(value string) bool {
	parts := strings.Split(value, "-")
	if len(parts) < 3 {
		return false
	}
	y, e1 := strconv.Atoi(parts[0])
	m, e2 := strconv.Atoi(parts[1])
	d, e3 := strconv.Atoi(parts[2])
	if e1 != nil || e2 != nil || e3 != nil {
		return false
	}
	t := time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC)
	return t.Year() == y && int(t.Month()) == m && t.Day() == d
}

var (
	waPlaceholder = regexp.MustCompile(`\{(pic|instansi|acara|tanggal_acara|venue)\}`)
	waSpaces      = regexp.MustCompile(`[ \t]{2,}`)
)

// RenderWaTemplate is renderWaTemplate: placeholders substituted (missing
// values empty), runs of spaces collapsed, trimmed.
func RenderWaTemplate(body string, values map[string]*string) string {
	out := waPlaceholder.ReplaceAllStringFunc(body, func(m string) string {
		if v := values[m[1:len(m)-1]]; v != nil {
			return *v
		}
		return ""
	})
	return JSTrim(waSpaces.ReplaceAllString(out, " "))
}

// Scope is the slice of UserScope the sales-funnel rules read.
type Scope struct {
	CompanyID     *string
	BranchID      *string
	BusinessScope *string
}

// IsBranch reports business_scope = 'branch' with a branch set.
func (s Scope) IsBranch() bool {
	return s.BusinessScope != nil && *s.BusinessScope == "branch" && s.BranchID != nil && *s.BranchID != ""
}

// HasCompany reports scope?.companyId being truthy.
func (s Scope) HasCompany() bool { return s.CompanyID != nil && *s.CompanyID != "" }

// HasCompanyScope is hasCompanyScope: fail-closed tenant isolation.
func HasCompanyScope(role string, s Scope) bool { return role == "super_admin" || s.HasCompany() }

// Venue is the company/branch/owner of a lead, deal, account, contact or task.
type Venue struct {
	CompanyID   string
	BranchID    string
	OwnerUserID *string
}

// RowForbidden is checkRowAccess's forbidden flag for an existing row.
func RowForbidden(userID, role string, s Scope, row Venue) bool {
	if !HasCompanyScope(role, s) {
		return true
	}
	if s.HasCompany() && row.CompanyID != *s.CompanyID {
		return true
	}
	if s.IsBranch() && row.BranchID != *s.BranchID {
		return true
	}
	return role == "sales" && row.OwnerUserID != nil && *row.OwnerUserID != userID
}

// ScopeConditions appends the list filters every sales-funnel list shares:
// company, branch, and own-or-unassigned for the sales role.
func ScopeConditions(w *Where, alias, userID, role string, s Scope) {
	if s.HasCompany() {
		w.Add(alias+".company_id = ?", *s.CompanyID)
	}
	if s.IsBranch() {
		w.Add(alias+".branch_id = ?", *s.BranchID)
	}
	if role == "sales" {
		w.Add("("+alias+".owner_user_id = ? OR "+alias+".owner_user_id IS NULL)", userID)
	}
}
