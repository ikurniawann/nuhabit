package gymscheduling

import (
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// The public timetable shows a branch's published sessions for one week,
// without a session cookie.
func TestPublicTimetable(t *testing.T) {
	f := newFixture(t)
	org := testutil.CreateOrg(t, f.tx)
	other := testutil.CreateOrg(t, f.tx)
	slug := "go-" + testutil.RandomHex(3)
	f.exec(`UPDATE configuration.branches SET slug = $2 WHERE id = $1`, org.BranchID, slug)
	classID, className := f.classType(1)
	nextMonday := domain.ShiftDays(mondayOf(time.Now()), 7)
	at := func(day int, hour int) time.Time {
		return domain.ShiftDays(nextMonday, day).Add(time.Duration(hour) * time.Hour)
	}
	create := func(branchID string, startsAt time.Time, publish bool) string {
		t.Helper()
		res := f.asStaff("POST", "/api/gym/sessions", map[string]any{
			"class_type_id": classID, "branch_id": branchID, "starts_at": startsAt.UTC().Format(time.RFC3339),
			"capacity": 2, "publish": publish,
		})
		if res.Status != 200 {
			t.Fatalf("create session: %d %s", res.Status, res.Raw)
		}
		return res.data()["id"].(string)
	}
	wednesday := create(org.BranchID, at(2, 7), true)
	monday := create(org.BranchID, at(0, 18), true)
	create(org.BranchID, at(3, 7), false)             // draft
	cancelled := create(org.BranchID, at(4, 7), true) // cancelled below
	create(other.BranchID, at(1, 7), true)            // another branch
	create(org.BranchID, at(7, 7), true)              // the week after
	f.exec(`UPDATE gym.class_sessions SET status = 'cancelled' WHERE id = $1`, cancelled)
	// Monday's two seats are taken: full, waitlist open.
	for range 2 {
		f.exec(`INSERT INTO gym.bookings (session_id, customer_id, status, source) VALUES ($1, $2, 'confirmed', 'admin')`, monday, f.member(5))
	}
	f.exec(`UPDATE gym.class_sessions SET status = 'full' WHERE id = $1`, monday)

	res := f.do("GET", "/api/public/site/sessions?branch="+strings.ToUpper(slug)+"&week="+nextMonday.Format("2006-01-02"), "", "", nil)
	if res.Status != 200 {
		t.Fatalf("%d %s", res.Status, res.Raw)
	}
	data := res.data()
	if data["week_start"] != nextMonday.Format("2006-01-02") || data["branch"].(map[string]any)["slug"] != slug {
		t.Fatalf("week/branch = %v", data)
	}
	sessions := data["sessions"].([]any)
	if len(sessions) != 2 {
		t.Fatalf("sessions = %d: %s", len(sessions), res.Raw)
	}
	first, second := sessions[0].(map[string]any), sessions[1].(map[string]any)
	if first["id"] != monday || first["seats_left"].(float64) != 0 || first["waitlist_open"] != true || first["capacity"].(float64) != 2 {
		t.Errorf("monday = %v", first)
	}
	if second["id"] != wednesday || second["seats_left"].(float64) != 2 || second["waitlist_open"] != false ||
		second["duration_min"].(float64) != 60 || second["class_type"].(map[string]any)["name"] != className || second["coach_name"] != nil {
		t.Errorf("wednesday = %v", second)
	}
	if !strings.Contains(res.Raw, `"starts_at":"`+at(0, 18).UTC().Format("2006-01-02T15:04:05.000Z")+`"`) {
		t.Errorf("starts_at: %s", res.Raw)
	}

	// Weeks are clamped: the past shows the current week, far ahead the last
	// allowed one; the week defaults to the current one.
	past := f.do("GET", "/api/public/site/sessions?branch="+slug+"&week="+domain.ShiftDays(nextMonday, -28).Format("2006-01-02"), "", "", nil)
	far := f.do("GET", "/api/public/site/sessions?branch="+slug+"&week="+domain.ShiftDays(nextMonday, 7*20).Format("2006-01-02"), "", "", nil)
	current := f.do("GET", "/api/public/site/sessions?branch="+slug, "", "", nil)
	thisMonday := mondayOf(time.Now()).Format("2006-01-02")
	if past.data()["week_start"] != thisMonday || current.data()["week_start"] != thisMonday ||
		far.data()["week_start"] != domain.ShiftDays(mondayOf(time.Now()), 56).Format("2006-01-02") {
		t.Errorf("clamp: %v %v %v", past.data()["week_start"], current.data()["week_start"], far.data()["week_start"])
	}

	for target, want := range map[string]string{
		"/api/public/site/sessions":                                           `{"success":false,"error":"Parameter branch wajib diisi"}`,
		"/api/public/site/sessions?branch=" + slug + "&week=2026-10-06":       `{"success":false,"error":"Parameter week harus tanggal Senin (YYYY-MM-DD)"}`,
		"/api/public/site/sessions?branch=" + slug + "&week=senin":            `{"success":false,"error":"Parameter week harus tanggal Senin (YYYY-MM-DD)"}`,
		"/api/public/site/sessions?branch=tidak-ada-" + testutil.RandomHex(2): `{"success":false,"error":"Cabang tidak ditemukan"}`,
	} {
		if res := f.do("GET", target, "", "", nil); strings.TrimSpace(res.Raw) != want {
			t.Errorf("%s = %d %s", target, res.Status, res.Raw)
		}
	}
}
