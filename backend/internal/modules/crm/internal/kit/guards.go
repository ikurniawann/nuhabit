package kit

import (
	"errors"
	"net/http"
	"slices"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/scope"
)

// Gate is a CRM_GATES key in lib/crm/guards.ts.
type Gate string

// The CRM gates and the menu prefixes they accept.
const (
	GateSettings           Gate = "settings"
	GateEngagement         Gate = "engagement"
	GateCampaign           Gate = "campaign"
	GateSegments           Gate = "segments"
	GateInbox              Gate = "inbox"
	GateReports            Gate = "reports"
	GateOperator           Gate = "operator"
	GateReader             Gate = "reader"
	GateMemberRead         Gate = "memberRead"
	GateMemberLoyaltyWrite Gate = "memberLoyaltyWrite"
	GateMemberReviews      Gate = "memberReviews"
	GatePartners           Gate = "partners"
)

func join(groups ...[]string) []string {
	var out []string
	for _, g := range groups {
		out = append(out, g...)
	}
	return out
}

var gates = map[Gate][]string{
	GateSettings:           iam.CrmSettings,
	GateEngagement:         iam.CrmEngagement,
	GateCampaign:           iam.CrmPromo,
	GateSegments:           join(iam.CrmPromo, iam.Crm),
	GateInbox:              iam.CrmInbox,
	GateReports:            iam.CrmReports,
	GateOperator:           join(iam.CrmLoyalty, iam.CrmMembers, iam.PosOperations),
	GateReader:             join(iam.CrmReports, iam.CrmMembers, iam.CrmLoyalty),
	GateMemberRead:         join(iam.CrmMembers, iam.CrmLoyalty),
	GateMemberLoyaltyWrite: join(iam.CrmLoyalty, iam.CrmSettings),
	GateMemberReviews:      iam.CrmMemberReviews,
	GatePartners:           iam.CrmPartners,
}

// Guard resolves CRM callers.
type Guard struct {
	Auth *auth.Service
	DB   database.Querier
}

// Require mirrors requireCrmUser(gate).
func (g Guard) Require(r *http.Request, gate Gate) (*auth.User, error) {
	return g.Auth.RequireMenuPrefix(r, gates[gate]...)
}

// PosSession mirrors `if (!(await getPosSession())) throw ApiError.unauthorized()`:
// a missing session or a missing pos grant are both 401.
func (g Guard) PosSession(r *http.Request) (*auth.User, error) {
	u, err := g.Auth.RequireMenuPrefix(r, iam.Pos...)
	var he *httpx.Error
	if errors.As(err, &he) && (he.Status == http.StatusUnauthorized || he.Status == http.StatusForbidden) {
		return nil, httpx.Unauthorized("")
	}
	return u, err
}

// Scope is the user's business scope (lib/api/scope.ts UserScope).
type Scope = scope.Scope

// RequireScope mirrors requireCrmScope: the gate, then the user's scope.
func (g Guard) RequireScope(r *http.Request, gate Gate) (*auth.User, *Scope, error) {
	u, err := g.Require(r, gate)
	if err != nil {
		return nil, nil, err
	}
	s, err := scope.Load(r.Context(), g.DB, u.ID)
	return u, s, err
}

// ScopedCompanyID mirrors scopedCompanyId: super_admin without a company
// scope writes NULL (global), everyone else their company.
func ScopedCompanyID(u *auth.User, s *Scope) *string {
	if u.Role == "super_admin" && (s == nil || s.CompanyID == nil) {
		return nil
	}
	if s == nil {
		return nil
	}
	return s.CompanyID
}

// RoleIn reports whether role is one of roles.
func RoleIn(role string, roles ...string) bool { return slices.Contains(roles, role) }
