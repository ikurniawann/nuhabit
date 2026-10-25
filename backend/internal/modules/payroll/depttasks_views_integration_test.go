package payroll

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/testutil"
)

// To-do views, progress, KPI links, jobs and zones over department tasks.
// The clock is fixedNow (Sunday 4 October 2026, 17.00 WIB) unless a test
// moves it; tests run one after another, so a moved clock is put back.

var ownMenus = map[string][]string{"tasks": {"read", "create", "update"}}

func wib(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, localtime.Jakarta)
	if err != nil {
		panic(err)
	}
	return t
}

func (e *env) clock(t *testing.T, at time.Time) {
	t.Helper()
	was := fixedNow
	fixedNow = at
	t.Cleanup(func() { fixedNow = was })
}

func (e *env) items(s *testutil.Staff, query string) []map[string]any {
	e.t.Helper()
	raw := e.call(s, "GET", "/api/hris/dept-tasks/items?"+query, nil, 200)["data"].([]any)
	out := make([]map[string]any, len(raw))
	for i, r := range raw {
		out[i] = r.(map[string]any)
	}
	return out
}

func (e *env) firstOccurrence(taskID string) string {
	e.t.Helper()
	var id string
	e.scalar(&id, `SELECT id::text FROM hris.department_task_occurrences WHERE task_id = $1 ORDER BY occurrence_date LIMIT 1`, taskID)
	return id
}

func (e *env) occurrenceStatus(id string) string {
	e.t.Helper()
	var st string
	e.scalar(&st, `SELECT status FROM hris.department_task_occurrences WHERE id = $1`, id)
	return st
}

