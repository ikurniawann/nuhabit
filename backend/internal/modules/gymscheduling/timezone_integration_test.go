package gymscheduling

import (
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/testutil"
)

// A branch in Makassar (WITA, UTC+8) counts days, clocks and notification
// times in WITA, one hour ahead of Jakarta.

var wita = localtime.Zone("Asia/Makassar")

func (f *fixture) witaBranch() string {
	f.t.Helper()
	branch := testutil.CreateOrg(f.t, f.tx).BranchID
	f.exec(`UPDATE configuration.branches SET timezone = 'Asia/Makassar' WHERE id = $1`, branch)
	return branch
}

func (f *fixture) branchSession(classTypeID, branchID string, startsAt time.Time) string {
	f.t.Helper()
	res := f.asStaff("POST", "/api/gym/sessions", map[string]any{
		"class_type_id": classTypeID, "branch_id": branchID, "starts_at": startsAt.UTC().Format(time.RFC3339),
		"capacity": 5, "publish": true,
	})
	if res.Status != 200 {
		f.t.Fatalf("create session: %s", res.Raw)
	}
	return res.data()["id"].(string)
}

func TestWitaBranchDayCap(t *testing.T) {
	f := newFixture(t)
	f.setRules(map[string]any{"maxBookingsPerDay": 1, "maxConcurrentBookings": 0})
	branch := f.witaBranch()
	typeID, _ := f.classType(1)
	holder := f.member(0)
	f.passFor(holder, 30)

	// 00.30 and 10.00 WITA on the same WITA day; the first is still the
	// evening before in Jakarta (23.30 WIB), so only WITA puts them together.
	day := localtime.DayStart(time.Now(), wita).AddDate(0, 0, 2)
	night := f.branchSession(typeID, branch, day.Add(30*time.Minute))
	morning := f.branchSession(typeID, branch, day.Add(10*time.Hour))
	if res := f.book(holder, night); res.data()["status"] != "confirmed" {
		t.Fatalf("first class: %s", res.Raw)
	}
	expectError(t, f.book(holder, morning), 409, "Batas booking tercapai: maksimal 1 kelas per hari")

	// Sessions list the branch zone for the clients.
	listed := f.asStaff("GET", "/api/gym/sessions?branch_id="+branch, nil).list()
	for _, row := range listed {
		if row := row.(map[string]any); row["id"] == night && row["timezone"] != "Asia/Makassar" {
			t.Fatalf("session zone: %v", row)
		}
	}
}

func TestWitaBranchOpenGymDay(t *testing.T) {
	f := newFixture(t)
	f.setRules(map[string]any{"openGymEnabled": true, "openGymCreditCost": 1, "reEntryGraceMin": 0, "antiPassbackMin": 0})
	branch := f.witaBranch()
	m := f.member(5)

	// The latest 00.30 WITA (23.30 WIB the evening before) in the past.
	at := time.Now().UTC().Truncate(24 * time.Hour).Add(16*time.Hour + 30*time.Minute)
	if at.After(time.Now()) {
		at = at.AddDate(0, 0, -1)
	}
	// An open gym entry an hour earlier: the same WIB day, the WITA day before.
	f.exec(`INSERT INTO gym.access_logs (customer_id, branch_id, decision, entry_kind, source, created_at)
		VALUES ($1, $2, 'allowed', 'open_gym', 'manual', $3)`, m, branch, at.Add(-time.Hour))

	res, err := f.svc.checkInBooking(f.ctx, f.tx, m, gatePoint{BranchID: &branch, Source: "manual"}, "", at)
	if err != nil || res.Decision != "allowed" || res.CreditsDeducted != 1 {
		t.Fatalf("first entry of the WITA day: %+v %v", res, err)
	}
	witaDay := localtime.DayKey(at, wita)
	if got := f.scalar(`SELECT idempotency_key || '|' || note FROM gym.credit_ledger
		WHERE customer_id = $1 AND source_type = 'open_gym'`, m); got != "gym:open_gym:"+m+":"+witaDay+"|Open gym "+witaDay {
		t.Fatalf("open gym charge = %s, want day %s", got, witaDay)
	}
}

func TestWitaBranchTemplatesAndReminders(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE gym.session_templates SET active = false`)
	branch := f.witaBranch()
	typeID, typeName := f.classType(1)

	res := f.asStaff("POST", "/api/gym/session-templates", map[string]any{
		"class_type_id": typeID, "branch_id": branch, "weekday": 1, "start_time": "06:05", "valid_from": "2031-01-01",
	})
	if res.Status != 200 {
		t.Fatalf("create template: %s", res.Raw)
	}
	templateID := res.data()["id"].(string)
	for _, row := range f.asStaff("GET", "/api/gym/session-templates", nil).data()["templates"].([]any) {
		if row := row.(map[string]any); row["id"] == templateID && row["timezone"] != "Asia/Makassar" {
			t.Fatalf("template zone: %v", row)
		}
	}

	// Sunday 2 March 2031 23.30 WIB is already Monday 00.30 WITA.
	now := time.Date(2031, 3, 2, 16, 30, 0, 0, time.UTC)
	if n, err := f.service(NotificationsSQL{}).GenerateFromTemplates(f.ctx, now, 1); err != nil || n != 1 {
		t.Fatalf("generate: %d %v", n, err)
	}
	if got := f.scalar(`SELECT occurrence_date::text || ' ' || to_char(starts_at AT TIME ZONE 'Asia/Makassar', 'HH24:MI')
		FROM gym.class_sessions WHERE template_id = $1`, templateID); got != "2031-03-03 06:05" {
		t.Fatalf("generated WITA session = %s", got)
	}

	// The class reminder names the WITA time.
	f.setRules(map[string]any{"classReminderMinutes": 120})
	start := time.Now().Add(90 * time.Minute).Truncate(time.Minute)
	session := f.branchSession(typeID, branch, start)
	m := f.member(3)
	if res := f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": session, "customer_id": m}); res.Status != 200 {
		t.Fatalf("book: %s", res.Raw)
	}
	if err := f.svc.SendClassReminders(f.ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	want := "Kelas mulai " + localtime.Format(start, wita) + ". Siapkan QR check-in di aplikasi."
	if got := f.notifications(m, "gym_class_reminder"); len(got) != 1 || got[0] != want || !strings.Contains(want, " WITA.") {
		t.Fatalf("reminder = %v, want %q (%s)", got, want, typeName)
	}
}
