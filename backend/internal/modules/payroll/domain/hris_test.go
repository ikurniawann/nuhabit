package domain

import (
	"math"
	"reflect"
	"strings"
	"testing"
)

func att(direction string, actual, target float64) *float64 {
	return Attainment(direction, &actual, &target)
}

func TestAttainment(t *testing.T) {
	cases := []struct {
		name    string
		got     *float64
		want    float64
		wantNil bool
	}{
		{"meets", att("higher_better", 100, 100), 1, false},
		{"half", att("higher_better", 50, 100), 0.5, false},
		{"cap", att("higher_better", 500, 100), AttainmentCap, false},
		{"negative clamps", att("higher_better", -5, 100), 0, false},
		{"zero target", att("higher_better", 10, 0), 0, true},
		{"lower meets", att("lower_better", 5, 5), 1, false},
		{"lower better", att("lower_better", 1, 10), AttainmentCap, false},
		{"lower worse", att("lower_better", 20, 10), 0.5, false},
		{"lower perfect", att("lower_better", 0, 10), AttainmentCap, false},
		{"lower zero target ok", att("lower_better", 0, 0), 1, false},
		{"lower zero target miss", att("lower_better", 2, 0), 0, false},
		{"boolean", att("boolean", 1, 0), 1, false},
		{"boolean miss", att("boolean", 0.5, 0), 0, false},
	}
	for _, c := range cases {
		if c.wantNil != (c.got == nil) || (c.got != nil && *c.got != c.want) {
			t.Errorf("%s = %v", c.name, c.got)
		}
	}
	if Attainment("higher_better", nil, nil) != nil {
		t.Fatal("no actual")
	}
}

func TestComposeScore(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	if s := ComposeScore([]ScoreComponent{{"a", 60, f(1)}, {"b", 40, f(1)}}); *s.Score != 100 || len(s.Excluded) != 0 {
		t.Fatal(s)
	}
	if s := ComposeScore([]ScoreComponent{{"a", 50, f(0.8)}, {"b", 50, f(0.6)}}); *s.Score != 70 {
		t.Fatal(*s.Score)
	}
	if s := ComposeScore([]ScoreComponent{{"a", 50, f(1.2)}, {"b", 50, f(0.9)}}); *s.Score != 100 || *s.RawScore != 105 {
		t.Fatal(*s.Score, *s.RawScore)
	}
	s := ComposeScore([]ScoreComponent{{"a", 50, f(0.9)}, {"b", 25, nil}, {"c", 25, f(0.6)}})
	if *s.Score != 80 || !reflect.DeepEqual(s.Excluded, []string{"b"}) || math.Abs(s.Breakdown[0].EffectiveWeight-66.67) > 0.01 {
		t.Fatal(s)
	}
	if s := ComposeScore([]ScoreComponent{{"a", 100, nil}}); s.Score != nil || s.Excluded[0] != "a" {
		t.Fatal("all excluded")
	}
	if ComposeScore(nil).Score != nil {
		t.Fatal("empty")
	}
	if s := ComposeScore([]ScoreComponent{{"a", 100, f(0.5)}, {"b", 0, f(1)}}); *s.Score != 50 || len(s.Breakdown) != 2 || s.Excluded[0] != "b" {
		t.Fatal(s)
	}
	if s := ComposeScore([]ScoreComponent{{"a", 33, f(1)}, {"b", 33, f(1)}, {"c", 34, f(0.5)}}); *s.Score != 83 {
		t.Fatal(*s.Score)
	}
	if FormatNumberID(83.333, 3) != "83,333" || FormatNumberID(1234.5, 3) != "1.234,5" || FormatNumberID(100, 3) != "100" {
		t.Fatal(FormatNumberID(83.333, 3), FormatNumberID(1234.5, 3))
	}
}