func TestTaskViewsOwnAndTeam(t *testing.T) {
	e := setup(t)
	e.clock(t, wib("2026-10-22 10:00"))
	today := "2026-10-22"
	dept := e.department("Operasional Go")
	other := e.department("Dapur Lain Go")
	headStaff := e.taskStaff()
	aliceStaff := e.taskStaff()
	bobStaff := e.taskStaff()
	outStaff := e.taskStaff()
	head := e.emp(empOpts{name: "Kepala Ops", user: headStaff.UserID, dept: dept})
	alice := e.emp(empOpts{name: "Alice", user: aliceStaff.UserID, dept: dept, reportsTo: head})
	bob := e.emp(empOpts{name: "Bob", user: bobStaff.UserID, dept: dept, reportsTo: head})
	e.emp(empOpts{name: "Orang Lain", user: outStaff.UserID, dept: other})
	indicator := e.indicatorID("att_ontime")
	// The migration grants tasks to every role; the HR fixture gets it here.
	testutil.GrantMenu(t, e.hr.RoleID, "tasks", nil)

	// Alice files a personal to-do; she may not file for Bob or elsewhere.
	personal := e.call(&aliceStaff, "POST", "/api/hris/dept-tasks", map[string]any{"title": "Rekap kasir", "recurrence": "once",
		"due_date": today, "assignee_employee_id": alice, "priority": "high"}, 201)["data"].(map[string]any)["id"].(string)
	wantErr(t, e.call(&aliceStaff, "POST", "/api/hris/dept-tasks", map[string]any{"title": "Untuk Bob", "recurrence": "once",
		"due_date": today, "assignee_employee_id": bob}, 403), "Hanya HRD atau atasan (kepala tim) yang boleh membuat task departemen")
	wantErr(t, e.call(&aliceStaff, "POST", "/api/hris/dept-tasks", map[string]any{"title": "Salah", "recurrence": "once",
		"due_date": today, "assignee_employee_id": alice, "priority": "wow"}, 400), "Prioritas tidak valid")

	mine := e.items(&aliceStaff, "scope=mine&view=today")
	if len(mine) != 1 || mine[0]["title"] != "Rekap kasir" || mine[0]["mine"] != true || mine[0]["can_work"] != true ||
		mine[0]["review_required"] != false || mine[0]["priority"] != "high" || mine[0]["overdue"] != false {
		t.Fatalf("alice today %v", mine)
	}
	aliceOcc := mine[0]["occurrence_id"].(string)
	if n := len(e.items(&bobStaff, "scope=mine&view=today")); n != 0 {
		t.Fatalf("bob sees %d of alice's tasks", n)
	}
	if rec := e.raw(&bobStaff, "GET", "/api/hris/dept-tasks/occurrences/"+aliceOcc, nil); rec.Code != 404 {
		t.Fatalf("bob opens alice's occurrence: %d", rec.Code)
	}
	wantErr(t, e.call(&aliceStaff, "GET", "/api/hris/dept-tasks/items?scope=team", nil, 403), "Papan tim hanya untuk kepala departemen")
	wantErr(t, e.call(&outStaff, "GET", "/api/hris/dept-tasks/items?scope=team", nil, 403), "Papan tim hanya untuk kepala departemen")

	// The head files a daily KPI-linked task for Bob; the board shows both.
	daily := e.call(&headStaff, "POST", "/api/hris/dept-tasks", map[string]any{"title": "Cek stok", "recurrence": "daily",
		"assignee_employee_id": bob, "kpi_indicator_id": indicator, "kpi_contribution": 2, "priority": "urgent"}, 201)["data"].(map[string]any)["id"].(string)
	board := e.items(&headStaff, "scope=team&view=today")
	if len(board) != 2 || board[0]["title"] != "Cek stok" || board[0]["can_review"] != true || board[0]["can_manage"] != true ||
		board[0]["kpi_indicator_code"] != "att_ontime" || board[0]["review_required"] != true || board[1]["title"] != "Rekap kasir" {
		t.Fatalf("head board %v", board)
	}
	// The week holds the daily task's Thursday to Sunday rows.
	if week := e.items(&headStaff, "scope=team&view=week"); len(week) != 5 {
		t.Fatalf("head week %d rows", len(week))
	}
	wantErr(t, e.call(&headStaff, "GET", "/api/hris/dept-tasks/items?scope=team&department_id="+other, nil, 403), "Anda bukan kepala departemen ini")
	meta := e.call(&headStaff, "GET", "/api/hris/dept-tasks/meta", nil, 200)["data"].(map[string]any)
	if meta["team_scope"] != "heads" || len(meta["members"].([]any)) != 3 || len(meta["departments"].([]any)) != 1 || meta["today"] != today {
		t.Fatalf("head meta %v", meta)
	}
	if m := e.call(&aliceStaff, "GET", "/api/hris/dept-tasks/meta", nil, 200)["data"].(map[string]any); m["team_scope"] != "none" {
		t.Fatalf("alice meta %v", m)
	}
	// HR sees every department and may filter.
	if all := e.items(&e.hr, "scope=team&view=week"); len(all) < 2 {
		t.Fatalf("hr board %d", len(all))
	}
	if n := len(e.items(&e.hr, "scope=team&view=week&department_id="+other)); n != 0 {
		t.Fatalf("hr filtered %d", n)
	}

	// A personal task closes without review; a department task waits for the head.
	if r := e.call(&aliceStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+aliceOcc, map[string]any{"action": "done"}, 200); r["message"] != "Tugas selesai" {
		t.Fatalf("personal done %v", r)
	}
	if st := e.occurrenceStatus(aliceOcc); st != "approved" {
		t.Fatalf("personal status %s", st)
	}
	bobOcc := e.firstOccurrence(daily)
	wantErr(t, e.call(&aliceStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "progress", "note": "x"}, 403),
		"Hanya penanggung jawab task ini yang boleh mengerjakannya")
	wantErr(t, e.call(&bobStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "progress"}, 400), "Isi catatan atau persen progres")
	wantErr(t, e.call(&bobStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "progress", "progress_percent": 100}, 400),
		"Progres 0–99% (untuk 100% pakai Tandai Selesai)")
	e.call(&bobStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "progress", "progress_percent": 40, "note": "Rak A sudah"}, 200)
	detail := e.call(&bobStaff, "GET", "/api/hris/dept-tasks/occurrences/"+bobOcc, nil, 200)["data"].(map[string]any)
	if detail["status"] != "in_progress" || detail["progress"].(float64) != 40 || detail["last_note"] != "Rak A sudah" ||
		len(detail["updates"].([]any)) != 1 || detail["started_at"] == nil {
		t.Fatalf("progress detail %v", detail)
	}
	wantErr(t, e.call(&outStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "comment", "note": "hai"}, 403),
		"Hanya yang terlibat di task ini yang bisa berkomentar")
	e.call(&headStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "comment", "note": "Lanjutkan"}, 200)
	e.call(&bobStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "done"}, 200)
	if st := e.occurrenceStatus(bobOcc); st != "done" {
		t.Fatalf("done status %s", st)
	}
	if n := e.count(`SELECT count(*) FROM hris.department_task_kpi_contributions WHERE occurrence_id = $1`, bobOcc); n != 0 {
		t.Fatal("contribution before approval")
	}
	e.call(&headStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "approve"}, 200)
	var amount float64
	var month int
	e.scalar(&amount, `SELECT amount::float8 FROM hris.department_task_kpi_contributions WHERE occurrence_id = $1`, bobOcc)
	e.scalar(&month, `SELECT period_month FROM hris.department_task_kpi_contributions WHERE occurrence_id = $1`, bobOcc)
	if amount != 2 || month != 10 {
		t.Fatalf("contribution %v %d", amount, month)
	}

	// Contributions beside the scorecard: the head and Bob read Bob's; Alice may not.
	contrib := e.call(&headStaff, "GET", "/api/hris/dept-tasks/kpi/contributions?month=2026-10&employee_id="+bob, nil, 200)["data"].([]any)
	if len(contrib) != 1 || contrib[0].(map[string]any)["tasks_done"].(float64) != 1 || contrib[0].(map[string]any)["contribution_total"].(float64) != 2 {
		t.Fatalf("contributions %v", contrib)
	}
	e.call(&bobStaff, "GET", "/api/hris/dept-tasks/kpi/contributions?month=2026-10&employee_id="+bob, nil, 200)
	wantErr(t, e.call(&aliceStaff, "GET", "/api/hris/dept-tasks/kpi/contributions?month=2026-10&employee_id="+bob, nil, 403),
		"Anda tidak punya akses ke kontribusi karyawan ini")
	kpi := e.call(&headStaff, "GET", "/api/hris/dept-tasks/kpi?month=2026-10", nil, 200)["data"].(map[string]any)
	var row map[string]any
	for _, r := range kpi["indicators"].([]any) {
		if r.(map[string]any)["code"] == "att_ontime" {
			row = r.(map[string]any)
		}
	}
	if row == nil || row["approved"].(float64) != 1 || row["total"].(float64) != 10 || row["contribution_total"].(float64) != 2 || row["rate"].(float64) != 1 {
		t.Fatalf("kpi view %v", row)
	}
	wantErr(t, e.call(&outStaff, "GET", "/api/hris/dept-tasks/kpi?department_id="+dept, nil, 403), "Anda tidak punya akses ke KPI departemen ini")

	// Reopening an approved row is the head's call and takes the contribution back.
	wantErr(t, e.call(&bobStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "reopen"}, 403),
		"Hanya Head Division departemen ini (atau HRD) yang boleh membuka task yang sudah disetujui")
	e.call(&headStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "reopen"}, 200)
	if st := e.occurrenceStatus(bobOcc); st != "pending" {
		t.Fatalf("reopened %s", st)
	}
	if n := e.count(`SELECT count(*) FROM hris.department_task_kpi_contributions WHERE occurrence_id = $1`, bobOcc); n != 0 {
		t.Fatal("contribution survives reopening")
	}
	e.call(&bobStaff, "PATCH", "/api/hris/dept-tasks/occurrences/"+bobOcc, map[string]any{"action": "start"}, 200)
	if st := e.occurrenceStatus(bobOcc); st != "in_progress" {
		t.Fatalf("started %s", st)
	}

	// The head edits the task; Bob may not; Alice edits her personal one.
	if r := e.call(&headStaff, "PATCH", "/api/hris/dept-tasks/"+daily, map[string]any{"title": "Cek stok gudang", "priority": "normal"}, 200); r["message"] != "Task diperbarui" {
		t.Fatalf("edit %v", r)
	}
	wantErr(t, e.call(&bobStaff, "PATCH", "/api/hris/dept-tasks/"+daily, map[string]any{"title": "Milik Bob"}, 403), "Hanya HRD atau atasan departemen ini yang boleh mengubah task")
	e.call(&aliceStaff, "PATCH", "/api/hris/dept-tasks/"+personal, map[string]any{"description": "catatan"}, 200)
	// Dropped to normal, the daily task now sorts after Alice's high one.
	if got := e.items(&headStaff, "scope=team&view=today"); len(got) != 2 || got[0]["title"] != "Rekap kasir" ||
		got[1]["title"] != "Cek stok gudang" || got[1]["priority"] != "normal" {
		t.Fatalf("edited items %v", got)
	}

	// Monitor: one department, Bob in progress, Alice approved.
	mon := e.call(&headStaff, "GET", "/api/hris/dept-tasks/monitor?month=2026-10", nil, 200)["data"].(map[string]any)
	summary := mon["summary"].(map[string]any)
	if len(mon["departments"].([]any)) != 1 || summary["due"].(float64) != 2 || summary["approved"].(float64) != 1 || summary["in_progress"].(float64) != 1 || mon["scope"] != "own" {
		t.Fatalf("monitor %v", mon)
	}
	if deptRow := mon["departments"].([]any)[0].(map[string]any); len(deptRow["assignees"].([]any)) != 2 {
		t.Fatalf("assignees %v", deptRow)
	}

	// Attachments: Bob uploads and downloads; Alice cannot see it; Bob removes it.
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, _ := w.CreateFormFile("file", "bukti.pdf")
	_, _ = part.Write([]byte("%PDF-1.4 bukti"))
	_ = w.Close()
	req := httptest.NewRequest("POST", "/api/hris/dept-tasks/occurrences/"+bobOcc+"/attachments", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec, body := testutil.Do(t, e.mux, testutil.AsStaff(req, bobStaff))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload %d %s", rec.Code, rec.Body.String())
	}
	att := body["data"].(map[string]any)
	if att["mime"] != "application/pdf" || att["name"] != "bukti.pdf" {
		t.Fatalf("attachment %v", att)
	}
	url := "/api/hris/dept-tasks/occurrences/" + bobOcc + "/attachments/" + att["id"].(string)
	if got := e.raw(&bobStaff, "GET", url, nil); got.Code != 200 || got.Body.String() != "%PDF-1.4 bukti" {
		t.Fatalf("download %d %q", got.Code, got.Body.String())
	}
	if got := e.raw(&aliceStaff, "GET", url, nil); got.Code != 404 {
		t.Fatalf("alice downloads bob's file: %d", got.Code)
	}
	e.call(&bobStaff, "DELETE", url, nil, 200)
	detail = e.call(&headStaff, "GET", "/api/hris/dept-tasks/occurrences/"+bobOcc, nil, 200)["data"].(map[string]any)
	if len(detail["attachments"].([]any)) != 0 || len(detail["updates"].([]any)) < 5 || detail["comment_count"].(float64) != 1 {
		t.Fatalf("final detail %v", detail)
	}
}

