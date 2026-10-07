package athlete

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/athlete/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests for every Train route against TEST_DATABASE_URL. Fixtures
// hang off throwaway members (activities, gear, follows... cascade on delete);
// segments, challenges and clubs are removed explicitly.

const base = "/api/member-portal/app/train"

type env struct {
	t   *testing.T
	mux http.Handler
}

func setup(t *testing.T) env {
	deps := testutil.Deps(t, nil)
	return env{t: t, mux: testutil.Mux(New(deps))}
}

// call serves a request as member m (nil = anonymous) and checks the status.
func (e env) call(m *testutil.Member, method, path string, body any, status int) map[string]any {
	e.t.Helper()
	r := testutil.Request(method, path, body)
	if m != nil {
		r = testutil.AsMember(r, *m)
	}
	rec, out := testutil.Do(e.t, e.mux, r)
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
	}
	return out
}

// data unwraps {"success":true,"data":...}.
func (e env) data(m *testutil.Member, method, path string, body any) any {
	e.t.Helper()
	out := e.call(m, method, path, body, http.StatusOK)
	if out["success"] != true {
		e.t.Fatalf("%s %s: %v", method, path, out)
	}
	return out["data"]
}

func (e env) obj(m *testutil.Member, method, path string, body any) map[string]any {
	e.t.Helper()
	return e.data(m, method, path, body).(map[string]any)
}

func (e env) list(m *testutil.Member, method, path string, body any) []any {
	e.t.Helper()
	return e.data(m, method, path, body).([]any)
}

func (e env) fail(m *testutil.Member, method, path string, body any, status int, msg string) {
	e.t.Helper()
	out := e.call(m, method, path, body, status)
	if out["success"] != false || out["error"] != msg {
		e.t.Fatalf("%s %s: %v, want error %q", method, path, out, msg)
	}
}

func exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := testutil.DB(t).Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec: %v", err)
	}
}

func insertID(t *testing.T, cleanupTable, sql string, args ...any) string {
	t.Helper()
	var id string
	db := testutil.DB(t)
	if err := db.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		t.Fatalf("insert: %v", err)
	}
	if cleanupTable != "" {
		t.Cleanup(func() { _, _ = db.Exec(context.Background(), "DELETE FROM "+cleanupTable+" WHERE id = $1", id) })
	}
	return id
}

// track is a straight line north from a unique start: steps x 10 m every 3 s.
func track(steps int, lat float64) []map[string]any {
	out := make([]map[string]any, steps+1)
	for i := range out {
		out[i] = map[string]any{"t": i * 3000, "lat": lat + float64(i)*10/111_195, "lng": 106.808}
	}
	return out
}

func idOf(v any) string { return v.(map[string]any)["id"].(string) }

func ids(list []any) map[string]bool {
	out := map[string]bool{}
	for _, v := range list {
		out[idOf(v)] = true
	}
	return out
}

const missingID = "00000000-0000-4000-8000-000000000000"

func TestAuthAndParams(t *testing.T) {
	e := setup(t)
	e.fail(nil, "GET", base+"/feed", nil, 401, "Unauthorized")
	e.fail(nil, "PATCH", "/api/member-portal/app/home/settings", map[string]any{}, 401, "Unauthorized")
	m := testutil.CreateMember(t)
	e.fail(&m, "GET", base+"/activities/not-a-uuid", nil, 404, "Data tidak ditemukan")
	e.fail(&m, "GET", base+"/activities/"+missingID, nil, 404, "Aktivitas tidak ditemukan")
	e.fail(&m, "POST", base+"/activities", "{bad json", 400, "Data aktivitas tidak valid")
	e.fail(&m, "POST", base+"/activities", map[string]any{"type": "SWIM"}, 400, "Data aktivitas tidak valid")
	e.fail(&m, "POST", base+"/gear", map[string]any{"name": "x", "kind": "SHOES"}, 400, "Nama gear 2-60 karakter, jenis SHOES atau BIKE")
	e.fail(&m, "PATCH", base+"/gear/"+missingID, map[string]any{"name": "Pegasus", "kind": "SHOES"}, 404, "Gear tidak ditemukan")
	e.fail(&m, "PUT", base+"/settings", map[string]any{"weeklyGoalKm": 0}, 400, "Pengaturan tidak valid (target 1-1000 km)")
	e.fail(&m, "PATCH", "/api/member-portal/app/home/settings", map[string]any{"units": "X"}, 400, "Data tidak valid")
	e.fail(&m, "POST", base+"/follow/"+m.CustomerID, nil, 400, "Tidak bisa mengikuti diri sendiri.")
	e.fail(&m, "POST", base+"/follow/"+missingID, nil, 404, "Member tidak ditemukan")
	e.fail(&m, "GET", base+"/athletes/"+missingID, nil, 404, "Member tidak ditemukan")
	e.fail(&m, "GET", base+"/segments/"+missingID, nil, 404, "Segment tidak ditemukan")
	e.fail(&m, "POST", base+"/challenges/"+missingID+"/join", nil, 404, "Tantangan tidak ditemukan")
	e.fail(&m, "POST", base+"/clubs/"+missingID+"/toggle", nil, 404, "Klub tidak ditemukan")
	e.fail(&m, "DELETE", base+"/routes/"+missingID, nil, 404, "Rute tidak ditemukan")
	e.fail(&m, "POST", base+"/routes", map[string]any{"activityId": missingID, "name": "x"}, 400, "Nama rute 2-80 karakter")
}