func TestDeptTasks(t *testing.T) {
	ptrI := func(i int) *int { return &i }
	join := func(s []string) string { return strings.Join(s, ",") }
	if got := OccurrenceDates(TaskSchedule{Recurrence: "daily"}, "2026-09-01", "2026-09-05"); len(got) != 5 {
		t.Fatal(got)
	}
	if got := OccurrenceDates(TaskSchedule{Recurrence: "weekly", WeeklyDay: ptrI(1)}, "2026-09-01", "2026-09-30"); join(got) != "2026-09-07,2026-09-14,2026-09-21,2026-09-28" {
		t.Fatal(got)
	}
	if got := OccurrenceDates(TaskSchedule{Recurrence: "monthly", MonthlyDay: ptrI(15)}, "2026-09-01", "2026-10-31"); join(got) != "2026-09-15,2026-10-15" {
		t.Fatal(got)
	}
	due := "2026-09-10"
	once := TaskSchedule{Recurrence: "once", DueDate: &due}
	if join(OccurrenceDates(once, "2026-09-01", "2026-09-30")) != due || len(OccurrenceDates(once, "2026-10-01", "2026-10-31")) != 0 {
		t.Fatal("once")
	}
	if len(OccurrenceDates(TaskSchedule{Recurrence: "daily"}, "2026-09-05", "2026-09-01")) != 0 {
		t.Fatal("reversed")
	}
	if s, e := MonthRange("2028-02"); s != "2028-02-01" || e != "2028-02-29" {
		t.Fatal(s, e)
	}
	w := SplitSubtaskWeights([]string{"a", "b", "c"})
	if w[0].Weight != 33.33 || w[2].Weight != 33.34 || len(SplitSubtaskWeights(nil)) != 0 {
		t.Fatal(w)
	}
	str := func(s string) *string { return &s }
	for body, msg := range map[*TaskBody]string{
		{Title: str("ab")}: "Judul task minimal 3 karakter",
		{Title: str("Cek stok"), Recurrence: str("tahunan")}:                   "Jenis pengulangan tidak dikenal",
		{Title: str("Cek stok")}:                                               "Task sekali jalan membutuhkan tanggal jatuh tempo",
		{Title: str("Cek stok"), Recurrence: str("weekly"), WeeklyDay: 8.0}:    "Task mingguan membutuhkan hari (Senin–Minggu)",
		{Title: str("Cek stok"), Recurrence: str("monthly"), MonthlyDay: 31.0}: "Task bulanan membutuhkan tanggal 1–28",
	} {
		if _, got := NormalizeDeptTask(*body); got != msg {
			t.Errorf("%v = %q, want %q", *body.Title, got, msg)
		}
	}
	task, msg := NormalizeDeptTask(TaskBody{Title: str(" Bersih gudang "), Recurrence: str("weekly"), WeeklyDay: "3",
		MonthlyDay: 5.0, DueDate: str("2026-10-10"), Subtasks: []*string{str("Sapu"), str(" "), str("Pel")}})
	if msg != "" || task.Title != "Bersih gudang" || *task.Schedule.WeeklyDay != 3 || task.Schedule.MonthlyDay != nil ||
		task.Schedule.DueDate != nil || len(task.Subtasks) != 2 || task.Subtasks[1].Weight != 50 {
		t.Fatalf("%q %+v", msg, task)
	}
}

func TestPerformanceReview(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	if !reflect.DeepEqual(QuarterMonths(3), []int{7, 8, 9}) {
		t.Fatal("months")
	}
	if s, e := QuarterRange(2026, 2); s != "2026-04-01" || e != "2026-06-30" {
		t.Fatal(s, e)
	}
	if _, e := QuarterRange(2028, 1); e != "2028-03-31" || QuarterLabel(2026, 3) != "Q3 2026" {
		t.Fatal(e)
	}
	if *CombineReviewScores(f(80), f(90), f(100)) != 85 || *CombineReviewScores(f(90), f(60), nil) != 80 ||
		*CombineReviewScores(f(77.5), nil, nil) != 77.5 || CombineReviewScores(nil, nil, nil) != nil {
		t.Fatal("combine")
	}
	i := func(v int) *int { return &v }
	if *BehaviorScore([]BehaviorItem{{i(5), "20"}, {i(4), "20"}, {i(3), "20"}, {i(4), "20"}, {i(4), "20"}}) != 80 ||
		*BehaviorScore([]BehaviorItem{{i(5), "20"}, {nil, "20"}}) != 100 || BehaviorScore(nil) != nil {
		t.Fatal("behavior")
	}
	if _, msg := ProjectScore(f(101)); msg == "" {
		t.Fatal("project range")
	}
	if n, msg := BehaviorRating(4); n != 4 || msg != "" {
		t.Fatal("rating")
	}
	if _, msg := BehaviorRating(4.5); msg != "Skor harus 1–5" {
		t.Fatal("fraction")
	}
	for score, grade := range map[float64]string{95: "A", 90: "A", 85: "B", 70: "C", 60: "D", 59.9: "E"} {
		if FinalGrade(score) != grade {
			t.Errorf("%v", score)
		}
	}
	if s, g := FinalScore(80, 100, f(50), f(50)); s != 90 || g != "A" {
		t.Fatal(s, g)
	}
	if s, g := FinalScore(80, 60, nil, nil); math.Abs(s-74) > 1e-9 || g != "C" {
		t.Fatal(s, g)
	}
}
