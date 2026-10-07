package domain

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func ptr[T any](v T) *T { return &v }

func TestPortalToken(t *testing.T) {
	if !IsPortalToken(strings.Repeat("a", 48)) || IsPortalToken(strings.Repeat("a", 47)) || IsPortalToken(strings.Repeat("a", 47)+"/") {
		t.Fatal("token is hex of 48 to 128 characters")
	}
}

func TestIsLinkExpired(t *testing.T) {
	day := 24 * time.Hour
	now := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	at := func(s string) *time.Time { v, _ := time.Parse(time.RFC3339, s); return &v }
	cases := []struct {
		expires, issued *time.Time
		want            bool
	}{
		{at("2026-10-03T23:59:59Z"), nil, true},
		{at("2026-10-05T00:00:00Z"), nil, false},
		{nil, at("2026-10-01T00:00:00Z"), true},
		{nil, at("2026-10-03T12:00:00Z"), false},
		{nil, nil, true},
	}
	for i, c := range cases {
		if got := IsLinkExpired(c.expires, c.issued, day, now); got != c.want {
			t.Errorf("case %d: got %v", i, got)
		}
	}
}

func TestOfferResponseDescription(t *testing.T) {
	if got := OfferResponseDescription("decline", 1, nil); got != "Kandidat menolak offer v1 via portal" {
		t.Fatal(got)
	}
	long := OfferResponseDescription("negotiate", 3, ptr(strings.Repeat("x", 400)))
	if long != `Kandidat mengajukan negosiasi offer v3 via portal — "`+strings.Repeat("x", 300)+`"` {
		t.Fatal(long)
	}
	if got := ManualOfferResponseDescription("accepted", 2, "Siap"); got != `Kandidat menerima offer v2 (dicatat manual) — "Siap"` {
		t.Fatal(got)
	}
}

func TestLikePatternEscapesWildcards(t *testing.T) {
	if got := LikePattern(`50%_a`); got != `%50\%\_a%` {
		t.Fatal(got)
	}
}

func TestStatusLabels(t *testing.T) {
	if l, ok := StatusLabel("archived"); !ok || l != "Diarsipkan" {
		t.Fatal("archived is the talent pool archive")
	}
	if _, ok := StatusLabel("constructor"); ok {
		t.Fatal("only own keys are statuses")
	}
	if RecommendationSuffix(ptr("tidak_lolos")) != " (rekomendasi: Tidak Lolos)" || RecommendationSuffix(nil) != "" {
		t.Fatal("recommendation suffix")
	}
}

func TestScoreMcq(t *testing.T) {
	q := func(id, c string) McqQuestion { return McqQuestion{ID: id, Correct: ptr(c)} }
	score, d := ScoreMcq([]McqQuestion{q("q1", "a"), q("q2", "c")}, map[string]string{"q1": "a", "q2": "c"})
	if score != 100 || d.Correct != 2 || d.Total != 2 {
		t.Fatal("all correct is 100")
	}
	if score, _ := ScoreMcq([]McqQuestion{q("q1", "a"), q("q2", "b"), q("q3", "c")}, map[string]string{"q1": "a", "q2": "b", "q3": "d"}); score != 67 {
		t.Fatalf("2 of 3 rounds to 67, got %d", score)
	}
	score, d = ScoreMcq([]McqQuestion{q("q1", "a"), q("q2", "b")}, map[string]string{"q1": "a"})
	want := []McqItem{{ID: "q1", Given: ptr("a"), CorrectKey: "a", IsCorrect: true}, {ID: "q2", CorrectKey: "b"}}
	if score != 50 || !reflect.DeepEqual(d.PerQuestion, want) {
		t.Fatalf("unanswered is wrong: %d %+v", score, d.PerQuestion)
	}
	if score, d := ScoreMcq(nil, nil); score != 0 || d.Total != 0 {
		t.Fatal("empty is 0")
	}
	if score, _ := ScoreMcq([]McqQuestion{q("q1", "a")}, map[string]string{"q1": "z"}); score != 0 {
		t.Fatal("unknown key is wrong")
	}
	if score, d := ScoreMcq([]McqQuestion{q("q1", "a"), {ID: "q2"}}, map[string]string{"q1": "a"}); d.Total != 1 || score != 100 {
		t.Fatal("questions without a key are skipped")
	}
}

