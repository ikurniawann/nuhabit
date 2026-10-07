// Package domain holds the pure rules behind staff accounts: business scope
// (lib/configuration/business-scope.ts), stall assignment
// (lib/users/stall-assignment.ts), roles and approval workflows
// (lib/admin/user-management.ts), the auth status of a ban, and temporary
// passwords.
package domain

import (
	"encoding/base64"
	"io"
	"time"

	"nuhabit/backend/internal/platform/validate"
)

// AdminUserRoles is ADMIN_USER_ROLES.
var AdminUserRoles = []string{
	"super_admin", "admin", "hrd", "hiring_manager", "direksi", "purchasing_admin",
	"purchasing_manager", "purchasing_staff", "finance_staff", "warehouse_staff",
	"warehouse_admin", "pos", "pos_supervisor", "qc_staff", "employee", "sales", "marketing",
}

// ApprovalModules, ApprovalWorkflows and ApprovalLevels are the enums of
// approvalPermissionSchema.
var (
	ApprovalModules   = []string{"purchasing", "inventory", "pos", "finance", "hris"}
	ApprovalWorkflows = []string{
		"purchase_request", "purchase_order", "goods_receipt", "inventory_adjustment",
		"pos_void", "pos_refund", "vendor_payment", "leave_request",
	}
	ApprovalLevels = []string{"checker", "approver", "final_approver"}
)

// workflowModule is APPROVAL_WORKFLOWS: the module each workflow belongs to.
var workflowModule = map[string]string{
	"purchase_request": "purchasing", "purchase_order": "purchasing", "goods_receipt": "purchasing",
	"inventory_adjustment": "inventory", "pos_void": "pos", "pos_refund": "pos",
	"vendor_payment": "finance", "leave_request": "hris",
}

// WorkflowMatchesModule is the approvalPermissionSchema refinement.
func WorkflowMatchesModule(workflow, module string) bool {
	m, ok := workflowModule[workflow]
	return ok && m == module
}

/* ── business scope ──────────────────────────────────────────────────── */

// Scope is BusinessScopeInput after normalizeBusinessScopePayload: every
// field is set (nil is null).
type Scope struct {
	BusinessScope, HoldingID, CompanyID, BranchID *string
}

// NormalizeScope is normalizeBusinessScopePayload.
func NormalizeScope(scope, holdingID, companyID, branchID *string) Scope {
	if scope == nil || *scope == "" {
		return Scope{}
	}
	s := *scope
	switch s {
	case "holding":
		return Scope{BusinessScope: &s, HoldingID: holdingID}
	case "company":
		return Scope{BusinessScope: &s, HoldingID: holdingID, CompanyID: companyID}
	}
	branch := "branch"
	return Scope{BusinessScope: &branch, HoldingID: holdingID, CompanyID: companyID, BranchID: branchID}
}

func empty(s *string) bool { return s == nil || *s == "" }

// ValidateScope is validateBusinessScope: "" when the scope is acceptable.
// role "" is an undefined role.
func ValidateScope(role string, isAccessApp bool, in Scope) string {
	if !isAccessApp || role == "" || role == "super_admin" {
		return ""
	}
	if empty(in.BusinessScope) {
		return "Data access scope is required for this role"
	}
	switch *in.BusinessScope {
	case "holding":
		if empty(in.HoldingID) {
			return "Holding is required"
		}
	case "company":
		if empty(in.HoldingID) || empty(in.CompanyID) {
			return "Holding and company are required"
		}
	case "branch":
		if empty(in.HoldingID) || empty(in.CompanyID) || empty(in.BranchID) {
			return "Holding, company, and branch are required"
		}
	}
	return ""
}

/* ── stall assignment ────────────────────────────────────────────────── */

// RequiresStallAssignment is requiresStallAssignment.
func RequiresStallAssignment(role string, businessScope *string, isAccessApp bool) bool {
	if !isAccessApp || role == "" || role == "super_admin" {
		return false
	}
	return businessScope != nil && *businessScope == "branch"
}

// DefaultWarehouseID is resolveDefaultWarehouseId: the trimmed explicit
// default, else the first non-empty id, else nil.
func DefaultWarehouseID(defaultID *string, ids []string) *string {
	if defaultID != nil {
		if explicit := validate.JSTrim(*defaultID); explicit != "" {
			return &explicit
		}
	}
	for _, id := range ids {
		if id != "" {
			return &id
		}
	}
	return nil
}

// SavedWarehouseIDs is resolveSavedWarehouseIds: only the default stall.
func SavedWarehouseIDs(defaultID *string) []string {
	if defaultID == nil {
		return []string{}
	}
	return []string{*defaultID}
}

/* ── accounts ────────────────────────────────────────────────────────── */

// AuthStatus is authStatus: "banned" while banned_until (PostgreSQL text
// output) lies in the future. Text new Date() cannot read counts as enabled.
func AuthStatus(bannedUntil *string, now time.Time) string {
	if bannedUntil == nil {
		return "enabled"
	}
	for _, layout := range []string{
		"2006-01-02 15:04:05.999999999-07",
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999-07:00:00",
	} {
		if t, err := time.Parse(layout, *bannedUntil); err == nil {
			if t.Truncate(time.Millisecond).After(now) {
				return "banned"
			}
			return "enabled"
		}
	}
	return "enabled"
}

// TempPassword is the temporary password of resetUserEmployeePassword:
// "Arkiv", 12 base64url characters of 9 random bytes, "!".
func TempPassword(random io.Reader) (string, error) {
	b := make([]byte, 9)
	if _, err := io.ReadFull(random, b); err != nil {
		return "", err
	}
	return "Arkiv" + base64.RawURLEncoding.EncodeToString(b)[:12] + "!", nil
}
