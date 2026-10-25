package gymautomation_test

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"testing"
	"time"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/gymautomation"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/jobs"
	"nuhabit/backend/internal/platform/testutil"
)

// The tests run on the pool, not a rolled-back transaction: the job lock
// and the switch are read on their own connections. Rows are keyed by a
// random job name and removed afterwards.

type headerGuard struct{}

func (headerGuard) RequireAnyGrant(r *http.Request, _ ...iam.Grant) (*auth.User, int, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, -1, httpx.Unauthorized("")
	}
	return &auth.User{ID: id}, 0, nil
}

const staff = "6f1c2a1e-0d7b-4c55-9a43-1b0b6a0f5e11"

// fakeJobs registers one test job plus the auto-close job (for its
// setting) and runs them through the real Postgres lock.
type fakeJobs struct {
	locker jobs.PostgresLocker
	name   string
	ran    int
	fail   error
}

func (f *fakeJobs) List() []gymautomation.Job {
	return []gymautomation.Job{
		{Name: f.name, Module: "gym-test", Every: time.Hour},
		{Name: gymautomation.AutoCloseJob, Module: "gym-scheduling", Every: 10 * time.Minute},
	}
}

func (f *fakeJobs) Run(ctx context.Context, name string, now time.Time) error {
	if name != f.name {
		return gymautomation.ErrUnknownJob
	}
	return jobs.RunNow(ctx, f.locker, jobs.Job{Name: name, Every: time.Hour, Run: func(context.Context, time.Time) error {
		f.ran++
		return f.fail
	}}, now)
}

