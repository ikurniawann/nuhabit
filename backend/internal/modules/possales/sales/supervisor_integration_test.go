package sales

import (
	"context"
	"testing"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/scope"
)

type supervisorList []ports.Supervisor

func (l supervisorList) ActiveSupervisors(context.Context, database.Querier) ([]ports.Supervisor, error) {
	return l, nil
}

// bcryptjsHash1234 is bcryptjs 3 hashSync("1234", 10), the $2b$ form the TS
// supervisor UI writes.
const bcryptjsHash1234 = "$2b$10$F/1F92QvVld8/fJik0SW.e/Kf1C77IQtxteyKRGsydBTJV3UPuddi"

// Approve (approveWithSupervisorPin) only accepts supervisors whose scope
// covers the cashier's branch, verifies bcryptjs hashes, and locks the
// cashier after five wrong PINs.
func TestSupervisorsApprove(t *testing.T) {
	e := setup(t)
	elsewhere, here := "Spv Cabang Lain", "Spv Cabang Ini"
	otherBranch := "00000000-0000-4000-8000-000000000001"
	branch := func(b string) *scope.Scope {
		role, level := "pos_supervisor", "branch"
		return scope.New("spv", &role, &level, nil, &e.fx.company, &b)
	}
	pins := NewSupervisors(e.tx, supervisorList{
		{ID: "spv-elsewhere", FullName: &elsewhere, PosPin: "4321", Scope: branch(otherBranch)},
		{ID: "spv-here", FullName: &here, PosPin: bcryptjsHash1234, Scope: branch(e.fx.branch)},
	}, nil)

	if a, err := pins.Approve(e.ctx, e.staff.UserID, "4321"); err != nil || a.Approver != nil || a.RetryMinutes != 0 {
		t.Fatalf("out-of-branch supervisor: %+v %v", a, err)
	}
	a, err := pins.Approve(e.ctx, e.staff.UserID, " 1234 ")
	if err != nil || a.Approver == nil || a.Approver.ID != "spv-here" || a.Approver.Name != here {
		t.Fatalf("bcryptjs PIN: %+v %v", a, err)
	}
	for i := 1; i <= 5; i++ {
		a, err = pins.Approve(e.ctx, e.staff.UserID, "0000")
		if err != nil || (i < 5) != (a.RetryMinutes == 0) {
			t.Fatalf("failure %d: %+v %v", i, a, err)
		}
	}
	if a, err = pins.Approve(e.ctx, e.staff.UserID, "1234"); err != nil || a.Approver != nil || a.RetryMinutes != 15 {
		t.Fatalf("locked: %+v %v", a, err)
	}
	if a, err = pins.Approve(e.ctx, "00000000-0000-4000-8000-0000000000ff", "1234"); err != nil || a.Approver != nil {
		t.Fatalf("caller without a profile: %+v %v", a, err)
	}
}
