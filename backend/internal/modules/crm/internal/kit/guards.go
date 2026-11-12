package kit

import (
	"net/http"
	"slices"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/scope"
)

// Gate names the menu codes a CRM route accepts: one CRM sub-module (a leaf
// menu) or, for a lookup several pages share, every leaf whose page calls it.
type Gate string

// The CRM gates.
const (
	GateDashboard         Gate = "dashboard"
	GateMemberList        Gate = "memberList"
	GateMemberLookup      Gate = "memberLookup"
	GateRewards           Gate = "rewards"
	GateRewardsRead       Gate = "rewardsRead"
	GateAvatars           Gate = "avatars"
	GateAvatarsRead       Gate = "avatarsRead"
	GateBadges            Gate = "badges"
	GateWallpapers        Gate = "wallpapers"
	GateCollectibleUpload Gate = "collectibleUpload"
	GateTiersRead         Gate = "tiersRead"
	GateSettings          Gate = "settings"
	GateApprovalRules     Gate = "approvalRules"
	GateApprovalInbox     Gate = "approvalInbox"
	GateWorkflows         Gate = "workflows"
	GateScoring           Gate = "scoring"
	GateCustomFields      Gate = "customFields"
	GateAnnouncements     Gate = "announcements"
	GateChallenges        Gate = "challenges"
	GateCheckins          Gate = "checkins"
	GateEvents            Gate = "events"
	GateInbox             Gate = "inbox"
	GateInboxAnalyze      Gate = "inboxAnalyze"
	GateReviews           Gate = "reviews"
	GateMemberReviews     Gate = "memberReviews"
	GatePartners          Gate = "partners"
	GateCampaigns         Gate = "campaigns"
	GateSegments          Gate = "segments"
	GateSegmentsRead      Gate = "segmentsRead"
	GateForms             Gate = "forms"
	GateReports           Gate = "reports"
	GateReportBuilder     Gate = "reportBuilder"
	GateReportRun         Gate = "reportRun"
	GateSavedReports      Gate = "savedReports"
	GateReportDashboards  Gate = "reportDashboards"
	GateReportSchedules   Gate = "reportSchedules"
	GateLoyaltyFeatures   Gate = "loyaltyFeatures"
)

var gates = map[Gate][]string{
	GateDashboard:         iam.CrmDashboard,
	GateMemberList:        iam.CrmMemberList,
	GateMemberLookup:      iam.CrmMemberLookup,
	GateRewards:           iam.CrmRewards,
	GateRewardsRead:       iam.CrmRewardsRead,
	GateAvatars:           iam.CrmAvatars,
	GateAvatarsRead:       iam.CrmAvatarsRead,
	GateBadges:            iam.CrmBadges,
	GateWallpapers:        iam.CrmWallpapers,
	GateCollectibleUpload: iam.CrmCollectibleUpload,
	GateTiersRead:         iam.CrmTiersRead,
	GateSettings:          iam.CrmSettingsConfig,
	GateApprovalRules:     iam.CrmApprovalRules,
	GateApprovalInbox:     iam.CrmApprovalInbox,
	GateWorkflows:         iam.CrmWorkflows,
	GateScoring:           iam.CrmScoring,
	GateCustomFields:      iam.CrmCustomFields,
	GateAnnouncements:     iam.CrmAnnouncements,
	GateChallenges:        iam.CrmChallenges,
	GateCheckins:          iam.CrmCheckins,
	GateEvents:            iam.CrmEvents,
	GateInbox:             iam.CrmInbox,
	GateInboxAnalyze:      iam.CrmInboxAnalyze,
	GateReviews:           iam.CrmReviews,
	GateMemberReviews:     iam.CrmMemberReviews,
	GatePartners:          iam.CrmPartners,
	GateCampaigns:         iam.CrmCampaigns,
	GateSegments:          iam.CrmSegments,
	GateSegmentsRead:      iam.CrmSegmentsRead,
	GateForms:             iam.CrmForms,
	GateReports:           iam.CrmReportsOverview,
	GateReportBuilder:     iam.CrmReportBuilder,
	GateReportRun:         iam.CrmReportRun,
	GateSavedReports:      iam.CrmSavedReports,
	GateReportDashboards:  iam.CrmReportDashboards,
	GateReportSchedules:   iam.CrmReportSchedules,
	// The cashier reads the loyalty feature switches.
	GateLoyaltyFeatures: iam.PosCashier,
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