func TestActivityLifecycle(t *testing.T) {
	e := setup(t)
	a, b := testutil.CreateMember(t), testutil.CreateMember(t)
	lat := -6.5 - float64(time.Now().UnixNano()%1000)/10_000

	// A segment along the first kilometre of the track.
	points := track(250, lat)
	segment := insertID(t, "gym.athlete_segments",
		`INSERT INTO gym.athlete_segments (name, type, distance_m, location, path)
		 VALUES ('Go Test Segment', 'RUN', 1000, 'Test', $1::jsonb) RETURNING id`,
		fmt.Sprintf(`[{"t":0,"lat":%v,"lng":106.808},{"t":1,"lat":%v,"lng":106.808}]`, points[0]["lat"], points[100]["lat"]))

	gear := e.obj(&a, "POST", base+"/gear", map[string]any{"name": " Pegasus ", "kind": "SHOES"})
	if gear["name"] != "Pegasus" || gear["distanceM"] != 0.0 || gear["retired"] != false || gear["memberId"] != a.CustomerID {
		t.Fatalf("gear %v", gear)
	}
	gearID := gear["id"].(string)

	started := time.Now().Add(-time.Hour)
	startedAt := started.UTC().Format("2006-01-02T15:04:05.000Z")
	card := e.obj(&a, "POST", base+"/activities", map[string]any{
		"type": "RUN", "title": "  ", "startedAt": startedAt, "points": points, "gearId": gearID,
		"photos": []string{"data:image/png;base64,AA"},
	})
	if card["distanceM"] != 2500.0 || card["elapsedSec"] != 750.0 || card["avgPaceSecPerKm"] != 300.0 ||
		card["isOwn"] != true || card["photoCount"] != 1.0 || card["startedAt"] != startedAt ||
		card["memberName"] != "Go Test Member" || len(card["thumbnail"].([]any)) != domain.ThumbnailPoints {
		t.Fatalf("card %v", card)
	}
	if title := card["title"].(string); title != domain.DefaultActivityTitle("RUN", started, domain.StudioTZOffsetMin) {
		t.Fatalf("title %q", title)
	}
	id := card["id"].(string)

	list := e.list(&a, "GET", base+"/gear", nil)
	if list[0].(map[string]any)["distanceM"] != 2500.0 {
		t.Fatalf("gear mileage %v", list)
	}

	detail := e.obj(&a, "GET", base+"/activities/"+id, nil)
	efforts := detail["efforts"].([]any)
	if detail["gearName"] != "Pegasus" || len(detail["splits"].([]any)) != 3 || detail["bestSplitPaceSec"] != 300.0 ||
		len(detail["points"].([]any)) != 251 || len(efforts) != 1 || len(detail["comments"].([]any)) != 0 {
		t.Fatalf("detail %v", detail)
	}
	if ef := efforts[0].(map[string]any); ef["segmentId"] != segment || ef["rank"] != 1.0 || ef["totalEfforts"] != 1.0 || ef["isPersonalBest"] != true {
		t.Fatalf("effort %v", ef)
	}

	// Private activities are 403 for others; B cannot edit A's activity.
	e.obj(&a, "PATCH", base+"/activities/"+id, map[string]any{"visibility": "PRIVATE"})
	e.fail(&b, "GET", base+"/activities/"+id, nil, 403, "Aktivitas ini privat.")
	e.fail(&b, "PATCH", base+"/activities/"+id, map[string]any{"title": "Mine"}, 404, "Aktivitas tidak ditemukan")
	e.fail(&a, "PATCH", base+"/activities/"+id, map[string]any{"title": ""}, 400, "Data aktivitas tidak valid")

	// FOLLOWERS: visible once B follows A.
	patched := e.obj(&a, "PATCH", base+"/activities/"+id, map[string]any{"visibility": "FOLLOWERS", "title": " Tempo ", "gearId": nil})
	if patched["title"] != "Tempo" || patched["visibility"] != "FOLLOWERS" {
		t.Fatalf("patched %v", patched)
	}
	if g := e.list(&a, "GET", base+"/gear", nil)[0].(map[string]any); g["distanceM"] != 0.0 {
		t.Fatalf("gear mileage after unlink %v", g)
	}
	e.fail(&b, "POST", base+"/activities/"+id+"/kudos", nil, 403, "Aktivitas ini privat.")
	if f := e.obj(&b, "POST", base+"/follow/"+a.CustomerID, nil); f["following"] != true {
		t.Fatal(f)
	}
	if ids(e.list(&b, "GET", base+"/feed?scope=following", nil))[id] != true {
		t.Fatal("followed activity missing from feed")
	}

	if k := e.obj(&b, "POST", base+"/activities/"+id+"/kudos", nil); k["kudoed"] != true || k["count"] != 1.0 {
		t.Fatal(k)
	}
	comment := e.obj(&b, "POST", base+"/activities/"+id+"/comments", map[string]any{"text": "  Mantap  "})
	if comment["text"] != "Mantap" || comment["memberId"] != b.CustomerID || comment["memberName"] != "Go Test Member" {
		t.Fatal(comment)
	}
	e.fail(&b, "POST", base+"/activities/"+id+"/comments", map[string]any{"text": " "}, 400, "Komentar 1-500 karakter")
	if p := e.obj(&b, "GET", base+"/athletes/"+a.CustomerID, nil); p["isFollowing"] != true || len(p["activities"].([]any)) != 1 {
		t.Fatalf("profile %v", p)
	}
}

