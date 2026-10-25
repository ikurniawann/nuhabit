package events

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	eventsc "nuhabit/backend/internal/contracts/events"
	"nuhabit/backend/internal/platform/testutil"
)

// Every test writes inside one rolled-back transaction; the org and staff
// fixtures are committed by testutil and removed afterwards.

var fixedNow = time.Date(2026, 11, 1, 2, 0, 0, 0, time.UTC) // 09.00 WIB

// recordingChannels notes the staff sends.
type recordingChannels struct {
	mu     sync.Mutex
	titles []string
}

func (c *recordingChannels) SendTo(_, _ *string, title, _ string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.titles = append(c.titles, title)
}

type env struct {
	t        *testing.T
	ctx      context.Context
	tx       pgx.Tx
	svc      *Service
	mux      http.Handler
	staff    testutil.Staff
	org      testutil.Org
	channels *recordingChannels
}

func setup(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return fixedNow })
	org := testutil.CreateOrg(t, nil)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{
		Menus:    map[string][]string{"events.calendar": {"read"}, "crm.engagement": {"read", "create", "update"}},
		BranchID: &org.BranchID,
	})
	tx := testutil.Tx(t)
	channels := &recordingChannels{}
	svc := NewService(tx, Ports{Channels: channels}, deps.Now, slog.New(slog.NewTextHandler(io.Discard, nil)))
	mux := testutil.Mux(mod{h: &handler{svc: svc, guard: deps.Auth}})
	return &env{t: t, ctx: context.Background(), tx: tx, svc: svc, mux: mux, staff: staff, org: org, channels: channels}
}

func (e *env) id(sql string, args ...any) string {
	e.t.Helper()
	var id string
	if err := e.tx.QueryRow(e.ctx, sql+" RETURNING id::text", args...).Scan(&id); err != nil {
		e.t.Fatalf("fixture: %v", err)
	}
	return id
}

func (e *env) count(sql string, args ...any) int {
	e.t.Helper()
	var n int
	if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(&n); err != nil {
		e.t.Fatalf("count: %v", err)
	}
	return n
}

func (e *env) coach(name string, userID *string) string {
	return e.id(`INSERT INTO gym.coaches (name, user_id, branch_id) VALUES ($1, $2, $3)`, name+" "+testutil.RandomHex(3), userID, e.org.BranchID)
}

func (e *env) classType() string {
	return e.id(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity) VALUES ($1, 60, 1, 12)`,
		"Kelas "+testutil.RandomHex(3))
}

func (e *env) session(classType, coach, area string, start, end time.Time) string {
	return e.id(`INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, area, starts_at, ends_at, capacity, credit_cost,
	        booking_opens_at, booking_closes_at, status)
	      VALUES ($1, $2, $3, $4, $5, $6, 12, 1, $5, $5, 'published')`, classType, coach, e.org.BranchID, area, start, end)
}

func (e *env) crmEvent(title string, start, end time.Time, area *string, coach, organiser *string, status string) string {
	return e.id(`INSERT INTO crm.events (title, starts_at, ends_at, capacity, status, branch_id, area, coach_id, organiser_user_id)
	      VALUES ($1, $2, $3, 20, $4, $5, $6, $7, $8)`, title, start, end, status, e.org.BranchID, area, coach, organiser)
}

func (e *env) siteEvent(title string, start time.Time, status string) string {
	return e.id(`INSERT INTO site.events (slug, title, starts_at, status, branch_id) VALUES ($1, $2, $3, $4, $5)`,
		"ev-"+testutil.RandomHex(4), title, start, status, e.org.BranchID)
}

// actor is a staff account created inside the transaction: it needs no
// session, and its rows roll back with everything that references them.
type actor struct{ UserID string }

func (e *env) user(name string, branchID *string) actor {
	e.t.Helper()
	email := "go-events-" + testutil.RandomHex(6) + "@test.local"
	id := e.id(`INSERT INTO auth.users (email, password_hash) VALUES ($1, 'x')`, email)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO configuration.users (id, full_name, role, email, branch_id) VALUES ($1, $2, 'pos', $3, $4)`,
		id, name, email, branchID); err != nil {
		e.t.Fatalf("user fixture: %v", err)
	}
	return actor{UserID: id}
}

