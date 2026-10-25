package domain

// Approver is a user who may decide coach leave.
type Approver struct {
	UserID  string `json:"user_id"`
	Name    string `json:"name"`
	OnLeave bool   `json:"on_leave"`
}

// ApproverSource names who decides right now.
type ApproverSource string

const (
	SourceDirector   ApproverSource = "program_director"
	SourceBackup     ApproverSource = "backup"
	SourceSuperAdmin ApproverSource = "super_admin"
)

// Approvers are the users who decide one coach's leave.
type Approvers struct {
	List   []Approver     `json:"approvers"`
	Source ApproverSource `json:"source"`
}

// ResolveApprovers: the Program Directors who are not on leave; without
// one, the backup approver when not on leave; without that, only a super
// admin. Nobody decides their own leave, so a Program Director who coaches
// is decided by another one or the backup.
func ResolveApprovers(directors []Approver, backup *Approver, requesterUserID string) Approvers {
	eligible := func(a Approver) bool { return !a.OnLeave && a.UserID != requesterUserID }
	var list []Approver
	for _, d := range directors {
		if eligible(d) {
			list = append(list, d)
		}
	}
	if len(list) > 0 {
		return Approvers{List: list, Source: SourceDirector}
	}
	if backup != nil && eligible(*backup) {
		return Approvers{List: []Approver{*backup}, Source: SourceBackup}
	}
	return Approvers{Source: SourceSuperAdmin}
}

// CanDecide: a super admin always may, like in other approvals, except on
// their own leave; anyone else must be one of the approvers.
func CanDecide(userID string, superAdmin bool, approvers Approvers, requesterUserID string) bool {
	if userID == requesterUserID {
		return false
	}
	if superAdmin {
		return true
	}
	for _, a := range approvers.List {
		if a.UserID == userID {
			return true
		}
	}
	return false
}