func TestSocialProfileAndRecords(t *testing.T) {
	e := setup(t)
	a, b := testutil.CreateMember(t), testutil.CreateMember(t)
	name := "Go Athlete " + testutil.RandomHex(4)
	exec(t, `UPDATE pos.pos_customers SET name = $2 WHERE id = $1`, a.CustomerID, name)

	act := e.obj(&a, "POST", base+"/activities", map[string]any{"type": "RUN", "title": "Loop", "points": track(120, -6.9)})
	id := act["id"].(string)
	priv := e.obj(&a, "POST", base+"/activities", map[string]any{"type": "WALK", "visibility": "PRIVATE", "manualElapsedSec": 600})
	if priv["title"] == "" || priv["elapsedSec"] != 600.0 || priv["movingSec"] != 600.0 || priv["avgPaceSecPerKm"] != nil {
		t.Fatalf("manual activity %v", priv)
	}

	// Profile as seen by B hides the private walk; totals are unrounded km.
	profile := e.obj(&b, "GET", base+"/athletes/"+a.CustomerID, nil)
	totals := profile["totals"].(map[string]any)
	if profile["isMe"] != false || profile["isFollowing"] != false || totals["activities"] != 1.0 ||
		totals["distanceKm"] != act["distanceM"].(float64)/1000 || profile["member"].(map[string]any)["fullName"] != name {
		t.Fatalf("profile %v", profile)
	}
	if mine := e.list(&a, "GET", base+"/activities", nil); len(mine) != 2 {
		t.Fatalf("my activities %d", len(mine))
	}

	social := e.obj(&b, "GET", base+"/social?q="+url.QueryEscape(name), nil)
	if s := social["suggestions"].([]any); len(s) != 1 || s[0].(map[string]any)["memberId"] != a.CustomerID ||
		s[0].(map[string]any)["name"] != name {
		t.Fatalf("social search %v", social)
	}
	e.obj(&b, "POST", base+"/follow/"+a.CustomerID, nil)
	social = e.obj(&a, "GET", base+"/social", nil)
	if f := social["followers"].([]any); len(f) != 1 || f[0].(map[string]any)["memberId"] != b.CustomerID {
		t.Fatalf("followers %v", social)
	}
	if f := e.obj(&b, "POST", base+"/follow/"+a.CustomerID, nil); f["following"] != false {
		t.Fatal(f)
	}

	// Routes and heatmap.
	e.fail(&a, "POST", base+"/routes", map[string]any{"activityId": priv["id"], "name": "Walk"}, 400, "Aktivitas ini tidak punya jejak GPS.")
	e.fail(&b, "POST", base+"/routes", map[string]any{"activityId": id, "name": "Loop"}, 404, "Aktivitas tidak ditemukan")
	route := e.obj(&a, "POST", base+"/routes", map[string]any{"activityId": id, "name": " Senayan "})
	if route["name"] != "Senayan" || route["distanceM"] != act["distanceM"] || len(route["points"].([]any)) != 121 {
		t.Fatalf("route %v", route)
	}
	if routes := e.list(&a, "GET", base+"/routes", nil); len(routes) != 1 {
		t.Fatal(routes)
	}
	if ok := e.obj(&a, "DELETE", base+"/routes/"+route["id"].(string), nil); ok["ok"] != true {
		t.Fatal(ok)
	}
	if tracks := e.obj(&a, "GET", base+"/heatmap", nil)["tracks"].([]any); len(tracks) != 1 || len(tracks[0].([]any)) != domain.HeatmapPoints {
		t.Fatalf("heatmap %v", tracks)
	}

	// Settings: train PUT and home PATCH share one row.
	defaults := e.obj(&a, "GET", base+"/settings", nil)
	if defaults["units"] != "METRIC" || defaults["bookingReminders"] != true || defaults["weeklyGoalKm"] != nil || defaults["language"] != "ID" {
		t.Fatal(defaults)
	}
	if s := e.obj(&a, "PUT", base+"/settings", map[string]any{"weeklyGoalKm": 20}); s["weeklyGoalKm"] != 20.0 || s["units"] != "METRIC" {
		t.Fatal(s)
	}
	if ok := e.obj(&a, "PATCH", "/api/member-portal/app/home/settings", map[string]any{"language": "EN"}); ok["ok"] != true {
		t.Fatal(ok)
	}
	if h := e.obj(&a, "GET", "/api/member-portal/app/home/settings", nil); h["language"] != "EN" || h["units"] != "METRIC" || h["weeklyGoalKm"] != nil {
		t.Fatal(h)
	}

	stats := e.obj(&a, "GET", base+"/stats", nil)
	weekly := stats["weekly"].([]any)
	goal := stats["goal"].(map[string]any)
	if len(weekly) != 8 || stats["totals"].(map[string]any)["activities"] != 2.0 || goal["targetKm"] != 20.0 ||
		stats["settings"].(map[string]any)["language"] != "EN" || stats["followerCount"] != 0.0 {
		t.Fatalf("stats %v", stats)
	}
	if s := e.obj(&a, "PUT", base+"/settings", map[string]any{"weeklyGoalKm": nil}); s["weeklyGoalKm"] != nil || s["language"] != "EN" {
		t.Fatal(s)
	}

	if d := e.obj(&a, "DELETE", base+"/activities/"+id, nil); d["deleted"] != true {
		t.Fatal(d)
	}
	e.fail(&a, "GET", base+"/activities/"+id, nil, 404, "Aktivitas tidak ditemukan")
}