func (e *env) member() string {
	return e.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Member Uji')`, "+6298"+testutil.RandomHex(5))
}

func (e *env) call(method, path string, body any, status int) map[string]any {
	e.t.Helper()
	rec, out := testutil.Do(e.t, e.mux, testutil.AsStaff(testutil.Request(method, path, body), e.staff))
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
	}
	return out
}

func at(h, m int) time.Time { return time.Date(2026, 11, 2, h, m, 0, 0, time.UTC) }

func str(s string) *string { return &s }

func countKinds(list []any) map[string]int {
	out := map[string]int{}
	for _, it := range list {
		out[it.(map[string]any)["kind"].(string)]++
	}
	return out
}

func TestCalendarListsEverySourceOnce(t *testing.T) {
	e := setup(t)
	coach := e.coach("Dimas", nil)
	e.session(e.classType(), coach, "Arena", at(3, 0), at(4, 0))
	crmID := e.crmEvent("Race Day", at(5, 0), at(7, 0), str("Arena"), nil, nil, "published")
	linked := e.siteEvent("Race Day", at(5, 0), "published")
	if _, err := e.tx.Exec(e.ctx, `UPDATE site.events SET crm_event_id = $1 WHERE id = $2`, crmID, linked); err != nil {
		t.Fatal(err)
	}
	e.siteEvent("Open House", at(8, 0), "draft")
	e.crmEvent("Batal", at(9, 0), at(10, 0), nil, nil, nil, "cancelled")

	out := e.call("GET", "/api/events/calendar?from=2026-11-02T00:00:00Z&to=2026-11-03T00:00:00Z&branch_id="+e.org.BranchID, nil, 200)
	got := countKinds(out["data"].([]any))
	if got["class"] != 1 || got["crm_event"] != 1 || got["site_event"] != 1 || len(out["data"].([]any)) != 3 {
		t.Fatalf("want one class, one CRM event (its linked site twin hidden), one site event; got %v", got)
	}
	out = e.call("GET", "/api/events/calendar?from=2026-11-02T00:00:00Z&to=2026-11-03T00:00:00Z&branch_id="+e.org.BranchID+"&kinds=class&area=arena", nil, 200)
	if list := out["data"].([]any); len(list) != 1 || list[0].(map[string]any)["coach_name"] == nil {
		t.Fatalf("area and kind filters: %v", list)
	}
	e.call("GET", "/api/events/calendar?from=2026-11-02T00:00:00Z&to=2026-11-02T00:00:00Z", nil, 400)
	e.call("GET", "/api/events/calendar?from=2026-11-02T00:00:00Z&to=2026-11-03T00:00:00Z&kinds=party", nil, 400)
}

func TestCheckFindsRoomCoachAndBranchClashes(t *testing.T) {
	e := setup(t)
	coach := e.coach("Dimas", nil)
	e.session(e.classType(), coach, "Arena", at(3, 0), at(4, 0))
	e.session(e.classType(), e.coach("Rani", nil), "Studio", at(3, 0), at(4, 0))

	report, err := e.svc.Check(e.ctx, e.tx, eventsc.Subject{Source: eventsc.SourceCRM, Title: "Race Day", BranchID: &e.org.BranchID,
		Area: str("arena"), StartsAt: at(3, 30), EndsAt: at(5, 0)})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Blocking) != 1 || report.Blocking[0].Reason != "room" || len(report.Warnings) != 1 || report.Warnings[0].Reason != "branch" {
		t.Fatalf("room clash plus a branch warning, got %+v", report)
	}
	report, err = e.svc.Check(e.ctx, e.tx, eventsc.Subject{Source: eventsc.SourceSite, Title: "Workshop", CoachID: &coach,
		StartsAt: at(3, 30), EndsAt: at(5, 0)})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Blocking) != 1 || report.Blocking[0].Reason != "coach" {
		t.Fatalf("coach clash without a branch, got %+v", report)
	}
	report, err = e.svc.Check(e.ctx, e.tx, eventsc.Subject{Source: eventsc.SourceCRM, Title: "Race Day", BranchID: &e.org.BranchID,
		Area: str("Arena"), StartsAt: at(4, 0), EndsAt: at(5, 0)})
	if err != nil || report.Blocked() || len(report.Warnings) != 0 {
		t.Fatalf("back-to-back is free: %+v %v", report, err)
	}
}