func TestScorePapi(t *testing.T) {
	p := func(id, a, b string) PapiQuestion { return PapiQuestion{ID: id, ScaleA: a, ScaleB: b} }
	r := ScorePapi([]PapiQuestion{p("q1", "A", "G"), p("q2", "A", "L"), p("q3", "P", "A")}, map[string]string{"q1": "a", "q2": "a", "q3": "b"})
	if r.Scales["A"] != 3 || r.Scales["G"] != 0 || r.Answered != 3 || r.Total != 3 || len(r.Scales) != 20 {
		t.Fatalf("%+v", r)
	}
	r = ScorePapi([]PapiQuestion{p("q1", "A", "G"), p("q2", "A", "L")}, map[string]string{"q1": "a", "q2": "a"})
	if !reflect.DeepEqual(r.Dominant, []PapiDominant{{Code: "A", Label: "Dorongan Berprestasi", Count: 2}}) {
		t.Fatalf("%+v", r.Dominant)
	}
	r = ScorePapi([]PapiQuestion{p("q1", "L", "G"), p("q2", "A", "P")}, map[string]string{"q1": "a", "q2": "a"})
	if len(r.Dominant) != 2 || r.Dominant[0].Code != "A" || r.Dominant[1].Code != "L" {
		t.Fatalf("ties follow the PAPI scale order: %+v", r.Dominant)
	}
	r = ScorePapi([]PapiQuestion{p("q1", "A", "G"), p("q2", "L", "P")}, map[string]string{"q1": "x"})
	if r.Answered != 0 || len(r.Dominant) != 0 {
		t.Fatal("invalid choices are ignored")
	}
	r = ScorePapi([]PapiQuestion{p("q1", "A", "G"), {ID: "q2"}}, map[string]string{"q1": "a", "q2": "a"})
	if r.Total != 1 || r.Scales["A"] != 1 {
		t.Fatal("pairs without options are skipped")
	}
}

func TestSanitizeQuestions(t *testing.T) {
	mcq := SanitizeQuestions("mcq", []QuestionRow{{ID: "q1", Body: "2+2?", Options: []any{map[string]any{"key": "a", "text": "4", "correct": true}}}})
	if !reflect.DeepEqual(mcq[0].Options, []McqOption{{Key: "a", Text: "4"}}) {
		t.Fatalf("%+v", mcq[0].Options)
	}
	papi := SanitizeQuestions("forced_choice", []QuestionRow{{ID: "p1", Options: map[string]any{
		"a": map[string]any{"text": "Saya rajin", "scale": "N"}, "b": map[string]any{"text": "Saya tenang", "scale": "E"},
	}}})
	if !reflect.DeepEqual(papi[0].Options, papiPair{A: papiText{"Saya rajin"}, B: papiText{"Saya tenang"}}) {
		t.Fatalf("%+v", papi[0].Options)
	}
	if o := SanitizeQuestions("mcq", []QuestionRow{{ID: "q"}})[0].Options; !reflect.DeepEqual(o, []McqOption{}) {
		t.Fatal("broken options become empty")
	}
	if o := SanitizeQuestions("forced_choice", []QuestionRow{{ID: "p"}})[0].Options; !reflect.DeepEqual(o, papiPair{A: papiText{""}, B: papiText{""}}) {
		t.Fatal("broken pair becomes empty texts")
	}
}

func TestNarrowing(t *testing.T) {
	if k := ToMcqAnswerKey(map[string]any{"correct": "b"}); k == nil || *k != "b" {
		t.Fatal("answer key")
	}
	if ToMcqAnswerKey(map[string]any{"correct": 2.0}) != nil || ToMcqAnswerKey(nil) != nil {
		t.Fatal("non-string keys are nil")
	}
	if a, b := ToPapiScales(map[string]any{"a": map[string]any{"scale": "N", "text": "x"}, "b": map[string]any{"scale": "G"}}); a != "N" || b != "G" {
		t.Fatal("papi scales")
	}
	if a, _ := ToPapiScales(map[string]any{"a": map[string]any{"scale": "N"}}); a != "" {
		t.Fatal("half a pair is nothing")
	}
}