func TestSegmentsChallengesClubs(t *testing.T) {
	e := setup(t)
	a, b := testutil.CreateMember(t), testutil.CreateMember(t)
	lat := -7.1
	points := track(150, lat)
	segment := insertID(t, "gym.athlete_segments",
		`INSERT INTO gym.athlete_segments (name, type, distance_m, location, path)
		 VALUES ('Go Test Board', 'RUN', 1000, 'Test', $1::jsonb) RETURNING id`,
		fmt.Sprintf(`[{"t":0,"lat":%v,"lng":106.808},{"t":1,"lat":%v,"lng":106.808}]`, points[0]["lat"], points[100]["lat"]))
	e.obj(&a, "POST", base+"/activities", map[string]any{"type": "RUN", "points": points})
	slow := track(150, lat)
	for i := range slow {
		slow[i]["t"] = i * 4000
	}
	e.obj(&b, "POST", base+"/activities", map[string]any{"type": "RUN", "points": slow})

	detail := e.obj(&b, "GET", base+"/segments/"+segment, nil)
	board := detail["leaderboard"].([]any)
	if len(board) != 2 || detail["myRank"] != 2.0 || board[0].(map[string]any)["memberId"] != a.CustomerID ||
		board[1].(map[string]any)["isMe"] != true {
		t.Fatalf("segment %v", detail)
	}
	var summary map[string]any
	for _, s := range e.list(&b, "GET", base+"/segments", nil) {
		if s.(map[string]any)["segment"].(map[string]any)["id"] == segment {
			summary = s.(map[string]any)
		}
	}
	if summary["effortCount"] != 2.0 || summary["bestElapsedSec"] != board[0].(map[string]any)["elapsedSec"] ||
		summary["myBestElapsedSec"] != board[1].(map[string]any)["elapsedSec"] || summary["myRank"] != 2.0 {
		t.Fatalf("segment summary %v", summary)
	}

	now := time.Now()
	challenge := insertID(t, "gym.athlete_challenges",
		`INSERT INTO gym.athlete_challenges (name, type, target_km, starts_at, ends_at)
		 VALUES ('Go Test Challenge', 'RUN', 10, $1, $2) RETURNING id`, now.Add(-24*time.Hour), now.Add(24*time.Hour))
	ended := insertID(t, "gym.athlete_challenges",
		`INSERT INTO gym.athlete_challenges (name, type, target_km, starts_at, ends_at)
		 VALUES ('Go Ended Challenge', 'ANY', 10, $1, $2) RETURNING id`, now.Add(-48*time.Hour), now.Add(-24*time.Hour))
	if j := e.obj(&a, "POST", base+"/challenges/"+challenge+"/join", nil); j["joined"] != true {
		t.Fatal(j)
	}
	e.obj(&a, "POST", base+"/challenges/"+challenge+"/join", nil) // idempotent
	var view map[string]any
	for _, c := range e.list(&a, "GET", base+"/challenges", nil) {
		info := c.(map[string]any)["challenge"].(map[string]any)
		if info["id"] == ended {
			t.Fatal("ended challenge listed")
		}
		if info["id"] == challenge {
			view = c.(map[string]any)
		}
	}
	if view["joined"] != true || view["participantCount"] != 1.0 || view["progressKm"] != 1.5 ||
		view["leaderboard"].([]any)[0].(map[string]any)["isMe"] != true {
		t.Fatalf("challenge %v", view)
	}
	if j := e.obj(&a, "DELETE", base+"/challenges/"+challenge+"/join", nil); j["joined"] != false {
		t.Fatal(j)
	}

	club := insertID(t, "gym.athlete_clubs", `INSERT INTO gym.athlete_clubs (name) VALUES ('Go Test Club') RETURNING id`)
	if j := e.obj(&b, "POST", base+"/clubs/"+club+"/toggle", nil); j["joined"] != true {
		t.Fatal(j)
	}
	var clubView map[string]any
	for _, c := range e.list(&b, "GET", base+"/clubs", nil) {
		if c.(map[string]any)["club"].(map[string]any)["id"] == club {
			clubView = c.(map[string]any)
		}
	}
	lb := clubView["weeklyLeaderboard"].([]any)
	if clubView["joined"] != true || clubView["memberCount"] != 1.0 || len(lb) != 1 || lb[0].(map[string]any)["km"] != 1.5 {
		t.Fatalf("club %v", clubView)
	}
	if j := e.obj(&b, "POST", base+"/clubs/"+club+"/toggle", nil); j["joined"] != false {
		t.Fatal(j)
	}
}

