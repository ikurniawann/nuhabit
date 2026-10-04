package gymtraining_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/gymtraining"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run every route against TEST_DATABASE_URL. Fixtures are
// created per test and removed in t.Cleanup.

type harness struct {
	t      *testing.T
	deps   module.Deps
	mux    http.Handler
	staff  testutil.Staff
	member testutil.Member
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	deps := testutil.Deps(t, nil)
	m := gymtraining.New(deps, app.GymTrainingPorts(deps))
	return &harness{
		t:    t,
		deps: deps,
		mux:  testutil.Mux(m),
		staff: testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{
			"gym.exercises": nil, "gym.races": nil, "gym.incentives": nil,
		}}),
		member: testutil.CreateMember(t),
	}
}

func (h *harness) exec(sql string, args ...any) {
	h.t.Helper()
	if _, err := h.deps.DB.Exec(context.Background(), sql, args...); err != nil {
		h.t.Fatalf("exec %q: %v", sql, err)
	}
}

func (h *harness) scalar(sql string, args ...any) string {
	h.t.Helper()
	var v string
	if err := h.deps.DB.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		h.t.Fatalf("query %q: %v", sql, err)
	}
	return v
}

type call struct {
	status int
	body   map[string]any
}

func (c call) data() map[string]any { m, _ := c.body["data"].(map[string]any); return m }
func (c call) list() []any          { l, _ := c.body["data"].([]any); return l }

func (h *harness) asStaff(method, path string, body any) call {
	h.t.Helper()
	rec, out := testutil.Do(h.t, h.mux, testutil.AsStaff(testutil.Request(method, path, body), h.staff))
	return call{rec.Code, out}
}

func (h *harness) asMember(method, path string, body any) call {
	h.t.Helper()
	rec, out := testutil.Do(h.t, h.mux, testutil.AsMember(testutil.Request(method, path, body), h.member))
	return call{rec.Code, out}
}

func expect(t *testing.T, c call, status int, errMsg string) {
	t.Helper()
	if c.status != status {
		t.Fatalf("status %d, want %d (body %v)", c.status, status, c.body)
	}
	if errMsg != "" && c.body["error"] != errMsg {
		t.Fatalf("error %q, want %q", c.body["error"], errMsg)
	}
	if errMsg == "" && status == 200 && c.body["success"] != true {
		t.Fatalf("success missing: %v", c.body)
	}
}

func TestAuthGuards(t *testing.T) {
	h := newHarness(t)
	rec, body := testutil.Do(t, h.mux, testutil.Request("GET", "/api/gym/exercises", nil))
	expect(t, call{rec.Code, body}, 401, "Authentication required")
	rec, body = testutil.Do(t, h.mux, testutil.Request("GET", "/api/member-portal/gym/workouts", nil))
	expect(t, call{rec.Code, body}, 401, "Unauthorized")

	noGrant := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"gym.packages": nil}})
	rec, body = testutil.Do(t, h.mux, testutil.AsStaff(testutil.Request("GET", "/api/gym/races", nil), noGrant))
	expect(t, call{rec.Code, body}, 403, "")
}

