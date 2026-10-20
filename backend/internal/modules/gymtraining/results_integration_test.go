package gymtraining_test

import (
	"net/http"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// splits8 is an array of 8 equal split seconds.
func splits8(sec int) []any {
	out := make([]any, 8)
	for i := range out {
		out[i] = sec
	}
	return out
}

func (h *harness) as(m testutil.Member, method, path string, body any) call {
	h.t.Helper()
	rec, out := testutil.Do(h.t, h.mux, testutil.AsMember(testutil.Request(method, path, body), m))
	return call{rec.Code, out}
}

// boardNames lists "rank:name" for the rows of the given members.
func boardNames(c call, names ...string) []string {
	want := map[string]bool{}
	for _, n := range names {
		want[n] = true
	}
	var out []string
	for _, item := range c.data()["rows"].([]any) {
		row := item.(map[string]any)
		if name := row["name"].(string); want[name] {
			out = append(out, string(rune('0'+int(row["rank"].(float64))))+":"+name)
		}
	}
	return out
}

func TestHyroxResults(t *testing.T) {
	h := newHarness(t)
	ana, budi := h.member, testutil.CreateMember(t)
	anaName, budiName := "Ana "+testutil.RandomHex(3), "Budi "+testutil.RandomHex(3)
	h.exec(`UPDATE pos.pos_customers SET name = $2 WHERE id = $1`, ana.CustomerID, anaName)
	h.exec(`UPDATE pos.pos_customers SET name = $2 WHERE id = $1`, budi.CustomerID, budiName)

	name := "Go Test Result Race " + testutil.RandomHex(3)
	t.Cleanup(func() { h.exec(`DELETE FROM gym.race_events WHERE name LIKE $1`, name+"%") })
	race := map[string]any{"name": name, "country": "Indonesia", "region": "ASIA", "city": "Jakarta",
		"starts_at": time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339),
		"ends_at":   time.Now().Add(6 * time.Hour).UTC().Format(time.RFC3339), "status": "ongoing"}
	raceID := h.asStaff("POST", "/api/gym/races", race).data()["id"].(string)
	race["name"], race["starts_at"] = name+" Later", time.Now().Add(48*time.Hour).UTC().Format(time.RFC3339)
	race["ends_at"] = time.Now().Add(50 * time.Hour).UTC().Format(time.RFC3339)
	laterID := h.asStaff("POST", "/api/gym/races", race).data()["id"].(string)

	anaEntry := h.as(ana, "POST", "/api/member-portal/gym/races", map[string]any{"race_event_id": raceID, "division": "MEN_OPEN"}).data()["id"].(string)
	budiEntry := h.as(budi, "POST", "/api/member-portal/gym/races", map[string]any{"race_event_id": raceID, "division": "MEN_OPEN"}).data()["id"].(string)

	// The form offers the started race with the entry's division.
	form := h.as(ana, "GET", "/api/member-portal/app/workout/results", nil)
	expect(t, form, 200, "")
	offered := false
	for _, item := range form.data()["races"].([]any) {
		r := item.(map[string]any)
		if r["id"] == laterID {
			t.Fatalf("a race that has not started is offered: %v", r)
		}
		offered = offered || (r["id"] == raceID && r["division"] == "MEN_OPEN")
	}
	if !offered || len(form.data()["results"].([]any)) != 0 {
		t.Fatalf("form = %v", form.data())
	}

	// Validation.
	post := func(m testutil.Member, body map[string]any) call {
		return h.as(m, "POST", "/api/member-portal/gym/results", body)
	}
	expect(t, post(ana, map[string]any{"source": "race", "division": "MEN_OPEN", "official_total_sec": 4500}), 400, "Data hasil tidak valid: race_event_id")
	expect(t, post(ana, map[string]any{"source": "race", "race_event_id": raceID, "division": "MEN_OPEN", "run_sec": splits8(300)}), 400,
		"Isi total resmi atau lengkapi 8 lari dan 8 stasiun.")
	expect(t, post(ana, map[string]any{"source": "race", "race_event_id": raceID, "division": "MEN_OPEN", "run_sec": []any{300}}), 400,
		"Data hasil tidak valid: run_sec")
	expect(t, post(ana, map[string]any{"source": "race", "race_event_id": laterID, "division": "MEN_OPEN", "official_total_sec": 4500}), 409,
		"Hasil bisa dicatat setelah race dimulai.")

	// Ana logs full splits (sum 4440) with an official total 60 s off.
	full := map[string]any{"source": "race", "race_event_id": raceID, "division": "MEN_OPEN", "age_group": "30-34",
		"run_sec": splits8(300), "station_sec": splits8(240), "roxzone_sec": 120, "official_total_sec": 4500}
	created := post(ana, full)
	expect(t, created, 200, "")
	anaResult := created.data()["id"].(string)
	expect(t, post(ana, full), 409, "Hasil race ini sudah dicatat. Ubah hasil yang ada.")
	if v := h.scalar(`SELECT total_sec || '|' || splits_total_sec || '|' || total_mismatch || '|' || station_sec[8]
		FROM gym.hyrox_results WHERE id = $1`, anaResult); v != "4500|4440|true|240" {
		t.Fatalf("stored = %s", v)
	}
	if v := h.scalar(`SELECT status || '|' || result_sec FROM gym.member_races WHERE id = $1`, anaEntry); v != "raced|4500" {
		t.Fatalf("race entry = %s", v)
	}
	if entry := h.as(ana, "GET", "/api/member-portal/app/workout/races/"+raceID, nil).data()["my_race"].(map[string]any); entry["result_id"] != anaResult {
		t.Fatalf("race entry = %v", entry)
	}

	detail := h.as(ana, "GET", "/api/member-portal/app/workout/results/"+anaResult, nil)
	expect(t, detail, 200, "")
	splits := detail.data()["splits"].([]any)
	first, total := splits[0].(map[string]any), splits[16].(map[string]any)
	if len(splits) != 17 || first["key"] != "run1" || first["sec"] != 300.0 || first["previous_best_sec"] != nil ||
		first["is_pr"] != false || first["gym_average_sec"] == nil || total["key"] != "total" || total["sec"] != 4500.0 {
		t.Fatalf("detail splits = %v", splits)
	}
	expect(t, h.as(budi, "GET", "/api/member-portal/app/workout/results/"+anaResult, nil), 404, "Hasil tidak ditemukan")

	// Budi logs a total through the race entry, as older clients do.
	expect(t, h.as(budi, "PATCH", "/api/member-portal/gym/races/"+budiEntry, map[string]any{"result_sec": 4300}), 200, "")
	budiResult := h.scalar(`SELECT id::text FROM gym.hyrox_results WHERE member_race_id = $1`, budiEntry)

	// A full simulation becomes Ana's second result: faster runs and total are PRs.
	workoutID := h.as(ana, "POST", "/api/member-portal/gym/workouts", map[string]any{"type": "FULL_SIMULATION", "division": "MEN_OPEN"}).
		data()["workout"].(map[string]any)["id"].(string)
	sessionID := h.as(ana, "POST", "/api/member-portal/gym/workouts/"+workoutID+"/start", nil).data()["id"].(string)
	blocks := []map[string]any{}
	for order := 1; order <= 16; order++ {
		blocks = append(blocks, map[string]any{"order": order, "duration_sec": 250})
	}
	expect(t, h.as(ana, "POST", "/api/member-portal/gym/workouts/sessions/"+sessionID, map[string]any{"action": "complete", "block_results": blocks}), 200, "")
	sims := h.as(ana, "GET", "/api/member-portal/app/workout/results", nil).data()["simulations"].([]any)
	sim := sims[0].(map[string]any)
	if len(sims) != 1 || sim["session_id"] != sessionID || sim["station_sec"].([]any)[7] != 250.0 || sim["run_sec"].([]any)[0] != 250.0 {
		t.Fatalf("simulations = %v", sims)
	}
	simBody := map[string]any{"source": "simulation", "workout_session_id": sessionID, "division": "MEN_OPEN",
		"run_sec": sim["run_sec"], "station_sec": sim["station_sec"]}
	simResult := post(ana, simBody)
	expect(t, simResult, 200, "")
	simID := simResult.data()["id"].(string)
	expect(t, post(ana, simBody), 409, "Simulasi ini sudah dicatat.")
	if v := h.scalar(`SELECT array_to_string(notified_prs, ',') FROM gym.hyrox_results WHERE id = $1`, simID); v != "run1,run2,run3,run4,run5,run6,run7,run8,total" {
		t.Fatalf("notified PRs = %s", v)
	}
	notices := func() string {
		return h.scalar(`SELECT count(*)::text FROM crm.member_notifications WHERE customer_id = $1 AND type = 'hyrox_pr'`, ana.CustomerID)
	}
	if n := notices(); n != "1" {
		t.Fatalf("%s PR notifications, want 1", n)
	}

	// Editing in a faster SkiErg notifies only that PR and needs verifying again.
	h.exec(`UPDATE gym.hyrox_results SET verified_at = now(), verified_by = $2 WHERE id = $1`, simID, h.staff.UserID)
	edited := simBody
	edited["station_sec"] = append([]any{200}, splits8(250)[1:]...)
	expect(t, h.as(budi, "PUT", "/api/member-portal/gym/results/"+simID, edited), 404, "Hasil tidak ditemukan")
	expect(t, h.as(ana, "PUT", "/api/member-portal/gym/results/"+simID, edited), 200, "")
	expect(t, h.as(ana, "PUT", "/api/member-portal/gym/results/"+simID, edited), 200, "")
	if n := notices(); n != "2" {
		t.Fatalf("%s PR notifications, want 2", n)
	}
	if v := h.scalar(`SELECT (verified_at IS NULL) || '|' || total_sec FROM gym.hyrox_results WHERE id = $1`, simID); v != "true|3950" {
		t.Fatalf("edited = %s", v)
	}
	simDetail := h.as(ana, "GET", "/api/member-portal/app/workout/results/"+simID, nil).data()["splits"].([]any)
	if s := simDetail[1].(map[string]any); s["key"] != "station1" || s["is_pr"] != true || s["previous_best_sec"] != 240.0 {
		t.Fatalf("station1 = %v", s)
	}

	// Staff verify Ana's race result; the default board counts verified results only.
	list := h.asStaff("GET", "/api/gym/races/results?race_id="+raceID+"&verified=false", nil)
	expect(t, list, 200, "")
	if rows := list.list(); len(rows) != 2 || rows[0].(map[string]any)["name"] == nil {
		t.Fatalf("results = %v", rows)
	}
	expect(t, h.asStaff("GET", "/api/gym/races/results?verified=maybe", nil), 400, "Filter verifikasi tidak valid")
	expect(t, h.asStaff("POST", "/api/gym/races/results/"+anaResult+"/verify", map[string]any{}), 400, "Data tidak valid: verified")
	expect(t, h.asStaff("POST", "/api/gym/races/results/00000000-0000-4000-8000-000000000000/verify", map[string]any{"verified": true}), 404, "Hasil tidak ditemukan")
	expect(t, h.asStaff("POST", "/api/gym/races/results/"+anaResult+"/verify", map[string]any{"verified": true}), 200, "")

	board := "/api/gym/races/leaderboard?race_id=" + raceID
	if got := boardNames(h.asStaff("GET", board, nil), anaName, budiName); len(got) != 1 || got[0] != "1:"+anaName {
		t.Fatalf("verified board = %v", got)
	}
	withPending := h.asStaff("GET", board+"&include_unverified=true", nil)
	if got := boardNames(withPending, anaName, budiName); len(got) != 2 || got[0] != "1:"+budiName || got[1] != "2:"+anaName {
		t.Fatalf("board with unverified = %v", got)
	}
	if withPending.data()["rows"].([]any)[0].(map[string]any)["customer_id"] == nil {
		t.Fatal("staff rows carry the customer id")
	}
	expect(t, h.asStaff("GET", board+"&division=KIDS", nil), 400, "Filter leaderboard tidak valid")
	expect(t, h.asStaff("GET", board+"&station=9", nil), 400, "Filter leaderboard tidak valid")

	// Members see their own row flagged and no customer ids.
	mine := h.as(ana, "GET", "/api/member-portal/app/workout/leaderboard?include_unverified=true&race_id="+raceID, nil)
	expect(t, mine, 200, "")
	for _, item := range mine.data()["rows"].([]any) {
		row := item.(map[string]any)
		if row["customer_id"] != nil || (row["name"] == anaName) != (row["is_me"] == true) {
			t.Fatalf("member row = %v", row)
		}
	}
	if mine.data()["my_rank"] != 2.0 || mine.data()["hidden"] != false {
		t.Fatalf("member board = %v", mine.data())
	}

	// Station board: Ana's best SkiErg is the edited simulation.
	skierg := h.as(ana, "GET", "/api/member-portal/app/workout/leaderboard?include_unverified=true&station=1&division=MEN_OPEN", nil)
	for _, item := range skierg.data()["rows"].([]any) {
		if row := item.(map[string]any); row["is_me"] == true && (row["value_sec"] != 200.0 || row["result_id"] != simID) {
			t.Fatalf("SkiErg row = %v", row)
		}
	}

	// Budi turns leaderboards off: he is left out, and his own view says so.
	h.exec(`INSERT INTO gym.athlete_settings (customer_id, show_on_leaderboard) VALUES ($1, false)`, budi.CustomerID)
	if got := boardNames(h.asStaff("GET", board+"&include_unverified=true", nil), anaName, budiName); len(got) != 1 || got[0] != "1:"+anaName {
		t.Fatalf("board without Budi = %v", got)
	}
	hidden := h.as(budi, "GET", "/api/member-portal/app/workout/leaderboard?include_unverified=true", nil)
	if hidden.data()["hidden"] != true || hidden.data()["my_rank"] != nil {
		t.Fatalf("Budi's board = %v", hidden.data())
	}
	if v := h.scalar(`SELECT official_total_sec || '|' || total_sec FROM gym.hyrox_results WHERE id = $1`, budiResult); v != "4300|4300" {
		t.Fatalf("Budi's result = %s", v)
	}
	if code := h.as(budi, "GET", "/api/member-portal/app/workout/leaderboard?year=1999", nil).status; code != http.StatusBadRequest {
		t.Fatalf("year 1999: status %d", code)
	}
}
