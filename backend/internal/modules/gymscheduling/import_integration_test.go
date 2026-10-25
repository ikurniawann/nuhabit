package gymscheduling

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// upload posts a CSV to an import route as staff; dryRun sets the field.
func (f *fixture) upload(target, csv string, dryRun bool) response {
	f.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", "data.csv")
	if err != nil {
		f.t.Fatal(err)
	}
	_, _ = fw.Write([]byte(csv))
	if dryRun {
		_ = mw.WriteField("dry_run", "1")
	}
	_ = mw.Close()
	req := httptest.NewRequest("POST", target, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-Test-Staff", f.staff)
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
	return out
}

func (r response) count(key string) int {
	n, _ := r.data()[key].(float64)
	return int(n)
}

func (r response) rowStatus(i int) string {
	rows, _ := r.data()["rows"].([]any)
	if i >= len(rows) {
		return ""
	}
	s, _ := rows[i].(map[string]any)["status"].(string)
	return s
}

func (r response) rowMessage(i int) string {
	rows, _ := r.data()["rows"].([]any)
	if i >= len(rows) {
		return ""
	}
	s, _ := rows[i].(map[string]any)["message"].(string)
	return s
}

// Class types: a dry run reports without writing, a commit creates, a
// re-import of the same file changes nothing, and an edited row updates.
func TestImportClassTypes(t *testing.T) {
	f := newFixture(t)
	sfx := testutil.RandomHex(3)
	a, b := "Go Impor A "+sfx, "Go Impor B "+sfx
	csv := "nama,deskripsi,durasi_menit,biaya_kredit,kapasitas,warna\n" +
		a + ",Kelas A,60,1,16,info\n" +
		b + ",Kelas B,75,2,12,\n" +
		"Go Impor C " + sfx + ",Rusak,10,1,16,ungu\n"

	dry := f.upload("/api/gym/class-types/import", csv, true)
	if dry.Status != 200 || dry.data()["dry_run"] != true || dry.count("created") != 2 || dry.count("failed") != 1 {
		t.Fatalf("dry run: %s", dry.Raw)
	}
	if msg := dry.rowMessage(2); !strings.Contains(msg, "Durasi (menit)") || !strings.Contains(msg, "Warna") {
		t.Fatalf("row 4 message: %q", msg)
	}
	if n := f.scalar(`SELECT count(*)::text FROM gym.class_types WHERE name = ANY($1)`, []string{a, b}); n != "0" {
		t.Fatalf("dry run wrote %s rows", n)
	}
	if n := f.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE action = 'import' AND entity = 'gym.class_types' AND actor_id = $1`, f.staff); n != "0" {
		t.Fatalf("dry run wrote %s audit rows", n)
	}

	commit := f.upload("/api/gym/class-types/import", csv, false)
	if commit.Status != 200 || commit.count("created") != 2 || commit.count("failed") != 1 || commit.rowStatus(0) != "created" {
		t.Fatalf("commit: %s", commit.Raw)
	}
	if got := f.scalar(`SELECT color || '/' || default_capacity::text FROM gym.class_types WHERE name = $1`, b); got != "lime/12" {
		t.Fatalf("defaults: %s", got)
	}
	if n := f.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE action = 'import' AND entity = 'gym.class_types' AND actor_id = $1`, f.staff); n != "1" {
		t.Fatalf("audit rows after commit: %s", n)
	}

	again := f.upload("/api/gym/class-types/import", csv, false)
	if again.count("created") != 0 || again.count("updated") != 0 || again.count("unchanged") != 2 {
		t.Fatalf("re-import: %s", again.Raw)
	}

	edited := strings.Replace(csv, a+",Kelas A,60,1,16,info", strings.ToUpper(a)+",Kelas A baru,90,1,16,info", 1)
	upd := f.upload("/api/gym/class-types/import", edited, false)
	if upd.count("updated") != 1 || upd.count("unchanged") != 1 {
		t.Fatalf("edit: %s", upd.Raw)
	}
	if got := f.scalar(`SELECT default_duration_min::text || ' ' || name FROM gym.class_types WHERE lower(name) = lower($1)`, a); got != "90 "+strings.ToUpper(a) {
		t.Fatalf("after edit: %s", got)
	}
	if n := f.scalar(`SELECT count(*)::text FROM gym.class_types WHERE lower(name) = lower($1)`, a); n != "1" {
		t.Fatalf("natural key must not duplicate: %s", n)
	}
}

