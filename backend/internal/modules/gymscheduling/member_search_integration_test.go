package gymscheduling

import (
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// Staff member search counts strikes under the rules of the session's
// branch (or the branch asked for), as booking into that session does.
func TestMemberSearchStrikesUseTheBranchRules(t *testing.T) {
	f := newFixture(t)
	org := testutil.CreateOrg(t, f.tx)
	f.rules(`{"strikeLimit": 3, "strikeWindowDays": 30, "strikeSuspendDays": 7}`)
	f.exec(`INSERT INTO gym.business_rules (branch_id, rules) VALUES ($1, '{"strikeLimit": 1}')`, org.BranchID)
	typeID, _ := f.classType(1)
	past := f.session(typeID, time.Now().Add(-48*time.Hour).Truncate(time.Minute), 5)
	m := f.member(0)
	f.exec(`INSERT INTO gym.bookings (session_id, customer_id, status, pass_strike, pass_strike_at)
		VALUES ($1, $2, 'no_show', true, now() - interval '1 day')`, past, m)
	phone := strings.TrimPrefix(f.scalar(`SELECT phone FROM pos.pos_customers WHERE id = $1`, m), "+")
	search := func(query string) map[string]any {
		t.Helper()
		hits := f.asStaff("GET", "/api/gym/bookings/members?q="+phone+query, nil).list()
		if len(hits) != 1 {
			t.Fatalf("search %q: %v", query, hits)
		}
		return hits[0].(map[string]any)
	}

	global := search("")
	if global["pass_strikes"] != 1.0 || global["suspended_until"] != nil || global["rules_branch_id"] != nil {
		t.Fatalf("global rules: %v", global)
	}
	branch := search("&branch_id=" + org.BranchID)
	if branch["suspended_until"] == nil || branch["rules_branch_id"] != org.BranchID || branch["rules_branch_name"] == nil {
		t.Fatalf("branch rules: %v", branch)
	}
	res := f.asStaff("POST", "/api/gym/sessions", map[string]any{
		"class_type_id": typeID, "branch_id": org.BranchID, "starts_at": time.Now().Add(72 * time.Hour).Truncate(time.Minute).Format(time.RFC3339),
	})
	if res.Status != 200 {
		t.Fatalf("create session: %s", res.Raw)
	}
	roster := search("&session_id=" + res.data()["id"].(string))
	if roster["suspended_until"] == nil || roster["rules_branch_id"] != org.BranchID {
		t.Fatalf("session branch rules: %v", roster)
	}
}
