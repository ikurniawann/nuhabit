package gymscheduling

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// The coach portal shows only the caller's classes, and its update grant
// takes attendance in those classes only.
func TestCoachPortal(t *testing.T) {
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	unlinked := testutil.CreateStaff(t, testutil.StaffOptions{})
	f := newFixture(t)
	coach := f.asStaff("POST", "/api/gym/coaches", map[string]any{"name": "Go Coach " + testutil.RandomHex(3), "user_id": staff.UserID})
	coachID, _ := coach.data()["id"].(string)
	if coachID == "" {
		t.Fatalf("create coach: %s", coach.Raw)
	}
	classTypeID, _ := f.classType(1)
	now := time.Now()
	mine := f.session(classTypeID, now.Add(-5*time.Minute), 5)
	past := f.session(classTypeID, now.Add(3*time.Hour), 5)
	other := f.session(classTypeID, now.Add(time.Hour), 5)
	f.exec(`UPDATE gym.class_sessions SET coach_id = $2 WHERE id = ANY($1::uuid[])`, []string{mine, past}, coachID)
	f.exec(`UPDATE gym.class_sessions SET status = 'completed', starts_at = starts_at - interval '51 hours',
		ends_at = ends_at - interval '51 hours' WHERE id = $1`, past)
	for _, status := range []string{"completed", "no_show", "no_show"} {
		f.exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, $3)`, past, f.member(0), status)
	}

	grants := map[string][]string{"gym.my-classes": {"read", "update"}}
	from := now.Add(-72 * time.Hour).UTC().Format(time.RFC3339)
	listed := f.asGrants(staff.UserID, grants, "GET", "/api/gym/my-classes?from="+from, nil)
	sessions, _ := listed.data()["sessions"].([]any)
	if listed.Status != 200 || listed.data()["coach"].(map[string]any)["id"] != coachID || len(sessions) != 2 ||
		!hasRow(sessions, "id", past) || !hasRow(sessions, "id", mine) {
		t.Fatalf("my classes: %s", listed.Raw)
	}
	for _, raw := range sessions {
		if s := raw.(map[string]any); s["id"] == past && (s["no_show_count"] != 2.0 || s["checked_in_count"] != 1.0) {
			t.Fatalf("past attendance: %v", s)
		}
	}
	if none := f.asGrants(unlinked.UserID, grants, "GET", "/api/gym/my-classes", nil); none.data()["coach"] != nil ||
		len(none.data()["sessions"].([]any)) != 0 {
		t.Fatalf("unlinked portal: %s", none.Raw)
	}

	if res := f.asGrants(staff.UserID, grants, "GET", "/api/gym/my-classes/sessions/"+mine, nil); res.Status != 200 ||
		res.data()["session"].(map[string]any)["id"] != mine {
		t.Fatalf("own session: %s", res.Raw)
	}
	expectError(t, f.asGrants(staff.UserID, grants, "GET", "/api/gym/my-classes/sessions/"+other, nil), 404, "Sesi tidak ditemukan")
	expectError(t, f.asGrants(unlinked.UserID, grants, "GET", "/api/gym/my-classes/sessions/"+mine, nil), 404, "Sesi tidak ditemukan")

	member := f.member(3)
	book := func(session string) string {
		res := f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": session, "customer_id": member, "override_window": true})
		id, _ := res.data()["bookingId"].(string)
		if id == "" {
			t.Fatalf("book: %s", res.Raw)
		}
		return id
	}
	own, foreign := book(mine), book(other)
	expectError(t, f.asGrants(staff.UserID, grants, "POST", "/api/gym/bookings/"+foreign, map[string]any{"action": "check_in"}), 404,
		"Booking tidak ditemukan")
	if res := f.asGrants(staff.UserID, grants, "POST", "/api/gym/bookings/"+own, map[string]any{"action": "check_in"}); res.Status != 200 ||
		res.data()["decision"] != "allowed" {
		t.Fatalf("check-in in own class: %s", res.Raw)
	}
	readOnly := map[string][]string{"gym.my-classes": {"read"}}
	if res := f.asGrants(staff.UserID, readOnly, "POST", "/api/gym/bookings/"+own, map[string]any{"action": "no_show"}); res.Status != 403 {
		t.Fatalf("no-show without update: %s", res.Raw)
	}
	if res := f.asGrants(staff.UserID, grants, "POST", "/api/gym/bookings/"+own, map[string]any{"action": "cancel"}); res.Status != 403 {
		t.Fatalf("cancel from the portal: %s", res.Raw)
	}
}

// One coach's week: the sessions and the workload of the week and month.
func TestCoachSchedule(t *testing.T) {
	f := newFixture(t)
	coach := f.asStaff("POST", "/api/gym/coaches", map[string]any{"name": "Go Coach " + testutil.RandomHex(3)})
	coachID := coach.data()["id"].(string)
	classTypeID, _ := f.classType(1)
	at := func(day, clock string) time.Time {
		t, _ := time.Parse(time.RFC3339, day+"T"+clock+":00+07:00")
		return t
	}
	monday := f.session(classTypeID, at("2031-03-10", "10:00"), 10)
	cancelled := f.session(classTypeID, at("2031-03-12", "10:00"), 10)
	later := f.session(classTypeID, at("2031-03-25", "07:00"), 5)
	nextMonth := f.session(classTypeID, at("2031-04-01", "07:00"), 5)
	f.exec(`UPDATE gym.class_sessions SET coach_id = $2, status = 'published' WHERE id = ANY($1::uuid[])`,
		[]string{monday, cancelled, later, nextMonth}, coachID)
	f.exec(`UPDATE gym.class_sessions SET status = 'cancelled' WHERE id = $1`, cancelled)
	for _, status := range []string{"confirmed", "no_show"} {
		f.exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, $3)`, monday, f.member(0), status)
	}

	expectError(t, f.asStaff("GET", "/api/gym/coaches/"+coachID+"/schedule?day=bad", nil), 400, "Parameter day harus tanggal (YYYY-MM-DD)")
	res := f.asStaff("GET", "/api/gym/coaches/"+coachID+"/schedule?day=2031-03-12", nil)
	d := res.data()
	if res.Status != 200 || d["week_start"] != "2031-03-10" || d["month"] != "2031-03" || len(d["sessions"].([]any)) != 2 {
		t.Fatalf("schedule: %s", res.Raw)
	}
	// March holds two held sessions: 2 of 10 booked and 0 of 5.
	if w := d["workload"].(map[string]any); w["week_sessions"] != 1.0 || w["month_sessions"] != 2.0 || w["avg_fill"] != 0.1 {
		t.Fatalf("workload: %v", w)
	}
	// The week of 31 March runs into April; the month stays March.
	res = f.asStaff("GET", "/api/gym/coaches/"+coachID+"/schedule?day=2031-03-31", nil)
	if d := res.data(); d["week_start"] != "2031-03-31" || len(d["sessions"].([]any)) != 1 ||
		d["workload"].(map[string]any)["week_sessions"] != 1.0 || d["workload"].(map[string]any)["month_sessions"] != 2.0 {
		t.Fatalf("month-end week: %s", res.Raw)
	}
}

