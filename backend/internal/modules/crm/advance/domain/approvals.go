package domain

import "slices"

// CanDecideStep mirrors canDecideStep in lib/crm/approvals.ts: the named
// user, or the role (super_admin may stand in for any role).
func CanDecideStep(approverRole, approverUserID *string, userID, role string) bool {
	if approverUserID != nil && *approverUserID != "" {
		return *approverUserID == userID
	}
	if approverRole != nil && *approverRole != "" {
		return *approverRole == role || role == "super_admin"
	}
	return false
}

// ApprovalRule is one active crm_approval_rules row.
type ApprovalRule struct {
	ID                           string
	Level                        int
	MinDiscount                  float64
	ApproverRole, ApproverUserID *string
}

// RequiredApprovalLevels mirrors requiredApprovalLevels: the rules whose bar
// the discount passes, one per level (the highest bar passed), by level.
func RequiredApprovalLevels(discount float64, rules []ApprovalRule) []ApprovalRule {
	byLevel := map[int]ApprovalRule{}
	for _, r := range rules {
		if !(discount > r.MinDiscount) {
			continue
		}
		if cur, ok := byLevel[r.Level]; !ok || r.MinDiscount > cur.MinDiscount {
			byLevel[r.Level] = r
		}
	}
	out := make([]ApprovalRule, 0, len(byLevel))
	for _, r := range byLevel {
		out = append(out, r)
	}
	slices.SortFunc(out, func(a, b ApprovalRule) int { return a.Level - b.Level })
	return out
}
