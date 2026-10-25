package hris

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// upload posts a CSV to an import route as s, inside a savepoint like do.
func (h *harness) upload(s *testutil.Staff, path, csv string, dryRun bool) call {
	h.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", "data.csv")
	if err != nil {
		h.t.Fatal(err)
	}
	_, _ = fw.Write([]byte(csv))
	if dryRun {
		_ = mw.WriteField("dry_run", "1")
	}
	_ = mw.Close()
	r := httptest.NewRequest("POST", path, &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	r = testutil.AsStaff(r, *s)
	h.exec("SAVEPOINT harness_upload")
	rec, out := testutil.Do(h.t, h.mux, r)
	h.exec("RELEASE SAVEPOINT harness_upload")
	return call{rec.Code, out, rec.Body.String()}
}

func (c call) count(key string) int {
	n, _ := c.data()[key].(float64)
	return int(n)
}

func (c call) rowMessage(i int) string {
	rows, _ := c.data()["rows"].([]any)
	if i >= len(rows) {
		return ""
	}
	s, _ := rows[i].(map[string]any)["message"].(string)
	return s
}

// Departments, positions and employees import in that order; employees
// link to their department, position, manager and login by code, title
// and email, and a re-import leaves everything unchanged.
func TestImportOrganisation(t *testing.T) {
	h := newHarness(t)
	admin, _ := h.staff("admin", []string{"hris.master", "hris.kepegawaian"}, false)
	login := testutil.CreateStaff(t, testutil.StaffOptions{})
	reader, _ := h.staff("pos", []string{"hris.workforce"}, false)
	sfx := strings.ToUpper(testutil.RandomHex(3))

	departments := "kode,nama,deskripsi,aktif\n" +
		"GOOPS" + sfx + ",Operasional " + sfx + ",Front desk dan coach,ya\n" +
		"GOFIN" + sfx + ",Keuangan " + sfx + ",,tidak\n" +
		",Tanpa kode,,ya\n"
	if res := h.upload(&reader, "/api/master/departments/import", departments, true); res.status != 403 {
		t.Fatalf("reader must be refused: %d %s", res.status, res.raw)
	}
	dry := h.upload(&admin, "/api/master/departments/import", departments, true)
	if dry.status != 200 || dry.count("created") != 2 || dry.count("failed") != 1 || dry.data()["dry_run"] != true {
		t.Fatalf("departments dry run: %s", dry.raw)
	}
	if n := h.scalar(`SELECT count(*)::text FROM hris.departments WHERE code LIKE $1`, "GO%"+sfx); n != "0" {
		t.Fatalf("dry run wrote %s departments", n)
	}
	res := h.upload(&admin, "/api/master/departments/import", departments, false)
	if res.status != 200 || res.count("created") != 2 || res.count("failed") != 1 {
		t.Fatalf("departments: %s", res.raw)
	}
	if msg := res.rowMessage(2); !strings.Contains(msg, "Kode wajib diisi") {
		t.Fatalf("row 4: %q", msg)
	}
	if got := h.scalar(`SELECT is_active::text FROM hris.departments WHERE code = $1`, "GOFIN"+sfx); got != "false" {
		t.Fatalf("inactive department: %s", got)
	}

	positions := "jabatan,departemen,level,aktif\n" +
		"Go Manager " + sfx + ",GOOPS" + sfx + ",Manager,ya\n" +
		"Go Coach " + sfx + ",Operasional " + sfx + ",,ya\n" +
		"Go Hilang " + sfx + ",NOPE" + sfx + ",Kepala,ya\n"
	res = h.upload(&admin, "/api/master/positions/import", positions, false)
	if res.status != 200 || res.count("created") != 2 || res.count("failed") != 1 {
		t.Fatalf("positions: %s", res.raw)
	}
	if msg := res.rowMessage(2); !strings.Contains(msg, "Departemen tidak ditemukan") || !strings.Contains(msg, "Level harus salah satu") {
		t.Fatalf("row 4: %q", msg)
	}
	if got := h.scalar(`SELECT department || ' ' || level FROM hris.positions WHERE title = $1`, "Go Coach "+sfx); got != "Operasional "+sfx+" Staff" {
		t.Fatalf("coach position: %s", got)
	}

	manager, coach := "go-manager-"+strings.ToLower(sfx)+"@hris.test", "go-coach-"+strings.ToLower(sfx)+"@hris.test"
	employees := "nama,email,nip,telepon,tanggal_bergabung,status_kepegawaian,departemen,jabatan,atasan_email,email_user,aktif\n" +
		"Go Manager " + sfx + "," + manager + ",,0811000" + sfx[:3] + ",2025-01-06,permanent,GOOPS" + sfx + ",Go Manager " + sfx + ",,,ya\n" +
		"Go Coach " + sfx + "," + coach + ",GO-" + sfx + ",,2025-02-03,permanent,GOOPS" + sfx + ",Go Coach " + sfx + "," + manager + "," + login.Email + ",ya\n" +
		"Go Yatim " + sfx + ",go-yatim-" + strings.ToLower(sfx) + "@hris.test,,,2025-02-03,permanent,NOPE,Go Tidak Ada,nobody@hris.test,nobody@hris.test,ya\n"
	res = h.upload(&admin, "/api/hris/employees/import", employees, false)
	if res.status != 200 || res.count("created") != 2 || res.count("failed") != 1 {
		t.Fatalf("employees: %s", res.raw)
	}
	for _, want := range []string{"Departemen tidak ditemukan", "Jabatan tidak ditemukan", "Atasan (email) tidak ditemukan", "Email user tidak cocok"} {
		if msg := res.rowMessage(2); !strings.Contains(msg, want) {
			t.Fatalf("row 4 lacks %q: %q", want, msg)
		}
	}
	managerID := h.scalar(`SELECT id::text FROM hris.employees WHERE email = $1`, manager)
	got := h.scalar(`SELECT e.nip || ' ' || e.reporting_to::text || ' ' || e.user_id::text || ' ' || d.code || ' ' || p.title
		FROM hris.employees e JOIN hris.departments d ON d.id = e.department_id JOIN hris.positions p ON p.id = e.job_title_id
		WHERE e.email = $1`, coach)
	if got != "GO-"+sfx+" "+managerID+" "+login.UserID+" GOOPS"+sfx+" Go Coach "+sfx {
		t.Fatalf("coach employee: %s", got)
	}
	if nip := h.scalar(`SELECT nip FROM hris.employees WHERE email = $1`, manager); !strings.HasPrefix(nip, "EMP-") {
		t.Fatalf("auto nip: %s", nip)
	}
	if n := h.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE action = 'import' AND entity = 'hris.employees' AND actor_id = $1`, admin.UserID); n != "1" {
		t.Fatalf("audit rows: %s", n)
	}

	for _, again := range []struct{ path, csv string }{
		{"/api/master/departments/import", departments}, {"/api/master/positions/import", positions}, {"/api/hris/employees/import", employees},
	} {
		res := h.upload(&admin, again.path, again.csv, false)
		if res.count("created") != 0 || res.count("updated") != 0 || res.count("unchanged") != 2 {
			t.Fatalf("re-import %s: %s", again.path, res.raw)
		}
	}

	edited := strings.Replace(employees, "Go Coach "+sfx+","+coach+",GO-"+sfx+",,2025-02-03,permanent", "Go Coach Baru "+sfx+","+coach+",GO-"+sfx+",0812999,2025-02-03,permanent", 1)
	res = h.upload(&admin, "/api/hris/employees/import", edited, false)
	if res.count("updated") != 1 || res.count("unchanged") != 1 {
		t.Fatalf("edit: %s", res.raw)
	}
	if got := h.scalar(`SELECT full_name || ' ' || phone FROM hris.employees WHERE email = $1`, coach); got != "Go Coach Baru "+sfx+" 0812999" {
		t.Fatalf("after edit: %s", got)
	}
	if n := h.scalar(`SELECT count(*)::text FROM hris.employees WHERE email = $1`, coach); n != "1" {
		t.Fatalf("employee duplicated: %s", n)
	}
}