// Coach photos upload to the public site bucket and save as photo_url.
func TestCoachPhoto(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	f := newFixture(t)
	upload := func(name string, data []byte) response {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		if data != nil {
			part, _ := mw.CreateFormFile("file", name)
			_, _ = part.Write(data)
		}
		_ = mw.Close()
		req := httptest.NewRequest("POST", "/api/gym/coaches/photo", &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("X-Test-Staff", f.staff)
		rec := httptest.NewRecorder()
		f.mux.ServeHTTP(rec, req)
		out := response{Status: rec.Code, Raw: rec.Body.String()}
		_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
		return out
	}
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 16)...)

	expectError(t, upload("a.png", nil), 400, "Pilih file foto dulu")
	expectError(t, upload("a.svg", []byte("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), 400, "File harus gambar JPG, PNG, atau WebP")
	res := upload("coach.png", png)
	url, _ := res.data()["url"].(string)
	if res.Status != 200 || !strings.HasPrefix(url, "/api/files/site/coaches/") || !strings.HasSuffix(url, ".png") {
		t.Fatalf("upload: %s", res.Raw)
	}
	if got, err := os.ReadFile(filepath.Join(dir, "uploads", "site", strings.TrimPrefix(url, "/api/files/site/"))); err != nil || !bytes.Equal(got, png) {
		t.Fatalf("stored file: %v", err)
	}

	name := "Go Coach " + testutil.RandomHex(3)
	coach := f.asStaff("POST", "/api/gym/coaches", map[string]any{"name": name, "photo_url": url})
	if coach.Status != 200 {
		t.Fatalf("save coach with uploaded photo: %s", coach.Raw)
	}
	expectError(t, f.asStaff("PATCH", "/api/gym/coaches/"+coach.data()["id"].(string), map[string]any{"photo_url": "/etc/passwd"}),
		400, "Data tidak valid: photo_url")

	public := f.do("GET", "/api/public/site/coaches", "", "", nil)
	if public.Status != 200 || !hasRow(public.list(), "name", name, "photo_url", url) {
		t.Fatalf("public coaches: %s", public.Raw)
	}
}
