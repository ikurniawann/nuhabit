package engagement

import (
	"testing"
	"time"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/modules/events"
	"nuhabit/backend/internal/platform/testutil"
)

// calendarEnv is the engagement handler with the event calendar wired on
// the test transaction, a class in the Arena and two staff accounts: one
// who only reads engagement and one who may update it.
type calendarEnv struct {
	env
	editor  testutil.Staff
	org     testutil.Org
	coachID string
}

func setupCalendar(t *testing.T) calendarEnv {
	t.Helper()
	// Staff first: the override row references the editor, so their cleanup
	// must run after the transaction rolls back.
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm.engagement": {"read"}}})
	editor := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm.engagement": {"read", "update"}}})
	tx := testutil.Tx(t)
	d := testutil.Deps(t, nil)
	push := &recordingPush{}
	h := newHandler(tx, d, Ports{Orders: OrdersSQL{}, Push: push, Calendar: events.NewService(tx, events.Ports{}, nil, nil)})
	org := testutil.CreateOrg(t, tx)
	coach := crmtest.Scalar[string](t, tx, `INSERT INTO gym.coaches (name, branch_id) VALUES ($1, $2) RETURNING id::text`,
		"Coach Kalender "+testutil.RandomHex(3), org.BranchID)
	classType := crmtest.Scalar[string](t, tx, `INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ($1, 60, 1, 12) RETURNING id::text`, "Kelas "+testutil.RandomHex(3))
	crmtest.MustExec(t, tx, `INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, area, starts_at, ends_at, capacity, credit_cost,
	        booking_opens_at, booking_closes_at, status)
	      VALUES ($1, $2, $3, 'Arena', $4, $5, 12, 1, $4, $4, 'published')`, classType, coach, org.BranchID, at(3, 0), at(4, 0))
	return calendarEnv{env: env{t: t, tx: tx, mux: crmtest.Mux(h.routes()), push: push, staff: reader}, editor: editor, org: org, coachID: coach}
}

func at(h, m int) time.Time { return time.Date(2026, 11, 2, h, m, 0, 0, time.UTC) }

func (e calendarEnv) event(area string, extra map[string]any) map[string]any {
	body := map[string]any{
		"title": "Race Day", "starts_at": at(3, 30).Format(time.RFC3339), "ends_at": at(5, 0).Format(time.RFC3339),
		"capacity": 20, "status": "published", "branch_id": e.org.BranchID, "area": area,
	}
	for k, v := range extra {
		body[k] = v
	}
	return body
}

func TestEventSaveBlocksClashesUntilOverridden(t *testing.T) {
	e := setupCalendar(t)
	code, body := e.call("POST", "/api/crm/engagement/events", e.event("arena", nil))
	if code != 409 || body["code"] != "event_conflict" {
		t.Fatalf("room clash: %d %v", code, body)
	}
	blocking := body["params"].(map[string]any)["blocking"].([]any)
	if len(blocking) != 1 || blocking[0].(map[string]any)["reason"] != "room" {
		t.Fatalf("params %v", body["params"])
	}

	code, body = e.call("POST", "/api/crm/engagement/events", e.event("arena", map[string]any{"override_reason": "Kelas dipindah ke lapangan"}))
	if code != 403 {
		t.Fatalf("a reader cannot override: %d %v", code, body)
	}

	code, body = crmtest.Call(t, e.mux, "POST", "/api/crm/engagement/events",
		e.event("arena", map[string]any{"override_reason": "Kelas dipindah ke lapangan"}), &e.editor)
	if code != 200 {
		t.Fatalf("override: %d %v", code, body)
	}
	eventID := data(t, body)["id"].(string)
	reason := crmtest.Scalar[string](t, e.tx, `SELECT reason FROM events.conflict_overrides WHERE crm_event_id = $1 AND user_id = $2`, eventID, e.editor.UserID)
	if reason != "Kelas dipindah ke lapangan" {
		t.Fatalf("override row: %q", reason)
	}

	code, body = e.call("POST", "/api/crm/engagement/events", e.event("Studio", map[string]any{"title": "Workshop"}))
	if code != 200 {
		t.Fatalf("another room saves: %d %v", code, body)
	}
	if warnings := data(t, body)["warnings"].([]any); len(warnings) != 1 || warnings[0].(map[string]any)["kind"] != "class" {
		t.Fatalf("the class in the same branch warns, other events do not: %v", warnings)
	}

	code, body = e.call("POST", "/api/crm/engagement/events", e.event("", map[string]any{"title": "Coach Clinic", "coach_id": e.coachID}))
	if code != 409 || blockingReason(body) != "coach" {
		t.Fatalf("coach clash: %d %v", code, body)
	}
}

func blockingReason(body map[string]any) string {
	list := body["params"].(map[string]any)["blocking"].([]any)
	return list[0].(map[string]any)["reason"].(string)
}

func TestEventChangesTellTheOrganiserAndMembers(t *testing.T) {
	e := setupCalendar(t)
	organiser := crmtest.Scalar[string](t, e.tx, `WITH a AS (INSERT INTO auth.users (email, password_hash) VALUES ($1, 'x') RETURNING id)
		INSERT INTO configuration.users (id, full_name, role, email) SELECT id, 'Alya', 'pos', $1 FROM a RETURNING id::text`,
		"go-organiser-"+testutil.RandomHex(5)+"@test.local")
	inbox := func(title string) int {
		return crmtest.Scalar[int](t, e.tx, `SELECT count(*)::int FROM public.notifications WHERE user_id = $1 AND title = $2`, organiser, title)
	}

	code, body := e.call("POST", "/api/crm/engagement/events", e.event("Studio", map[string]any{"organiser_user_id": organiser, "status": "draft"}))
	if code != 200 || inbox("Event baru: Race Day") != 0 {
		t.Fatalf("a draft tells nobody: %d %v", code, body)
	}
	eventID := data(t, body)["id"].(string)
	publish := e.event("Studio", map[string]any{"organiser_user_id": organiser, "id": eventID})
	if code, body = e.call("POST", "/api/crm/engagement/events", publish); code != 200 || inbox("Event baru: Race Day") != 1 {
		t.Fatalf("publishing tells the organiser: %d %v", code, body)
	}
	member := e.customer("Ana")
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.event_bookings (event_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, eventID, member)

	publish["starts_at"], publish["ends_at"] = at(6, 0).Format(time.RFC3339), at(7, 0).Format(time.RFC3339)
	if code, body = e.call("POST", "/api/crm/engagement/events", publish); code != 200 || inbox("Jadwal event berubah: Race Day") != 1 {
		t.Fatalf("moving tells the organiser: %d %v", code, body)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*)::int FROM crm.member_notifications WHERE customer_id = $1 AND type = 'event_rescheduled'`, member); n != 1 {
		t.Fatalf("member reschedule notices %d", n)
	}
	if code, body = e.call("POST", "/api/crm/engagement/events", publish); code != 200 || inbox("Event diperbarui: Race Day") != 1 {
		t.Fatalf("a plain edit is an update: %d %v", code, body)
	}

	if code, body = e.call("DELETE", "/api/crm/engagement/events?id="+eventID, nil); code != 200 || inbox("Event dibatalkan: Race Day") != 1 {
		t.Fatalf("cancelling tells the organiser: %d %v", code, body)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*)::int FROM crm.member_notifications WHERE customer_id = $1 AND type = 'event_cancelled'`, member); n != 1 {
		t.Fatalf("the engagement cancel path tells members once, got %d", n)
	}
}