func TestExerciseAdmin(t *testing.T) {
	h := newHarness(t)
	code := "go_test_" + testutil.RandomHex(4)
	t.Cleanup(func() { h.exec(`DELETE FROM gym.exercises WHERE code = $1`, code) })

	list := h.asStaff("GET", "/api/gym/exercises", nil)
	expect(t, list, 200, "")
	exercises := list.data()["exercises"].([]any)
	if len(exercises) < 10 {
		t.Fatalf("expected the seeded library, got %d", len(exercises))
	}
	first := exercises[0].(map[string]any)
	if first["hyrox_station_order"] != 1.0 || first["default_spec"] == nil {
		t.Fatalf("first exercise = %v", first)
	}
	if _, ok := first["updated_at"].(string); !ok {
		t.Fatalf("updated_at = %v", first["updated_at"])
	}

	bad := h.asStaff("POST", "/api/gym/exercises", map[string]any{
		"code": code, "name": "Go Test", "category": "RUN", "difficulty": 2,
		"default_spec": map[string]any{"distanceM": -1, "reps": nil},
	})
	expect(t, bad, 400, "Data tidak valid: default_spec.distanceM")
	expect(t, h.asStaff("POST", "/api/gym/exercises", "not json"), 400, "Data tidak valid")

	payload := map[string]any{
		"code": code, "name": "  Go Test Carry ", "category": "CARRY", "difficulty": 2, "equipment": []string{" kettlebell "},
		"default_spec": map[string]any{"distanceM": 100, "reps": nil}, "video_url": "https://youtu.be/abcdef",
	}
	saved := h.asStaff("POST", "/api/gym/exercises", payload)
	expect(t, saved, 200, "")
	id := saved.data()["id"].(string)
	if name := h.scalar(`SELECT name || '|' || equipment[1] || '|' || default_spec::text FROM gym.exercises WHERE id = $1`, id); name != `Go Test Carry|kettlebell|{"reps": null, "distanceM": 100}` {
		t.Fatalf("stored %q", name)
	}

	payload["id"] = id
	payload["name"] = "Go Test Carry 2"
	expect(t, h.asStaff("POST", "/api/gym/exercises", payload), 200, "")

	dup := h.asStaff("POST", "/api/gym/exercises", map[string]any{
		"code": "ski_erg", "name": "Dup", "category": "ERG", "difficulty": 1, "default_spec": map[string]any{"distanceM": nil, "reps": nil},
	})
	expect(t, dup, 409, "Kode atau nomor stasiun sudah dipakai latihan lain")

	missing := "00000000-0000-4000-8000-000000000000"
	payload["id"] = missing
	expect(t, h.asStaff("POST", "/api/gym/exercises", payload), 404, "Latihan tidak ditemukan")

	run := h.scalar(`SELECT id::text FROM gym.exercises WHERE code = 'run'`)
	sub := h.asStaff("POST", "/api/gym/exercises/substitutions", map[string]any{
		"original_exercise_id": id, "alternative_exercise_id": run, "similarity": 0.4,
	})
	expect(t, sub, 200, "")
	subID := sub.data()["id"].(string)
	expect(t, h.asStaff("POST", "/api/gym/exercises/substitutions", map[string]any{
		"original_exercise_id": id, "alternative_exercise_id": id, "similarity": 0.4,
	}), 400, "Data tidak valid: alternative_exercise_id")
	expect(t, h.asStaff("POST", "/api/gym/exercises/substitutions", map[string]any{
		"original_exercise_id": id, "alternative_exercise_id": missing, "similarity": 0.4,
	}), 404, "Latihan tidak ditemukan")
	expect(t, h.asStaff("DELETE", "/api/gym/exercises/substitutions?id="+subID, nil), 200, "")
	expect(t, h.asStaff("DELETE", "/api/gym/exercises/substitutions?id="+subID, nil), 404, "Substitusi tidak ditemukan")

	expect(t, h.asStaff("DELETE", "/api/gym/exercises?id=nope", nil), 400, "ID tidak valid")
	expect(t, h.asStaff("DELETE", "/api/gym/exercises?id="+id, nil), 200, "")
	expect(t, h.asStaff("DELETE", "/api/gym/exercises?id="+id, nil), 404, "Latihan tidak ditemukan")
}