// Coaches link to a staff account by email and to a branch by code; an
// unknown email or branch fails only that row.
func TestImportCoaches(t *testing.T) {
	// The staff account is created before the fixture so its cleanup runs
	// after the transaction that references it rolls back.
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	f := newFixture(t)
	sfx := testutil.RandomHex(3)
	branchCode := "GOIMP" + strings.ToUpper(sfx)
	branch := testutil.CreateOrg(t, f.tx)
	f.exec(`UPDATE configuration.branches SET code = $2 WHERE id = $1`, branch.BranchID, branchCode)
	name := "Go Coach Impor " + sfx
	csv := "nama,bio,spesialisasi,cabang,email_user,status\n" +
		name + ",Bio,Engine," + branchCode + "," + staff.Email + ",active\n" +
		"Go Coach Hilang " + sfx + ",,,NOPE" + sfx + ",nobody-" + sfx + "@test.local,active\n"
	res := f.upload("/api/gym/coaches/import", csv, false)
	if res.Status != 200 || res.count("created") != 1 || res.count("failed") != 1 {
		t.Fatalf("import: %s", res.Raw)
	}
	if msg := res.rowMessage(1); !strings.Contains(msg, "Cabang tidak ditemukan") || !strings.Contains(msg, "Email user") {
		t.Fatalf("row 3 message: %q", msg)
	}
	if got := f.scalar(`SELECT user_id::text || ' ' || branch_id::text FROM gym.coaches WHERE name = $1`, name); got != staff.UserID+" "+branch.BranchID {
		t.Fatalf("links: %s", got)
	}
	again := f.upload("/api/gym/coaches/import", csv, false)
	if again.count("unchanged") != 1 || again.count("created") != 0 {
		t.Fatalf("re-import: %s", again.Raw)
	}
	cleared := "nama,bio,status\n" + name + ",Bio baru,inactive\n"
	upd := f.upload("/api/gym/coaches/import", cleared, false)
	if upd.count("updated") != 1 {
		t.Fatalf("update: %s", upd.Raw)
	}
	if got := f.scalar(`SELECT status || ' ' || COALESCE(user_id::text, 'none') FROM gym.coaches WHERE name = $1`, name); got != "inactive none" {
		t.Fatalf("after update: %s", got)
	}
}

// Schedule templates are keyed by class type, branch, weekday and start
// time; blank numbers fall back to the class type defaults.
func TestImportScheduleTemplates(t *testing.T) {
	f := newFixture(t)
	classTypeID, className := f.classType(2)
	coachID, coachName := f.coach()
	sfx := testutil.RandomHex(3)
	branchCode := "GOTPL" + strings.ToUpper(sfx)
	branch := testutil.CreateOrg(t, f.tx)
	f.exec(`UPDATE configuration.branches SET code = $2 WHERE id = $1`, branch.BranchID, branchCode)
	csv := "jenis_kelas,cabang,hari,jam_mulai,durasi_menit,coach,kapasitas,biaya_kredit,berlaku_mulai,berlaku_sampai,area,aktif\n" +
		className + "," + branchCode + ",Senin,06:30,,," + ",,2026-11-01,,Main Floor,ya\n" +
		className + "," + branchCode + ",rabu,18.00,45," + coachName + ",8,1,2026-11-01,2026-12-31,,ya\n" +
		"Tidak Ada " + sfx + "," + branchCode + ",Senin,06:30,,,,,2026-11-01,,,ya\n" +
		className + "," + branchCode + ",Kamis,25:00,,,,,2026-11-01,2026-10-01,,ya\n"
	res := f.upload("/api/gym/session-templates/import", csv, false)
	if res.Status != 200 || res.count("created") != 2 || res.count("failed") != 2 {
		t.Fatalf("import: %s", res.Raw)
	}
	if msg := res.rowMessage(2); !strings.Contains(msg, "Jenis kelas tidak ditemukan") {
		t.Fatalf("row 4: %q", msg)
	}
	if msg := res.rowMessage(3); !strings.Contains(msg, "Jam mulai") {
		t.Fatalf("row 5: %q", msg)
	}
	got := f.scalar(`SELECT duration_min::text || ' ' || capacity::text || ' ' || credit_cost::text || ' ' || COALESCE(coach_id::text, 'none')
		FROM gym.session_templates WHERE class_type_id = $1 AND branch_id = $2 AND weekday = 1`, classTypeID, branch.BranchID)
	if got != "60 10 2 none" {
		t.Fatalf("monday defaults: %s", got)
	}
	got = f.scalar(`SELECT duration_min::text || ' ' || coach_id::text || ' ' || valid_until::text || ' ' || to_char(start_time, 'HH24:MI')
		FROM gym.session_templates WHERE class_type_id = $1 AND branch_id = $2 AND weekday = 3`, classTypeID, branch.BranchID)
	if got != "45 "+coachID+" 2026-12-31 18:00" {
		t.Fatalf("wednesday: %s", got)
	}
	again := f.upload("/api/gym/session-templates/import", csv, false)
	if again.count("unchanged") != 2 || again.count("created") != 0 {
		t.Fatalf("re-import: %s", again.Raw)
	}
	edited := strings.Replace(csv, ",8,1,2026-11-01,2026-12-31,,ya", ",8,1,2026-11-01,,Studio B,tidak", 1)
	upd := f.upload("/api/gym/session-templates/import", edited, false)
	if upd.count("updated") != 1 || upd.count("unchanged") != 1 {
		t.Fatalf("edit: %s", upd.Raw)
	}
	got = f.scalar(`SELECT COALESCE(valid_until::text, 'open') || ' ' || area || ' ' || active::text
		FROM gym.session_templates WHERE class_type_id = $1 AND branch_id = $2 AND weekday = 3`, classTypeID, branch.BranchID)
	if got != "open Studio B false" {
		t.Fatalf("after edit: %s", got)
	}
	if n := f.scalar(`SELECT count(*)::text FROM gym.session_templates WHERE class_type_id = $1`, classTypeID); n != "2" {
		t.Fatalf("templates: %s", n)
	}
}

// A template download needs the create grant and answers CSV.
func TestImportTemplateDownload(t *testing.T) {
	f := newFixture(t)
	req := httptest.NewRequest("GET", "/api/gym/class-types/import/template", nil)
	req.Header.Set("X-Test-Staff", f.staff)
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/csv") ||
		!strings.Contains(rec.Body.String(), "nama,deskripsi,durasi_menit") {
		t.Fatalf("template: %d %s", rec.Code, rec.Body.String())
	}
}
