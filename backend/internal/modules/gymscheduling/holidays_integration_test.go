package gymscheduling

import (
	"context"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/testutil"
)

// fakeHolidays is a holiday calendar held in a map.
type fakeHolidays map[string]string

func (f fakeHolidays) Holidays(_ context.Context, _ database.Querier, from, to string) (map[string]string, error) {
	out := map[string]string{}
	for d, n := range f {
		if d >= from && d <= to {
			out[d] = n
		}
	}
	return out, nil
}

// Templates skip holiday dates unless skip_holidays is off; a skipped date
// is generated once the holiday is gone.
func TestGenerationSkipsHolidays(t *testing.T) {
	f := newFixture(t)
	f.exec(`UPDATE gym.session_templates SET active = false`)
	typeID, _ := f.classType(1)
	create := func(body map[string]any) string {
		t.Helper()
		body["class_type_id"], body["weekday"], body["valid_from"] = typeID, 1, "2031-01-01"
		res := f.asStaff("POST", "/api/gym/session-templates", body)
		if res.Status != 200 {
			t.Fatalf("create template: %s", res.Raw)
		}
		return res.data()["id"].(string)
	}
	skipping := create(map[string]any{"start_time": "06:05", "area": "Go Room " + testutil.RandomHex(3)})
	keeping := create(map[string]any{"start_time": "09:05", "area": "Go Room " + testutil.RandomHex(3), "skip_holidays": false})
	for _, r := range f.asStaff("GET", "/api/gym/session-templates", nil).data()["templates"].([]any) {
		row := r.(map[string]any)
		if (row["id"] == skipping && row["skip_holidays"] != true) || (row["id"] == keeping && row["skip_holidays"] != false) {
			t.Fatalf("listed template: %v", row)
		}
	}

	calendar := fakeHolidays{"2031-03-10": "Hari Raya Nyepi", "2031-06-01": "Hari Lahir Pancasila"}
	svc := f.service(NotificationsSQL{})
	svc.Holidays = calendar
	// Sunday 2 March 2031, 17.00 WIB: Mondays 3 and 10 March are in range.
	now := time.Date(2031, 3, 2, 17, 0, 0, 0, localtime.Jakarta)
	out, err := svc.generateFromTemplates(f.ctx, now, 13)
	if err != nil || out.Created != 3 || len(out.Holidays) != 1 ||
		out.Holidays[0] != (HolidaySkip{Date: "2031-03-10", Name: "Hari Raya Nyepi", Sessions: 1}) {
		t.Fatalf("first run: %+v %v", out, err)
	}
	dates := func(templateID string) string {
		return f.scalar(`SELECT string_agg(occurrence_date::text, ',' ORDER BY occurrence_date) FROM gym.class_sessions WHERE template_id = $1`, templateID)
	}
	if got := dates(skipping); got != "2031-03-03" {
		t.Fatalf("skipping template dates = %s", got)
	}
	if got := dates(keeping); got != "2031-03-03,2031-03-10" {
		t.Fatalf("keeping template dates = %s", got)
	}

	// Once HR removes the holiday, the next run fills the date.
	delete(calendar, "2031-03-10")
	out, err = svc.generateFromTemplates(f.ctx, now, 13)
	if err != nil || out.Created != 1 || len(out.Holidays) != 0 || dates(skipping) != "2031-03-03,2031-03-10" {
		t.Fatalf("after the holiday is removed: %+v %v %s", out, err, dates(skipping))
	}
}