func TestMemberWorkoutFlow(t *testing.T) {
	h := newHarness(t)

	lib := h.asMember("GET", "/api/member-portal/app/workout/exercises", nil)
	expect(t, lib, 200, "")
	if subs := lib.data()["substitutions"].([]any); len(subs) == 0 {
		t.Fatal("expected substitution rules")
	}
	ex := lib.data()["exercises"].([]any)[0].(map[string]any)
	if _, ok := ex["defaultSpec"].(map[string]any); !ok || ex["hyroxStationOrder"] != 1.0 {
		t.Fatalf("exercise = %v", ex)
	}

	page := h.asMember("GET", "/api/member-portal/gym/workouts", nil)
	expect(t, page, 200, "")
	if len(page.data()["stations"].([]any)) != 8 || len(page.data()["workouts"].([]any)) != 0 {
		t.Fatalf("page = %v", page.data())
	}

	expect(t, h.asMember("POST", "/api/member-portal/gym/workouts", map[string]any{"type": "NOPE"}), 400, "Pilihan workout tidak valid")
	gen := h.asMember("POST", "/api/member-portal/gym/workouts", map[string]any{"type": "FULL_SIMULATION", "division": "MEN_OPEN"})
	expect(t, gen, 200, "")
	workout := gen.data()["workout"].(map[string]any)
	workoutID := workout["id"].(string)
	blocks := workout["blocks"].([]any)
	if len(blocks) != 16 || workout["total_target_sec"] != float64(8*330+1830) || workout["available_equipment"] != nil {
		t.Fatalf("workout = %v", workout)
	}
	if ids := workout["excluded_exercise_ids"].([]any); len(ids) != 0 {
		t.Fatalf("excluded = %v", ids)
	}

	// Swap the SkiErg station (block 2) for its substitute.
	rowing := h.scalar(`SELECT id::text FROM gym.exercises WHERE code = 'rowing'`)
	path := "/api/member-portal/app/workout/workouts/" + workoutID
	expect(t, h.asMember("PATCH", path, map[string]any{"order": 1, "exercise_id": rowing}), 409, "Blok lari tidak bisa diganti.")
	expect(t, h.asMember("PATCH", path, map[string]any{"order": 99, "exercise_id": rowing}), 404, "Blok tidak ditemukan")
	expect(t, h.asMember("PATCH", path, map[string]any{"order": 0}), 400, "Pilihan latihan tidak valid")
	swapped := h.asMember("PATCH", path, map[string]any{"order": 2, "exercise_id": rowing})
	expect(t, swapped, 200, "")
	block := swapped.data()["blocks"].([]any)[1].(map[string]any)
	if block["exerciseId"] != rowing || block["originalExerciseName"] != "SkiErg" || block["weightNote"] != nil || block["similarity"] != 0.85 {
		t.Fatalf("swapped block = %v", block)
	}
	expect(t, h.asMember("PATCH", path, map[string]any{"order": 4, "exercise_id": rowing}), 409, "Latihan itu bukan pengganti stasiun ini.")
	expect(t, h.asMember("GET", path, nil), 200, "")
	expect(t, h.asMember("GET", "/api/member-portal/app/workout/workouts/00000000-0000-4000-8000-000000000000", nil), 404, "Workout tidak ditemukan")
	expect(t, h.asMember("GET", "/api/member-portal/app/workout/workouts/x", nil), 400, "ID tidak valid")

	// Session lifecycle.
	expect(t, h.asMember("POST", "/api/member-portal/gym/workouts/00000000-0000-4000-8000-000000000000/start", nil), 404, "Workout tidak ditemukan")
	started := h.asMember("POST", "/api/member-portal/gym/workouts/"+workoutID+"/start", nil)
	expect(t, started, 200, "")
	sessionID := started.data()["id"].(string)
	if started.data()["status"] != "started" || started.data()["started_at"] == nil || started.data()["paused_at"] != nil {
		t.Fatalf("session = %v", started.data())
	}
	sp := "/api/member-portal/gym/workouts/sessions/" + sessionID
	expect(t, h.asMember("POST", sp, map[string]any{"action": "jump"}), 400, "Aksi sesi tidak valid")
	expect(t, h.asMember("POST", sp, map[string]any{"action": "resume"}), 409, "Status sesi tidak bisa diubah ke langkah itu.")
	expect(t, h.asMember("POST", sp, map[string]any{"action": "pause"}), 200, "")
	expect(t, h.asMember("POST", sp, map[string]any{"action": "resume"}), 200, "")
	rec := h.asMember("POST", sp, map[string]any{"action": "record", "order": 1, "duration_sec": 300.4})
	expect(t, rec, 200, "")
	if rec.data()["current_block"] != 2.0 || rec.data()["pause_count"] != 1.0 {
		t.Fatalf("recorded = %v", rec.data())
	}
	expect(t, h.asMember("POST", sp, map[string]any{"action": "record", "order": 17, "duration_sec": 1}), 409, "Blok itu tidak ada di workout ini.")
	results := []map[string]any{}
	for order := 1; order <= 16; order++ {
		results = append(results, map[string]any{"order": order, "duration_sec": 300})
	}
	done := h.asMember("POST", sp, map[string]any{"action": "complete", "block_results": results})
	expect(t, done, 200, "")
	if done.data()["status"] != "completed" || done.data()["active_sec"] != 4800.0 || done.data()["ended_at"] == nil {
		t.Fatalf("completed = %v", done.data())
	}
	expect(t, h.asMember("POST", sp, map[string]any{"action": "pause"}), 409, "Status sesi tidak bisa diubah ke langkah itu.")
	got := h.asMember("GET", sp, nil)
	expect(t, got, 200, "")
	if len(got.data()["block_results"].([]any)) != 16 {
		t.Fatalf("session = %v", got.data())
	}
	expect(t, h.asMember("GET", "/api/member-portal/gym/workouts/sessions/00000000-0000-4000-8000-000000000000", nil), 404, "Sesi tidak ditemukan")

	history := h.asMember("GET", "/api/member-portal/gym/workouts", nil).data()["workouts"].([]any)
	if len(history) != 1 || len(history[0].(map[string]any)["sessions"].([]any)) != 1 {
		t.Fatalf("history = %v", history)
	}

	// The completed full simulation drives the race prediction.
	mine := h.asMember("GET", "/api/member-portal/app/workout/races/mine", nil)
	expect(t, mine, 200, "")
	if mine.data()["simulation_count"] != 1.0 {
		t.Fatalf("mine = %v", mine.data())
	}
	overview := h.asMember("GET", "/api/member-portal/gym/races", nil)
	expect(t, overview, 200, "")
	if overview.data()["prediction_sec"] != float64(4656) || overview.data()["best_simulation_sec"] != 4800.0 || overview.data()["activities_last_28d"] != 1.0 {
		t.Fatalf("overview = %v", overview.data())
	}
}