func TestCheckSkipsTheSubjectAndItsTwin(t *testing.T) {
	e := setup(t)
	crmID := e.crmEvent("Race Day", at(5, 0), at(7, 0), str("Arena"), nil, nil, "published")
	siteID := e.siteEvent("Race Day", at(5, 0), "published")
	if _, err := e.tx.Exec(e.ctx, `UPDATE site.events SET crm_event_id = $1, area = 'Arena' WHERE id = $2`, crmID, siteID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `UPDATE crm.events SET site_event_id = $1 WHERE id = $2`, siteID, crmID); err != nil {
		t.Fatal(err)
	}
	for _, sub := range []eventsc.Subject{
		{Source: eventsc.SourceCRM, ID: crmID, Title: "Race Day", BranchID: &e.org.BranchID, Area: str("Arena"), StartsAt: at(5, 0), EndsAt: at(7, 0)},
		{Source: eventsc.SourceSite, ID: siteID, Title: "Race Day", BranchID: &e.org.BranchID, Area: str("Arena"), StartsAt: at(5, 0), EndsAt: at(7, 0)},
	} {
		report, err := e.svc.Check(e.ctx, e.tx, sub)
		if err != nil || report.Blocked() {
			t.Fatalf("%s subject must not clash with itself or its twin: %+v %v", sub.Source, report, err)
		}
	}
}

func TestOverrideIsRecorded(t *testing.T) {
	e := setup(t)
	crmID := e.crmEvent("Race Day", at(5, 0), at(7, 0), str("Arena"), nil, nil, "published")
	sub := eventsc.Subject{Source: eventsc.SourceCRM, ID: crmID, Title: "Race Day"}
	report := eventsc.Report{Blocking: []eventsc.Clash{{Reason: "room", Kind: eventsc.KindClass, ID: "x", Message: "Area Arena sudah dipakai"}}}
	if err := e.svc.RecordOverride(e.ctx, e.tx, sub, eventsc.Override{UserID: e.staff.UserID, Reason: "Sponsor sudah konfirmasi"}, report); err != nil {
		t.Fatal(err)
	}
	out := e.call("GET", "/api/events/overrides?source=crm&event_id="+crmID, nil, 200)
	list := out["data"].([]any)
	if len(list) != 1 {
		t.Fatalf("overrides %v", list)
	}
	row := list[0].(map[string]any)
	if row["reason"] != "Sponsor sudah konfirmasi" || row["user_name"] != e.staff.FullName {
		t.Fatalf("override row %v", row)
	}
	if clashes := row["clashes"].([]any); len(clashes) != 1 || clashes[0].(map[string]any)["reason"] != "room" {
		t.Fatalf("clashes %v", row["clashes"])
	}
}

