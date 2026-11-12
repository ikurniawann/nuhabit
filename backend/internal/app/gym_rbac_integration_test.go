package app

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Gym staff RBAC is per sub-module: a role granted one gym menu reaches the
// API its pages call and gets 403 on a sibling's API. Each case runs a
// representative route through the real modules and auth.
func TestGymSubModuleRBAC(t *testing.T) {
	org := testutil.CreateOrg(t, nil)
	d := testutil.Deps(t, nil)
	mux := http.NewServeMux()
	Mount(mux, d)

	all := []string{"read", "create", "update", "delete"}
	staff := map[string]testutil.Staff{}
	as := func(menu string) testutil.Staff {
		if s, ok := staff[menu]; ok {
			return s
		}
		s := testutil.CreateStaff(t, testutil.StaffOptions{Role: "pos", Menus: map[string][]string{menu: all}})
		staff[menu] = s
		return s
	}

	const (
		week   = "from=2031-03-03&to=2031-03-10"
		anyID  = "0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b"
		search = "q=zz"
	)
	cases := []struct {
		menu, method, path string
		allowed            bool
	}{
		// Scheduling: calendar, sessions, bookings, templates.
		{"gym.schedule", "GET", "/api/gym/sessions?" + week, true},
		{"gym.news", "GET", "/api/gym/sessions?" + week, false},
		{"gym.sessions", "GET", "/api/gym/sessions?" + week, true},
		{"gym.sessions", "GET", "/api/gym/bookings?" + week, false},
		{"gym.bookings", "GET", "/api/gym/bookings?" + week, true},
		{"gym.bookings", "GET", "/api/gym/bookings/members?" + search, false},
		{"gym.schedule.templates", "GET", "/api/gym/session-templates", true},
		{"gym.schedule", "GET", "/api/gym/session-templates", false},
		{"gym.class-types", "GET", "/api/gym/class-types", true},
		{"gym.coaches", "GET", "/api/gym/class-types", false},
		{"gym.coaches", "GET", "/api/gym/coaches", true},
		{"gym.coach-leave", "GET", "/api/gym/coaches", true},
		{"gym.schedule", "GET", "/api/gym/coaches/" + anyID + "/schedule", false},
		{"gym.gate-devices", "GET", "/api/gym/gate-devices", true},
		{"gym.gate-devices", "GET", "/api/gym/branches", true},
		{"gym.news", "GET", "/api/gym/branches", false},

		// Check-in: its own screen, plus the drop-in session list.
		{"gym.checkin", "GET", "/api/gym/checkin", true},
		{"gym.checkin", "GET", "/api/gym/sessions?" + week, true},
		{"gym.checkin", "GET", "/api/gym/checkin/log", true},
		{"gym.checkin", "GET", "/api/gym/bookings/members?" + search, true},
		{"gym.sessions", "GET", "/api/gym/checkin", false},
		{"gym.sessions", "GET", "/api/gym/checkin/log", false},
		{"gym.checkin", "GET", "/api/gym/open-gym-hours?branch_id=" + org.BranchID, false},

		// Members, reports, credits, packages, rules.
		{"gym.members", "GET", "/api/gym/members", true},
		{"gym.complaints", "GET", "/api/gym/members", true},
		{"gym.loyalty", "GET", "/api/gym/members", false},
		{"gym.reports", "GET", "/api/gym/reports/branches", true},
		{"gym.reports", "GET", "/api/gym/members", false},
		{"gym.credits", "GET", "/api/gym/credits?" + search, true},
		{"gym.packages", "GET", "/api/gym/credits?" + search, false},
		{"gym.packages", "GET", "/api/gym/packages", true},
		{"gym.rules", "GET", "/api/gym/packages", false},
		{"gym.rules", "GET", "/api/gym/rules", true},
		{"gym.rules", "GET", "/api/gym/open-gym-hours?branch_id=" + org.BranchID, true},
		{"gym.credits", "GET", "/api/gym/rules", false},

		// Coaching: PT and assessments.
		{"gym.pt", "GET", "/api/gym/pt/class-types", true},
		{"gym.assessments", "GET", "/api/gym/pt/class-types", false},
		{"gym.assessments", "GET", "/api/gym/pt/coaches", true},
		{"gym.assessments", "GET", "/api/gym/assessments", true},
		{"gym.pt", "GET", "/api/gym/assessments", false},

		// Care, SOP, complaints, loyalty, referrals, automation.
		{"gym.member-flags", "GET", "/api/gym/member-flags", true},
		{"gym.member-flags", "GET", "/api/gym/member-flag-types", true},
		{"gym.checkin", "GET", "/api/gym/member-flag-types", false},
		{"gym.checkin", "GET", "/api/gym/member-flags/members?customer_ids=" + anyID, true},
		{"gym.bookings", "GET", "/api/gym/member-flags/members?customer_ids=" + anyID, false},
		{"gym.sop", "GET", "/api/gym/sop", true},
		{"gym.complaints", "GET", "/api/gym/sop", false},
		{"gym.complaints", "GET", "/api/gym/complaints", true},
		{"gym.members", "GET", "/api/gym/complaints", false},
		{"gym.loyalty", "GET", "/api/gym/loyalty/tiers", true},
		{"gym.referrals", "GET", "/api/gym/loyalty/tiers", false},
		{"gym.referrals", "GET", "/api/gym/referrals/settings", true},
		{"gym.loyalty", "GET", "/api/gym/referrals/settings", false},
		{"gym.automation", "GET", "/api/gym/automation/jobs", true},
		{"gym.rules", "GET", "/api/gym/automation/jobs", false},

		// Coaches: Kelas Saya and the Program Director queue.
		{"gym.my-classes", "GET", "/api/gym/my-classes/sop", true},
		{"gym.coach-leave", "GET", "/api/gym/my-classes/sop", false},
		{"gym.coach-leave", "GET", "/api/gym/coach-leave/settings", true},
		{"gym.my-classes", "GET", "/api/gym/coach-leave/settings", false},

		// Training and incentives.
		{"gym.exercises", "GET", "/api/gym/exercises", true},
		{"gym.races", "GET", "/api/gym/exercises", false},
		{"gym.races", "GET", "/api/gym/races", true},
		{"gym.incentives", "GET", "/api/gym/races", false},
		{"gym.incentives", "GET", "/api/gym/incentives/payouts", true},
		{"gym.exercises", "GET", "/api/gym/incentives/payouts", false},
	}
	for _, c := range cases {
		rec, body := testutil.Do(t, mux, testutil.AsStaff(testutil.Request(c.method, c.path, nil), as(c.menu)))
		ok := rec.Code >= 200 && rec.Code < 300
		if c.allowed && !ok {
			t.Errorf("%s with %s: status %d (%v), want 2xx", c.path, c.menu, rec.Code, body["error"])
		}
		if !c.allowed && rec.Code != http.StatusForbidden {
			t.Errorf("%s with %s: status %d, want 403", c.path, c.menu, rec.Code)
		}
	}
}