func TestRaces(t *testing.T) {
	h := newHarness(t)
	name := "Go Test Race " + testutil.RandomHex(3)
	t.Cleanup(func() { h.exec(`DELETE FROM gym.race_events WHERE name LIKE $1`, name+"%") })
	starts := time.Now().Add(30 * 24 * time.Hour).UTC().Format("2006-01-02T15:04Z")
	ends := time.Now().Add(31 * 24 * time.Hour).UTC().Format(time.RFC3339)

	race := map[string]any{"name": name, "country": "Indonesia", "region": "ASIA", "city": "Kuala Lumpur",
		"starts_at": starts, "ends_at": ends, "status": "registration_open"}
	expect(t, h.asStaff("POST", "/api/gym/races", map[string]any{"name": name, "country": "Indonesia", "region": "ASIA",
		"city": "Jakarta", "starts_at": ends, "ends_at": starts, "status": "announced"}), 400, "Data tidak valid: ends_at")
	saved := h.asStaff("POST", "/api/gym/races", race)
	expect(t, saved, 200, "")
	raceID := saved.data()["id"].(string)

	list := h.asStaff("GET", "/api/gym/races", nil)
	expect(t, list, 200, "")
	var row map[string]any
	for _, item := range list.list() {
		if m := item.(map[string]any); m["id"] == raceID {
			row = m
		}
	}
	if row == nil || row["training_count"] != 0.0 || row["image_url"] != nil || row["venue"] != "" {
		t.Fatalf("admin row = %v", row)
	}

	expect(t, h.asMember("POST", "/api/member-portal/gym/races", map[string]any{"race_event_id": raceID}), 400, "Data race tidak valid")
	reg := h.asMember("POST", "/api/member-portal/gym/races", map[string]any{"race_event_id": raceID, "division": "MEN_OPEN", "goal_sec": 5400})
	expect(t, reg, 200, "")
	entryID := reg.data()["id"].(string)
	expect(t, h.asMember("POST", "/api/member-portal/gym/races", map[string]any{"race_event_id": raceID, "division": "MEN_OPEN"}), 409, "Kamu sudah menargetkan race ini")

	cal := h.asMember("GET", "/api/member-portal/app/workout/races?region=ASIA", nil)
	expect(t, cal, 200, "")
	found := false
	for _, item := range cal.list() {
		if m := item.(map[string]any); m["id"] == raceID {
			found = m["my_entry_id"] == entryID && m["entrant_count"] == 1.0
		}
	}
	if !found {
		t.Fatalf("calendar = %v", cal.list())
	}
	expect(t, h.asMember("GET", "/api/member-portal/app/workout/races?scope=", nil), 400, "Filter race tidak valid")
	detail := h.asMember("GET", "/api/member-portal/app/workout/races/"+raceID, nil)
	expect(t, detail, 200, "")
	if detail.data()["my_race"].(map[string]any)["goal_sec"] != 5400.0 {
		t.Fatalf("detail = %v", detail.data())
	}
	expect(t, h.asMember("GET", "/api/member-portal/app/workout/races/00000000-0000-4000-8000-000000000000", nil), 404, "Race tidak ditemukan")

	overview := h.asMember("GET", "/api/member-portal/gym/races", nil)
	expect(t, overview, 200, "")
	my := overview.data()["my_races"].([]any)[0].(map[string]any)
	if my["days_until"] != 30.0 || my["analysis"] != nil || my["event"].(map[string]any)["name"] != name {
		t.Fatalf("my race = %v", my)
	}

	entrants := h.asStaff("GET", "/api/gym/races/"+raceID+"/entrants", nil)
	expect(t, entrants, 200, "")
	if e := entrants.list()[0].(map[string]any); e["name"] != "Go Test Member" || e["phone"] != h.member.Phone {
		t.Fatalf("entrant = %v", e)
	}

	ep := "/api/member-portal/gym/races/" + entryID
	expect(t, h.asMember("PATCH", ep, map[string]any{"goal_sec": nil, "division": "MEN_PRO"}), 200, "")
	if v := h.scalar(`SELECT division || '|' || COALESCE(goal_sec::text, 'null') FROM gym.member_races WHERE id = $1`, entryID); v != "MEN_PRO|null" {
		t.Fatalf("entry = %s", v)
	}
	expect(t, h.asMember("PATCH", ep, map[string]any{"result_sec": 5300}), 200, "")
	expect(t, h.asMember("PATCH", ep, map[string]any{"result_sec": 5000}), 409, "Hasil race ini sudah dicatat.")
	mine := h.asMember("GET", "/api/member-portal/app/workout/races/mine", nil)
	if a := mine.data()["my_races"].([]any)[0].(map[string]any)["analysis"].(map[string]any); a["vsGoalSec"] != nil || a["achievedGoal"] != nil {
		t.Fatalf("analysis = %v", a)
	}

	del := h.asStaff("DELETE", "/api/gym/races?id="+raceID, nil)
	expect(t, del, 200, "")
	if del.data()["outcome"] != "cancelled" {
		t.Fatalf("delete = %v", del.data())
	}
	expect(t, h.asMember("POST", "/api/member-portal/gym/races", map[string]any{"race_event_id": raceID, "division": "MEN_OPEN"}), 409, "Race ini sudah selesai atau dibatalkan")

	race["name"] = name + " B"
	other := h.asStaff("POST", "/api/gym/races", race).data()["id"].(string)
	gone := h.asStaff("DELETE", "/api/gym/races?id="+other, nil)
	if gone.data()["outcome"] != "deleted" {
		t.Fatalf("delete = %v", gone.data())
	}
	expect(t, h.asStaff("DELETE", "/api/gym/races?id="+other, nil), 404, "Race tidak ditemukan")
}