// A daily task filed on the 22nd has no occurrences before the 22nd, the
// recurrence job fills the days around today without anyone opening a
// page, and the reminders go out once per day and zone.
func TestRecurringFromCreationJobsAndReminders(t *testing.T) {
	e := setup(t)
	e.clock(t, wib("2026-10-22 10:00"))
	dept := e.department("Gudang Go")
	bobStaff := e.taskStaff()
	bob := e.emp(empOpts{name: "Bob Gudang", user: bobStaff.UserID, dept: dept})
	hrEmp := e.emp(empOpts{name: "HR Go", user: e.hr.UserID, dept: dept})
	_ = hrEmp
	daily := e.call(&e.hr, "POST", "/api/hris/dept-tasks", map[string]any{"title": "Hitung stok", "recurrence": "daily",
		"assignee_employee_id": bob, "department_id": dept}, 201)["data"].(map[string]any)["id"].(string)

	// Nothing is generated before the task was filed, so nothing is overdue.
	month := e.items(&bobStaff, "scope=mine&month=2026-10")
	if len(month) != 10 || month[0]["occurrence_date"] != "2026-10-22" || month[0]["overdue"] != false {
		t.Fatalf("october rows %d first %v", len(month), month[0])
	}
	if n := e.count(`SELECT count(*) FROM hris.department_task_occurrences WHERE task_id = $1 AND occurrence_date < '2026-10-22'`, daily); n != 0 {
		t.Fatal("occurrences before the creation date")
	}

	// The job for a department nobody has opened: filed today, it gets
	// today and tomorrow (and Jakarta's yesterday, which is before filing).
	quiet := e.department("Sunyi Go")
	cat := e.emp(empOpts{name: "Cat", dept: quiet})
	weekly := e.call(&e.hr, "POST", "/api/hris/dept-tasks", map[string]any{"title": "Laporan mingguan", "recurrence": "weekly", "weekly_day": 4,
		"assignee_employee_id": cat, "department_id": quiet}, 201)["data"].(map[string]any)["id"].(string)
	if err := e.svc.MaterializeOccurrences(e.ctx, wib("2026-10-22 00:10")); err != nil {
		t.Fatal(err)
	}
	// 22 Oct 2026 is a Thursday (weekly_day 4): one row, and a rerun adds none.
	if n := e.count(`SELECT count(*) FROM hris.department_task_occurrences WHERE task_id = $1`, weekly); n != 1 {
		t.Fatalf("weekly rows %d", n)
	}
	if err := e.svc.MaterializeOccurrences(e.ctx, wib("2026-10-22 06:00")); err != nil {
		t.Fatal(err)
	}
	if n := e.count(`SELECT count(*) FROM hris.department_task_occurrences WHERE task_id = $1`, weekly); n != 1 {
		t.Fatalf("weekly rows after rerun %d", n)
	}
	// A week later the job adds the next Thursday the evening before (Jayapura's tomorrow).
	if err := e.svc.MaterializeOccurrences(e.ctx, wib("2026-10-28 21:30")); err != nil {
		t.Fatal(err)
	}
	if n := e.count(`SELECT count(*) FROM hris.department_task_occurrences WHERE task_id = $1 AND occurrence_date = '2026-10-29'`, weekly); n != 1 {
		t.Fatal("next Thursday missing")
	}

	// Reminders for Bob on the 23rd: the 22nd is overdue, the 23rd due.
	notices := func() int {
		return e.count(`SELECT count(*) FROM public.notifications WHERE user_id = $1 AND type = 'reminder'`, bobStaff.UserID)
	}
	run := func(at string) {
		t.Helper()
		if err := e.svc.SendReminders(e.ctx, wib(at)); err != nil {
			t.Fatal(err)
		}
	}
	run("2026-10-23 06:50")
	if notices() != 0 {
		t.Fatal("digest before 07.00")
	}
	run("2026-10-23 07:05")
	run("2026-10-23 07:20")
	if notices() != 1 {
		t.Fatalf("digest sent %d times", notices())
	}
	var title, msg string
	e.scalar(&title, `SELECT title FROM public.notifications WHERE user_id = $1`, bobStaff.UserID)
	e.scalar(&msg, `SELECT message FROM public.notifications WHERE user_id = $1`, bobStaff.UserID)
	if title != "Tugas hari ini: 2 (1 terlambat)" || msg != "• Hitung stok (terlambat)\n• Hitung stok" {
		t.Fatalf("digest %q %q", title, msg)
	}
	run("2026-10-23 16:10")
	run("2026-10-23 16:40")
	if notices() != 2 {
		t.Fatalf("overdue sent, total %d", notices())
	}
	if got := e.channels.titles; len(got) != 2 || got[1] != "1 tugas terlambat" {
		t.Fatalf("channels %v", got)
	}
	run("2026-10-24 07:01")
	if notices() != 3 {
		t.Fatalf("next day digest, total %d", notices())
	}
	if n := e.count(`SELECT count(*) FROM platform.reminder_sends WHERE subject_id = $1`, bob); n != 3 {
		t.Fatalf("sent log rows %d", n)
	}
}