func TestWorkoutSessionsSyncIntoActivities(t *testing.T) {
	e := setup(t)
	m := testutil.CreateMember(t)
	workout := insertID(t, "",
		`INSERT INTO gym.workouts (customer_id, type, division, blocks)
		 VALUES ($1, 'FULL_SIMULATION', 'MEN_OPEN', '[{"kind":"RUN","distanceM":1000},{"kind":"STATION","distanceM":50},{"kind":"RUN","distanceM":1000}]')
		 RETURNING id`, m.CustomerID)
	session := insertID(t, "",
		`INSERT INTO gym.workout_sessions (workout_id, customer_id, status, started_at, active_sec, total_pause_sec)
		 VALUES ($1, $2, 'completed', now() - interval '2 hours', 3000, 120) RETURNING id`, workout, m.CustomerID)

	list := e.list(&m, "GET", base+"/activities", nil)
	if len(list) != 1 {
		t.Fatalf("synced %v", list)
	}
	a := list[0].(map[string]any)
	if a["type"] != "WORKOUT" || a["title"] != "HYROX simulation" || a["distanceM"] != 2000.0 ||
		a["elapsedSec"] != 3120.0 || a["movingSec"] != 3000.0 || a["visibility"] != "EVERYONE" {
		t.Fatalf("workout activity %v", a)
	}
	// Idempotent: a second load does not duplicate the session.
	if again := e.list(&m, "GET", base+"/activities", nil); len(again) != 1 {
		t.Fatalf("duplicated sync %d", len(again))
	}
	var source string
	if err := testutil.DB(t).QueryRow(context.Background(),
		`SELECT source_id::text FROM gym.athlete_activities WHERE customer_id = $1`, m.CustomerID).Scan(&source); err != nil || source != session {
		t.Fatalf("source %v %v", source, err)
	}
}