func TestIncentives(t *testing.T) {
	h := newHarness(t)
	coachName := "Go Test Coach " + testutil.RandomHex(3)
	coachID := h.scalar(`INSERT INTO gym.coaches (name) VALUES ($1) RETURNING id::text`, coachName)
	classTypeID := h.scalar(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ($1, 60, 1, 4) RETURNING id::text`, "Go Test Class "+testutil.RandomHex(3))
	sessionID := h.scalar(`INSERT INTO gym.class_sessions (class_type_id, coach_id, starts_at, ends_at, capacity, credit_cost,
		booking_opens_at, booking_closes_at, status)
		VALUES ($1, $2, '2031-03-10T10:00:00+07', '2031-03-10T11:00:00+07', 4, 1, '2031-03-01', '2031-03-10', 'completed')
		RETURNING id::text`, classTypeID, coachID)
	for _, status := range []string{"checked_in", "completed", "completed", "no_show", "cancelled"} {
		h.exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, $3)`, sessionID, h.member.CustomerID, status)
	}
	t.Cleanup(func() {
		h.exec(`DELETE FROM gym.coach_payouts WHERE coach_id = $1`, coachID)
		h.exec(`DELETE FROM gym.class_sessions WHERE id = $1`, sessionID)
		h.exec(`DELETE FROM gym.coaches WHERE id = $1`, coachID)
		h.exec(`DELETE FROM gym.class_types WHERE id = $1`, classTypeID)
	})

	scheme := map[string]any{"name": "Go Test Scheme", "coach_id": coachID, "session_fee_idr": 100000, "per_attendee_idr": 10000,
		"full_class_bonus_idr": 20000, "full_class_threshold_percent": 75, "no_show_penalty_idr": 5000,
		"rates": []map[string]any{{"class_type_id": classTypeID, "session_fee_idr": 120000, "per_attendee_idr": 12000}}}
	dupRates := map[string]any{}
	for k, v := range scheme {
		dupRates[k] = v
	}
	dupRates["rates"] = []map[string]any{scheme["rates"].([]map[string]any)[0], scheme["rates"].([]map[string]any)[0]}
	expect(t, h.asStaff("POST", "/api/gym/incentives/schemes", dupRates), 400, "Data tidak valid: rates")
	saved := h.asStaff("POST", "/api/gym/incentives/schemes", scheme)
	expect(t, saved, 200, "")
	schemeID := saved.data()["id"].(string)
	expect(t, h.asStaff("POST", "/api/gym/incentives/schemes", scheme), 409, "Coach ini sudah punya skema sendiri")
	expect(t, h.asStaff("POST", "/api/gym/incentives/schemes", map[string]any{"name": "Dup default", "coach_id": nil,
		"session_fee_idr": 0, "per_attendee_idr": 0, "full_class_bonus_idr": 0, "full_class_threshold_percent": 80,
		"no_show_penalty_idr": 0}), 409, "Skema default sudah ada")

	form := h.asStaff("GET", "/api/gym/incentives/schemes", nil)
	expect(t, form, 200, "")
	schemes := form.data()["schemes"].([]any)
	if schemes[0].(map[string]any)["isDefault"] != true {
		t.Fatalf("default scheme should come first: %v", schemes[0])
	}
	var mine map[string]any
	for _, s := range schemes {
		if m := s.(map[string]any); m["id"] == schemeID {
			mine = m
		}
	}
	if mine == nil || mine["coachName"] != coachName || len(mine["rates"].([]any)) != 1 || mine["sessionFeeIdr"] != 100000.0 {
		t.Fatalf("scheme = %v", mine)
	}

	expect(t, h.asStaff("GET", "/api/gym/incentives/statements?month=2031-3", nil), 400, "Bulan harus berformat YYYY-MM")
	expect(t, h.asStaff("GET", "/api/gym/incentives/statements?month=2031-03&coach_id=x", nil), 400, "ID coach tidak valid")
	st := h.asStaff("GET", "/api/gym/incentives/statements?month=2031-03&coach_id="+coachID, nil)
	expect(t, st, 200, "")
	statement := st.list()[0].(map[string]any)
	line := statement["lines"].([]any)[0].(map[string]any)
	// 120k + 3 × 12k + bonus 20k (3/4 = 75%) − 1 × 5k.
	if line["totalIdr"] != 171000.0 || line["booked"] != 4.0 || line["startsAt"] != "2031-03-10T03:00:00.000Z" ||
		statement["schemeName"] != "Go Test Scheme" || statement["payout"] != nil {
		t.Fatalf("statement = %v", statement)
	}

	expect(t, h.asStaff("POST", "/api/gym/incentives/payouts", map[string]any{"coach_id": coachID, "month": "2031-13"}), 400, "Data tidak valid: month")
	created := h.asStaff("POST", "/api/gym/incentives/payouts", map[string]any{"coach_id": coachID, "month": "2031-03"})
	expect(t, created, 200, "")
	payoutID := created.data()["id"].(string)
	expect(t, h.asStaff("POST", "/api/gym/incentives/payouts", map[string]any{"coach_id": coachID, "month": "2031-03"}), 409,
		"Coach ini sudah punya payout aktif untuk bulan tersebut")

	pp := "/api/gym/incentives/payouts/" + payoutID
	expect(t, h.asStaff("POST", pp, map[string]any{"action": "pay", "payment_reference": "TRF"}), 409, "Payout berstatus draf tidak bisa dibayar.")
	expect(t, h.asStaff("POST", pp, map[string]any{"action": "approve"}), 200, "")
	expect(t, h.asStaff("POST", pp, map[string]any{"action": "pay", "payment_reference": "  "}), 409, "Referensi pembayaran wajib diisi.")
	expect(t, h.asStaff("POST", pp, map[string]any{"action": "pay", "payment_reference": " TRF-1 "}), 200, "")
	expect(t, h.asStaff("POST", pp, map[string]any{"action": "void", "note": "x"}), 409, "Payout berstatus dibayar tidak bisa dibatalkan.")

	detail := h.asStaff("GET", pp, nil)
	expect(t, detail, 200, "")
	d := detail.data()
	if d["status"] != "paid" || d["payment_reference"] != "TRF-1" || d["coach_name"] != coachName || d["month"] != "2031-03" ||
		d["total_idr"] != 171000.0 || d["paid_at"] == nil || d["statement"].(map[string]any)["coachName"] != coachName {
		t.Fatalf("payout = %v", d)
	}
	list := h.asStaff("GET", "/api/gym/incentives/payouts?month=2031-03", nil)
	expect(t, list, 200, "")
	if row := list.list()[0].(map[string]any); row["id"] != payoutID || row["sessions"] != 1.0 || row["coach_name"] != coachName {
		t.Fatalf("payouts = %v", list.list())
	}
	expect(t, h.asStaff("GET", "/api/gym/incentives/payouts?month=bad", nil), 400, "Bulan harus berformat YYYY-MM")
	expect(t, h.asStaff("GET", "/api/gym/incentives/payouts/00000000-0000-4000-8000-000000000000", nil), 404, "Payout tidak ditemukan")

	st = h.asStaff("GET", "/api/gym/incentives/statements?month=2031-03&coach_id="+coachID, nil)
	if p := st.list()[0].(map[string]any)["payout"].(map[string]any); p["id"] != payoutID || p["status"] != "paid" {
		t.Fatalf("statement payout = %v", p)
	}

	expect(t, h.asStaff("DELETE", "/api/gym/incentives/schemes?id="+schemeID, nil), 200, "")
	defaultID := h.scalar(`SELECT id::text FROM gym.incentive_schemes WHERE is_default`)
	expect(t, h.asStaff("DELETE", "/api/gym/incentives/schemes?id="+defaultID, nil), 404,
		"Skema tidak ditemukan atau skema default (tidak bisa dihapus)")
}
