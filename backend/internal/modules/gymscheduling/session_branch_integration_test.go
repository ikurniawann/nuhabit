package gymscheduling

import (
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// A session moves to another branch only while it has no booking; the move
// checks the new branch's rooms and takes its booking window rules.
func TestSessionBranchChange(t *testing.T) {
	f := newFixture(t)
	org := testutil.CreateOrg(t, f.tx)
	branchA := org.BranchID
	branchB := f.scalar(`INSERT INTO configuration.branches (company_id, code, name)
		VALUES ($1, 'GS' || substr(md5(random()::text), 1, 6), 'Go Sched B') RETURNING id::text`, org.CompanyID)
	f.exec(`INSERT INTO gym.business_rules (branch_id, rules) VALUES ($1, '{"bookingOpensDaysBefore": 2}')`, branchB)
	typeID, _ := f.classType(1)
	otherType, otherName := f.classType(1)
	room := "Go Room " + testutil.RandomHex(3)
	start := time.Date(2031, 5, 6, 9, 0, 0, 0, domain.WIB)
	create := func(classType, branch string) string {
		res := f.asStaff("POST", "/api/gym/sessions", map[string]any{
			"class_type_id": classType, "branch_id": branch, "area": room, "starts_at": start.Format(time.RFC3339),
		})
		if res.Status != 200 {
			t.Fatalf("create session: %s", res.Raw)
		}
		return res.data()["id"].(string)
	}
	// The same room name in two branches is two rooms.
	moving := create(typeID, branchA)
	create(otherType, branchB)

	expectError(t, f.asStaff("PATCH", "/api/gym/sessions/"+moving, map[string]any{"branch_id": branchB}), 409,
		"Area "+room+" sudah dipakai "+otherName+" pada Sel, 6 Mei, 09.00–10.00")
	if res := f.asStaff("PATCH", "/api/gym/sessions/"+moving, map[string]any{"branch_id": branchB, "area": "Go Studio 2"}); res.Status != 200 {
		t.Fatalf("move to branch B: %s", res.Raw)
	}
	var branch, opens string
	branch = f.scalar(`SELECT branch_id::text FROM gym.class_sessions WHERE id = $1`, moving)
	opens = f.scalar(`SELECT to_char(booking_opens_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') FROM gym.class_sessions WHERE id = $1`, moving)
	if branch != branchB || opens != "2031-05-04 09:00" {
		t.Fatalf("moved session: branch %s, booking opens %s", branch, opens)
	}

	m := f.member(3)
	f.exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, 'cancelled')`, moving, m)
	expectError(t, f.asStaff("PATCH", "/api/gym/sessions/"+moving, map[string]any{"branch_id": branchA}), 409,
		"Sesi ini sudah punya booking; cabang tidak bisa diubah")
	// Other edits still pass while the branch stays.
	if res := f.asStaff("PATCH", "/api/gym/sessions/"+moving, map[string]any{"branch_id": branchB, "notes": "pindah"}); res.Status != 200 {
		t.Fatalf("edit without a branch change: %s", res.Raw)
	}
}