func TestPickDrawnAnswers(t *testing.T) {
	if got := PickDrawnAnswers([]string{"q1", "q2"}, map[string]string{"q1": "a", "q9": "b"}); !reflect.DeepEqual(got, map[string]string{"q1": "a"}) {
		t.Fatal(got)
	}
	if got := PickDrawnAnswers(nil, map[string]string{"q1": "a"}); len(got) != 0 {
		t.Fatal(got)
	}
}

func TestSlugifyAndNormalize(t *testing.T) {
	if Slugify("  Head Barista (Jakarta)! ") != "head-barista-jakarta" || Slugify("  Kitchen & Bar (Shift Malam) ") != "kitchen-bar-shift-malam" {
		t.Fatal("slugify")
	}
	now := time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)
	p := NormalizeJobOpening(map[string]any{"title": " Barista Senior ", "status": "published", "headcount": float64(3)}, false, now)
	if p.Slug != "barista-senior" || p.Location != "Jakarta, ID" || p.Headcount != "3" || p.PublishedAt == nil || *p.PublishedAt != "2026-10-04T03:00:00.000Z" {
		t.Fatalf("%+v", p)
	}
	p = NormalizeJobOpening(map[string]any{"title": "Kasir", "status": "published", "published_at": "2026-01-01T00:00:00.000Z"}, true, now)
	if *p.PublishedAt != "2026-01-01T00:00:00.000Z" {
		t.Fatal("update keeps the sent published_at")
	}
	p = NormalizeJobOpening(map[string]any{"title": "Kasir", "brand_id": float64(12)}, false, now)
	if p.BrandID != nil || p.Status != "draft" || p.PublishedAt != nil || p.Headcount != "1" {
		t.Fatalf("%+v", p)
	}
	if NormalizeJobOpening(map[string]any{"headcount": "abc"}, false, now).Headcount != "NaN" {
		t.Fatal("Number('abc') is NaN")
	}
}

func TestValidateJobOpening(t *testing.T) {
	now := time.Now()
	if ValidateJobOpening(NormalizeJobOpening(map[string]any{}, false, now), false) != "Judul lowongan wajib diisi" {
		t.Fatal("title required")
	}
	odd := NormalizeJobOpening(map[string]any{"title": "Kasir", "status": "arsip"}, false, now)
	if ValidateJobOpening(odd, false) != "Status lowongan tidak valid" || ValidateJobOpening(odd, true) != "" {
		t.Fatal("status is only checked on create")
	}
}

func TestDraftFromEmploymentStatus(t *testing.T) {
	d, _ := DraftFromEmploymentStatus("contract", "2026-08-01")
	if d.ContractType != "pkwt" || *d.EndDate != "2027-08-01" || d.ProbationEndDate != nil {
		t.Fatalf("%+v", d)
	}
	d, _ = DraftFromEmploymentStatus("probation", "2026-08-01")
	if d.ContractType != "pkwtt" || d.EndDate != nil || *d.ProbationEndDate != "2026-11-01" {
		t.Fatalf("%+v", d)
	}
	d, _ = DraftFromEmploymentStatus("permanent", "2026-08-01")
	if d.ContractType != "pkwtt" || d.EndDate != nil || d.ProbationEndDate != nil {
		t.Fatalf("%+v", d)
	}
	if d, err := DraftFromEmploymentStatus("internship", "2026-08-01"); d != nil || err != nil {
		t.Fatal("internship gets no draft")
	}
	if got, _ := AddMonthsISO("2026-01-31", 1); got != "2026-02-28" {
		t.Fatal(got)
	}
	if _, err := DraftFromEmploymentStatus("contract", "2026-08-01T10:00"); err == nil {
		t.Fatal("an unreadable join date fails like the TS RangeError")
	}
	if got := ContractNumber("pkwt", 7, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)); got != "0007/PKWT/VII/2026" {
		t.Fatal(got)
	}
}