// 22.30 WIB on the 22nd is already the 23rd in Jayapura: a reader there
// sees the 23rd's row as today's (and the 22nd's, still open), a Jakarta
// reader sees only the 22nd. Overdue follows the task's own zone, so the
// Jakarta task's 22nd row is not overdue yet for either reader.
func TestZonesFollowTheReader(t *testing.T) {
	e := setup(t)
	e.clock(t, wib("2026-10-22 22:30"))
	dept := e.department("Timur Go")
	bobStaff := e.taskStaff()
	bob := e.emp(empOpts{name: "Bob Timur", user: bobStaff.UserID, dept: dept})
	e.call(&e.hr, "POST", "/api/hris/dept-tasks", map[string]any{"title": "Buka toko", "recurrence": "daily",
		"assignee_employee_id": bob, "department_id": dept}, 201)
	if got := e.items(&bobStaff, "scope=mine&view=today"); len(got) != 1 || got[0]["occurrence_date"] != "2026-10-22" {
		t.Fatalf("WIB today %v", got)
	}
	a := &actor{UserID: bobStaff.UserID, Role: "pos", EmployeeID: &bob}
	me, err := e.svc.loadTaskActor(e.ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	wit := &viewActor{taskActor: me, Name: "Bob", now: fixedNow, Zone: localtime.Zone("Asia/Jayapura")}
	got, err := e.svc.listItems(e.ctx, wit, itemFilter{Scope: "mine", View: "today"})
	if err != nil || len(got) != 2 || got[0].Date != "2026-10-22" || got[0].Overdue || got[1].Date != "2026-10-23" || got[1].Overdue {
		t.Fatalf("WIT today %v %+v", err, got)
	}
}

func (e *env) count(sql string, args ...any) int {
	e.t.Helper()
	var n int
	e.scalar(&n, sql, args...)
	return n
}

// taskStaff makes an account with the tasks menu. The transaction is rolled
// back before the account's cleanup deletes it: employee rows reference it.
func (e *env) taskStaff() testutil.Staff {
	e.t.Helper()
	s := testutil.CreateStaff(e.t, testutil.StaffOptions{Role: "pos", Menus: ownMenus})
	e.t.Cleanup(func() { _ = e.tx.Rollback(e.ctx) })
	return s
}