func TestNotifyReachesEveryParty(t *testing.T) {
	e := setup(t)
	organiser := e.user("Alya", nil)
	assignee := e.user("Budi", nil)
	coachUser := e.user("Dimas", nil)
	desk := e.user("Front Desk", &e.org.BranchID)
	otherDesk := e.user("Desk Cabang Lain", nil)
	for _, u := range []actor{desk, otherDesk} {
		if _, err := e.tx.Exec(e.ctx, `INSERT INTO iam.user_roles (user_id, role_id)
		      SELECT $1, id FROM iam.roles WHERE code = 'gym_front_desk'`, u.UserID); err != nil {
			t.Fatal(err)
		}
	}
	coach := e.coach("Dimas", &coachUser.UserID)
	e.session(e.classType(), coach, "Studio", at(5, 30), at(6, 30))
	e.session(e.classType(), e.coach("Jauh", &otherDesk.UserID), "Studio", at(9, 0), at(10, 0))
	crmID := e.crmEvent("Race Day", at(5, 0), at(7, 0), str("Arena"), nil, &organiser.UserID, "published")
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO events.tasks (crm_event_id, title, assignee_user_id) VALUES ($1, 'Pasang banner', $2)`, crmID, assignee.UserID); err != nil {
		t.Fatal(err)
	}
	member := e.member()
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO crm.event_bookings (event_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, crmID, member); err != nil {
		t.Fatal(err)
	}

	previous := at(4, 0)
	change := eventsc.Change{Kind: eventsc.ChangeTimeChanged, PreviousStartsAt: &previous, OrganiserUserID: &organiser.UserID,
		ActorUserID: e.staff.UserID, NotifyMembers: true,
		Subject: eventsc.Subject{Source: eventsc.SourceCRM, ID: crmID, Title: "Race Day", BranchID: &e.org.BranchID, Area: str("Arena"),
			StartsAt: at(5, 0), EndsAt: at(7, 0)}}
	if err := e.svc.Notify(e.ctx, e.tx, change); err != nil {
		t.Fatal(err)
	}
	inbox := func(userID string) int {
		return e.count(`SELECT count(*) FROM public.notifications WHERE user_id = $1 AND title = 'Jadwal event berubah: Race Day'`, userID)
	}
	for name, u := range map[string]actor{"organiser": organiser, "assignee": assignee, "coach": coachUser, "desk": desk} {
		if inbox(u.UserID) != 1 {
			t.Errorf("%s should have one inbox row", name)
		}
	}
	for name, u := range map[string]actor{"actor": {e.staff.UserID}, "other desk": otherDesk} {
		if inbox(u.UserID) != 0 {
			t.Errorf("%s should not be told", name)
		}
	}
	var body string
	if err := e.tx.QueryRow(e.ctx, `SELECT message FROM public.notifications WHERE user_id = $1`, desk.UserID).Scan(&body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, "pindah dari Sen, 2 Nov, 11.00 ke Sen, 2 Nov, 12.00–14.00 di Go Test B") || !strings.Contains(body, "· Arena") {
		t.Errorf("body %q", body)
	}
	if n := e.count(`SELECT count(*) FROM crm.member_notifications WHERE customer_id = $1 AND type = 'event_rescheduled'`, member); n != 1 {
		t.Errorf("member inbox rows %d", n)
	}
	if n := e.count(`SELECT count(*) FROM platform.outbox_events WHERE topic = 'gym.member.notified' AND key = $1`, member); n != 1 {
		t.Errorf("member outbox rows %d", n)
	}
	e.channels.mu.Lock()
	defer e.channels.mu.Unlock()
	if len(e.channels.titles) != 2 {
		t.Errorf("organiser and assignee get WhatsApp/email, got %d sends", len(e.channels.titles))
	}
}

func TestRemindersGoOutOnceToMembersAndStaff(t *testing.T) {
	e := setup(t)
	organiser := e.user("Alya", nil)
	start := fixedNow.Add(90 * time.Minute)
	crmID := e.crmEvent("Race Day", start, start.Add(2*time.Hour), nil, nil, &organiser.UserID, "published")
	e.crmEvent("Draf", start, start.Add(time.Hour), nil, nil, &organiser.UserID, "draft")
	member, quiet := e.member(), e.member()
	for _, m := range []string{member, quiet} {
		if _, err := e.tx.Exec(e.ctx, `INSERT INTO crm.event_bookings (event_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, crmID, m); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO gym.athlete_settings (customer_id, booking_reminders) VALUES ($1, false)`, quiet); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := e.svc.SendReminders(e.ctx, fixedNow); err != nil {
			t.Fatal(err)
		}
	}
	if n := e.count(`SELECT count(*) FROM crm.member_notifications WHERE customer_id = $1 AND type = 'event_reminder'`, member); n != 1 {
		t.Errorf("member reminders %d, want exactly one", n)
	}
	if n := e.count(`SELECT count(*) FROM crm.member_notifications WHERE customer_id = $1`, quiet); n != 0 {
		t.Errorf("a member with reminders off got %d", n)
	}
	if n := e.count(`SELECT count(*) FROM public.notifications WHERE user_id = $1 AND type = 'reminder'`, organiser.UserID); n != 1 {
		t.Errorf("staff reminders %d, want exactly one", n)
	}
	if n := e.count(`SELECT count(*) FROM platform.reminder_sends WHERE kind = 'event_reminder' AND period LIKE '2h:%'`); n != 2 {
		t.Errorf("sent log rows %d, want one member and one staff claim in the 2h window", n)
	}
}

func TestFeedServesTheBranchCalendar(t *testing.T) {
	e := setup(t)
	e.session(e.classType(), e.coach("Dimas", nil), "Arena", at(3, 0), at(4, 0))
	other := testutil.CreateOrg(t, e.tx)
	if _, err := e.tx.Exec(e.ctx, `INSERT INTO site.events (slug, title, starts_at, status, branch_id) VALUES ($1, 'Di Cabang Lain', $2, 'published', $3)`,
		"other-"+testutil.RandomHex(4), at(8, 0), other.BranchID); err != nil {
		t.Fatal(err)
	}
	out := e.call("POST", "/api/events/feeds", map[string]any{"branch_id": e.org.BranchID, "label": "Google"}, 201)
	url := out["data"].(map[string]any)["url"].(string)
	if !strings.Contains(url, FeedPath+"?token=") {
		t.Fatalf("url %q", url)
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, httptest.NewRequest("GET", url[strings.Index(url, FeedPath):], nil))
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/calendar") {
		t.Fatalf("feed: %d %s", rec.Code, rec.Body.String())
	}
	ics := rec.Body.String()
	if !strings.Contains(ics, "SUMMARY:Kelas ") || strings.Contains(ics, "Di Cabang Lain") || !strings.Contains(ics, "Go Test B") {
		t.Fatalf("feed content:\n%s", ics)
	}
	list := e.call("GET", "/api/events/feeds", nil, 200)["data"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["label"] != "Google" {
		t.Fatalf("feeds %v", list)
	}
	id := list[0].(map[string]any)["id"].(string)
	e.call("DELETE", "/api/events/feeds/"+id, nil, 200)
	rec = httptest.NewRecorder()
	e.mux.ServeHTTP(rec, httptest.NewRequest("GET", url[strings.Index(url, FeedPath):], nil))
	if rec.Code != 404 {
		t.Fatalf("a revoked token must stop serving, got %d", rec.Code)
	}
}

func TestExportCSV(t *testing.T) {
	e := setup(t)
	e.crmEvent("Race Day", at(5, 0), at(7, 0), str("Arena"), nil, nil, "published")
	rec, _ := testutil.Do(t, e.mux, testutil.AsStaff(testutil.Request("GET", "/api/events/export.csv?month=2026-11&branch_id="+e.org.BranchID, nil), e.staff))
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("csv: %d %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Tanggal,Mulai,Selesai,Zona,Jenis,Judul") || !strings.Contains(body, "2026-11-02,12:00,14:00,WIB,Event member,Race Day") {
		t.Fatalf("csv body:\n%s", body)
	}
	e.call("GET", "/api/events/export.csv?month=nov", nil, 400)
}

func TestLinkPublishAndUnlink(t *testing.T) {
	e := setup(t)
	crmID := e.crmEvent("Race Day", at(5, 0), at(7, 0), str("Arena"), nil, nil, "published")
	siteID := e.siteEvent("Race Day di Situs", at(5, 0), "draft")

	cands := e.call("GET", "/api/events/link/candidates?source=crm", nil, 200)["data"].([]any)
	found := false
	for _, c := range cands {
		found = found || c.(map[string]any)["id"] == siteID
	}
	if !found {
		t.Fatalf("site candidate missing from %v", cands)
	}
	e.call("POST", "/api/events/link", map[string]any{"crm_event_id": crmID, "site_event_id": siteID}, 200)
	if n := e.count(`SELECT count(*) FROM crm.events c JOIN site.events s ON s.crm_event_id = c.id WHERE c.id = $1 AND c.site_event_id = s.id`, crmID); n != 1 {
		t.Fatalf("both sides should point at each other")
	}
	e.call("POST", "/api/events/link", map[string]any{"crm_event_id": crmID, "site_event_id": siteID}, 409)
	e.call("DELETE", "/api/events/link/"+crmID, nil, 200)
	e.call("DELETE", "/api/events/link/"+crmID, nil, 404)

	out := e.call("POST", "/api/events/link/publish", map[string]any{"crm_event_id": crmID}, 201)
	newSite := out["data"].(map[string]any)["site_event_id"].(string)
	var slug, status, area string
	if err := e.tx.QueryRow(e.ctx, `SELECT slug, status, area FROM site.events WHERE id = $1 AND crm_event_id = $2`, newSite, crmID).Scan(&slug, &status, &area); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(slug, "race-day") || status != "draft" || area != "Arena" {
		t.Fatalf("published copy: %s %s %s", slug, status, area)
	}
	e.call("POST", "/api/events/link/publish", map[string]any{"crm_event_id": crmID}, 409)
}

func TestTasksFollowTheLinkedEvent(t *testing.T) {
	e := setup(t)
	assignee := e.user("Budi", nil)
	crmID := e.crmEvent("Race Day", at(5, 0), at(7, 0), nil, nil, nil, "published")
	siteID := e.siteEvent("Race Day", at(5, 0), "published")
	e.call("POST", "/api/events/link", map[string]any{"crm_event_id": crmID, "site_event_id": siteID}, 200)

	out := e.call("POST", "/api/events/tasks", map[string]any{"source": "site", "event_id": siteID, "kind": "sponsor",
		"title": "Kirim deliverables sponsor", "assignee_user_id": assignee.UserID, "due_at": "2026-11-01T10:00:00Z"}, 201)
	task := out["data"].(map[string]any)
	if task["assignee_name"] != "Budi" || task["kind"] != "sponsor" || task["done_at"] != nil {
		t.Fatalf("task %v", task)
	}
	if n := e.count(`SELECT count(*) FROM events.tasks WHERE crm_event_id = $1`, crmID); n != 1 {
		t.Fatalf("a task added through the site event lands on the CRM event, rows %d", n)
	}
	if n := e.count(`SELECT count(*) FROM public.notifications WHERE user_id = $1 AND title = 'Tugas event baru'`, assignee.UserID); n != 1 {
		t.Fatalf("assignee inbox rows %d", n)
	}
	list := e.call("GET", "/api/events/tasks?source=crm&event_id="+crmID, nil, 200)["data"].([]any)
	if len(list) != 1 {
		t.Fatalf("tasks %v", list)
	}
	id := task["id"].(string)
	done := e.call("PATCH", "/api/events/tasks/"+id, map[string]any{"done": true, "title": "Deliverables sponsor"}, 200)["data"].(map[string]any)
	if done["done_at"] == nil || done["title"] != "Deliverables sponsor" {
		t.Fatalf("patched %v", done)
	}
	e.call("PATCH", "/api/events/tasks/"+id, map[string]any{"kind": "party"}, 400)
	e.call("DELETE", "/api/events/tasks/"+id, nil, 200)
	e.call("DELETE", "/api/events/tasks/"+id, nil, 404)
	e.call("GET", "/api/events/tasks?source=crm&event_id=0b7a8f8e-2d7c-4f3e-9a1b-5c6d7e8f9a0b", nil, 404)
}

func TestOptions(t *testing.T) {
	e := setup(t)
	e.coach("Dimas", nil)
	e.crmEvent("Race Day", at(5, 0), at(7, 0), str("Arena Utama"), nil, nil, "published")
	out := e.call("GET", "/api/events/options", nil, 200)["data"].(map[string]any)
	hasArea := false
	for _, a := range out["areas"].([]any) {
		hasArea = hasArea || a == "Arena Utama"
	}
	if !hasArea || len(out["branches"].([]any)) == 0 || len(out["coaches"].([]any)) == 0 || len(out["task_kinds"].([]any)) != 5 {
		t.Fatalf("options %v", out)
	}
}