func TestAutomation(t *testing.T) {
	deps := testutil.Deps(t, nil)
	db, ctx := deps.DB, context.Background()
	name := "gym-test.job-" + testutil.RandomHex(4)
	cleanup := func() {
		for _, n := range []string{name, gymautomation.AutoCloseJob} {
			_, _ = db.Exec(context.Background(), `DELETE FROM platform.job_settings WHERE name = $1`, n)
		}
		_, _ = db.Exec(context.Background(), `DELETE FROM platform.job_runs WHERE name = $1`, name)
	}
	var autoCloseSetting []byte
	_ = db.QueryRow(ctx, `SELECT config FROM platform.job_settings WHERE name = $1`, gymautomation.AutoCloseJob).Scan(&autoCloseSetting)
	if autoCloseSetting != nil {
		t.Skip("the auto-close job has settings on this database")
	}
	t.Cleanup(cleanup)

	fake := &fakeJobs{locker: jobs.PostgresLocker{DB: db}, name: name}
	ports := app.GymAutomationPorts(deps)
	ports.Jobs = fake
	mux := testutil.Mux(gymautomation.NewOn(db, headerGuard{}, nil, ports))
	call := func(method, target string, body any) (int, map[string]any) {
		t.Helper()
		r := testutil.Request(method, target, body)
		r.Header.Set("X-Test-Staff", staff)
		rec, out := testutil.Do(t, mux, r)
		return rec.Code, out
	}
	jobView := func(n string) map[string]any {
		t.Helper()
		code, out := call("GET", "/api/gym/automation/jobs", nil)
		if code != 200 {
			t.Fatalf("jobs = %d %v", code, out)
		}
		for _, j := range out["data"].([]any) {
			if row := j.(map[string]any); row["name"] == n {
				return row
			}
		}
		t.Fatalf("job %s not listed", n)
		return nil
	}

	if j := jobView(name); j["status"] != "never" || j["enabled"] != true || j["label"] != name || j["everySeconds"] != 3600.0 {
		t.Fatalf("new job = %v", j)
	}
	auto := jobView(gymautomation.AutoCloseJob)
	settings := auto["settings"].([]any)
	if len(settings) != 1 || settings[0].(map[string]any)["value"] != 30.0 || auto["label"] != "Tutup sesi otomatis" {
		t.Fatalf("auto-close = %v", auto)
	}

	// Settings: only the job's own, inside their range.
	if code, out := call("PATCH", "/api/gym/automation/jobs/"+gymautomation.AutoCloseJob, map[string]any{"settings": map[string]any{"graceMinutes": 9999}}); code != 400 {
		t.Fatalf("grace out of range = %d %v", code, out)
	}
	if code, out := call("PATCH", "/api/gym/automation/jobs/"+name, map[string]any{"settings": map[string]any{"graceMinutes": 10}}); code != 400 {
		t.Fatalf("setting of another job = %d %v", code, out)
	}
	if code, _ := call("PATCH", "/api/gym/automation/jobs/gym-test.nope", map[string]any{"enabled": false}); code != 404 {
		t.Fatalf("unknown job = %d", code)
	}
	if code, out := call("PATCH", "/api/gym/automation/jobs/"+gymautomation.AutoCloseJob, map[string]any{"settings": map[string]any{"graceMinutes": 45}}); code != 200 {
		t.Fatalf("save grace = %d %v", code, out)
	}
	if v := jobView(gymautomation.AutoCloseJob)["settings"].([]any)[0].(map[string]any)["value"]; v != 45.0 {
		t.Fatalf("grace after save = %v", v)
	}
	grace := map[string]int{}
	if err := jobs.Config(ctx, db, gymautomation.AutoCloseJob, &grace); err != nil || grace["graceMinutes"] != 45 {
		t.Fatalf("job reads grace %v %v", grace, err)
	}

	// Switched off: the runner skips it, a manual run still goes.
	if code, out := call("PATCH", "/api/gym/automation/jobs/"+name, map[string]any{"enabled": false}); code != 200 {
		t.Fatalf("switch off = %d %v", code, out)
	}
	if _, ok, err := fake.locker.Acquire(ctx, name, time.Hour, time.Now()); err != nil || ok {
		t.Fatalf("runner took a switched-off job: ok=%v err=%v", ok, err)
	}
	if code, out := call("POST", "/api/gym/automation/jobs/"+name+"/run", nil); code != 200 || fake.ran != 1 {
		t.Fatalf("run now = %d %v ran=%d", code, out, fake.ran)
	}
	if j := jobView(name); j["status"] != "ok" || j["enabled"] != false || j["lastSucceededAt"] == nil {
		t.Fatalf("after run = %v", j)
	}

	// A run in progress refuses a second one; a failing run reports its error.
	release, ok, err := fake.locker.AcquireNow(ctx, name, time.Now())
	if err != nil || !ok {
		t.Fatalf("hold lock: %v %v", ok, err)
	}
	if code, _ := call("POST", "/api/gym/automation/jobs/"+name+"/run", nil); code != 409 {
		t.Fatalf("run while running = %d", code)
	}
	release(nil)
	fake.fail = errors.New("boom")
	if code, out := call("POST", "/api/gym/automation/jobs/"+name+"/run", nil); code != 500 || out["error"] != "Job gagal: boom" {
		t.Fatalf("failing run = %d %v", code, out)
	}
	if j := jobView(name); j["status"] != "failed" || j["lastError"] != "boom" {
		t.Fatalf("after failure = %v", j)
	}

	// The registry hands over the gym jobs only.
	real := app.GymAutomationPorts(deps).Jobs.List()
	names := make([]string, len(real))
	for i, j := range real {
		names[i] = j.Name
	}
	if !slices.Contains(names, gymautomation.AutoCloseJob) || !slices.Contains(names, "member-portal.referral-rewards") {
		t.Fatalf("registry jobs = %v", names)
	}

	// Member notification log.
	member := testutil.CreateMember(t)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM platform.reminder_sends WHERE customer_id = $1`, member.CustomerID)
	})
	if _, err := db.Exec(ctx, `INSERT INTO platform.reminder_sends (kind, subject_id, period, customer_id) VALUES ('gym_class_reminder', $1, '2031-03-01', $2)`,
		testutil.RandomHex(8), member.CustomerID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO crm.member_notifications (customer_id, type, title, body) VALUES ($1, 'gym_class_reminder', 'Kelas sebentar lagi', 'HYROX 07:30')`,
		member.CustomerID); err != nil {
		t.Fatal(err)
	}
	code, out := call("GET", "/api/gym/automation/members?q="+member.Phone[3:], nil)
	if hits, _ := out["data"].([]any); code != 200 || len(hits) == 0 || hits[0].(map[string]any)["id"] != member.CustomerID {
		t.Fatalf("search = %d %v", code, out)
	}
	code, out = call("GET", "/api/gym/automation/members/"+member.CustomerID+"/notifications", nil)
	data, _ := out["data"].(map[string]any)
	if code != 200 || len(data["reminders"].([]any)) != 1 || len(data["notifications"].([]any)) != 1 ||
		data["reminders"].([]any)[0].(map[string]any)["kind"] != "gym_class_reminder" {
		t.Fatalf("member log = %d %v", code, out)
	}
	if code, _ := call("GET", "/api/gym/automation/members/00000000-0000-4000-8000-000000000000/notifications", nil); code != 404 {
		t.Fatalf("unknown member = %d", code)
	}
}
