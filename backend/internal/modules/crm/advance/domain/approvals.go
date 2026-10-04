package domain

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
