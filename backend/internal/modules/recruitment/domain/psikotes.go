package domain

import (
	"math"
	"slices"
)

// Psikotes scoring and question shaping (psikotes-scoring.ts,
// psikotes-runner.ts). Answer keys never leave the server; scores are
// computed here and snapshotted into psikotes_session_tests.score_detail.

// PapiScaleCodes are the 20 PAPI Kostick scales in declaration order.
var PapiScaleCodes = []string{"N", "G", "A", "L", "P", "I", "T", "V", "X", "S", "B", "O", "R", "D", "C", "Z", "E", "K", "F", "W"}

var papiScaleLabels = map[string]string{
	"N": "Kebutuhan Menyelesaikan Tugas",
	"G": "Peran Pekerja Keras",
	"A": "Dorongan Berprestasi",
	"L": "Peran Kepemimpinan",
	"P": "Kebutuhan Mengatur Orang Lain",
	"I": "Peran Membuat Keputusan",
	"T": "Peran Sibuk",
	"V": "Peran Penuh Semangat",
	"X": "Kebutuhan Diperhatikan",
	"S": "Peran Hubungan Sosial",
	"B": "Kebutuhan Diterima Kelompok",
	"O": "Kedekatan & Kasih Sayang",
	"R": "Peran Teoretis",
	"D": "Peran Bekerja dengan Detail",
	"C": "Peran Keteraturan",
	"Z": "Kebutuhan akan Perubahan",
	"E": "Pengendalian Emosi",
	"K": "Kebutuhan Agresi",
	"F": "Dukungan terhadap Atasan",
	"W": "Kebutuhan Aturan & Arahan",
}

// TerminalTestStatuses are the session test statuses that end a test.
var TerminalTestStatuses = []string{"selesai", "perlu_review", "reviewed"}

// IsTerminalTest reports whether a session test is finished.
func IsTerminalTest(status string) bool { return slices.Contains(TerminalTestStatuses, status) }

// IsReviewable reports whether a test sits in the manual review queue.
func IsReviewable(status string) bool { return status == "perlu_review" || status == "reviewed" }

// McqQuestion is a question with its narrowed answer key (nil when absent).
type McqQuestion struct {
	ID      string
	Correct *string
}

// McqItem is one per_question entry of an MCQ score.
type McqItem struct {
	ID         string  `json:"id"`
	Given      *string `json:"given"`
	CorrectKey string  `json:"correct_key"`
	IsCorrect  bool    `json:"is_correct"`
}

// McqDetail is the MCQ score_detail snapshot.
type McqDetail struct {
	Total       int       `json:"total"`
	Correct     int       `json:"correct"`
	PerQuestion []McqItem `json:"per_question"`
}

// ScoreMcq scores 0..100 (rounded half up) over the questions with a key.
func ScoreMcq(questions []McqQuestion, answers map[string]string) (int, McqDetail) {
	detail := McqDetail{PerQuestion: []McqItem{}}
	for _, q := range questions {
		if q.Correct == nil || *q.Correct == "" {
			continue
		}
		item := McqItem{ID: q.ID, CorrectKey: *q.Correct}
		if given, ok := answers[q.ID]; ok {
			item.Given = &given
			item.IsCorrect = given == *q.Correct
		}
		if item.IsCorrect {
			detail.Correct++
		}
		detail.PerQuestion = append(detail.PerQuestion, item)
	}
	detail.Total = len(detail.PerQuestion)
	if detail.Total == 0 {
		return 0, detail
	}
	return int(math.Floor(float64(detail.Correct)/float64(detail.Total)*100 + 0.5)), detail
}

// PapiQuestion is a forced-choice pair with the scale of each statement
// ("" when the jsonb is malformed).
type PapiQuestion struct {
	ID     string
	ScaleA string
	ScaleB string
}

// PapiDominant is one top scale.
type PapiDominant struct {
	Code  string `json:"code"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

// PapiResult is the forced-choice score_detail snapshot.
type PapiResult struct {
	Scales   map[string]int `json:"scales"`
	Dominant []PapiDominant `json:"dominant"`
	Answered int            `json:"answered"`
	Total    int            `json:"total"`
}

// ScorePapi counts the chosen scale of every answered pair; the dominant
// scales are the ties at the highest count, in scale order.
func ScorePapi(questions []PapiQuestion, answers map[string]string) PapiResult {
	res := PapiResult{Scales: map[string]int{}, Dominant: []PapiDominant{}}
	for _, c := range PapiScaleCodes {
		res.Scales[c] = 0
	}
	for _, q := range questions {
		if q.ScaleA == "" || q.ScaleB == "" {
			continue
		}
		res.Total++
		scale := ""
		switch answers[q.ID] {
		case "a":
			scale = q.ScaleA
		case "b":
			scale = q.ScaleB
		default:
			continue
		}
		if _, ok := papiScaleLabels[scale]; !ok {
			continue
		}
		res.Scales[scale]++
		res.Answered++
	}
	top := 0
	for _, n := range res.Scales {
		top = max(top, n)
	}
	if top == 0 {
		return res
	}
	for _, c := range PapiScaleCodes {
		if res.Scales[c] == top {
			res.Dominant = append(res.Dominant, PapiDominant{Code: c, Label: papiScaleLabels[c], Count: top})
		}
	}
	return res
}

// ToMcqAnswerKey narrows a decoded answer_key jsonb to its correct key.
func ToMcqAnswerKey(v any) *string {
	m, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	if s, ok := m["correct"].(string); ok {
		return &s
	}
	return nil
}

// ToPapiScales narrows decoded PAPI options to the two scale codes ("" when
// either is missing).
func ToPapiScales(v any) (a, b string) {
	m, _ := v.(map[string]any)
	scale := func(key string) (string, bool) {
		side, _ := m[key].(map[string]any)
		s, ok := side["scale"].(string)
		return s, ok
	}
	sa, okA := scale("a")
	sb, okB := scale("b")
	if !okA || !okB {
		return "", ""
	}
	return sa, sb
}

// McqOption is an option sent to the candidate (no answer flag). A field
// that is absent in the jsonb stays absent, as JSON.stringify drops undefined.
type McqOption struct {
	Key  any `json:"key,omitempty"`
	Text any `json:"text,omitempty"`
}

// CandidateQuestion is a question without its answer key.
type CandidateQuestion struct {
	ID      string `json:"id"`
	Body    string `json:"body"`
	Options any    `json:"options"`
}

type papiText struct {
	Text any `json:"text"`
}

type papiPair struct {
	A papiText `json:"a"`
	B papiText `json:"b"`
}

// QuestionRow is a stored question with its decoded options.
type QuestionRow struct {
	ID      string
	Body    string
	Options any
}

// SanitizeQuestions strips answer keys: MCQ keeps option key and text, PAPI
// keeps the statement texts without their scale codes.
func SanitizeQuestions(kind string, rows []QuestionRow) []CandidateQuestion {
	out := make([]CandidateQuestion, 0, len(rows))
	for _, q := range rows {
		if kind == "forced_choice" {
			m, _ := q.Options.(map[string]any)
			text := func(key string) any {
				side, _ := m[key].(map[string]any)
				if t, ok := side["text"]; ok && t != nil {
					return t
				}
				return ""
			}
			out = append(out, CandidateQuestion{ID: q.ID, Body: q.Body, Options: papiPair{A: papiText{text("a")}, B: papiText{text("b")}}})
			continue
		}
		list, _ := q.Options.([]any)
		opts := make([]McqOption, 0, len(list))
		for _, o := range list {
			m, _ := o.(map[string]any)
			opts = append(opts, McqOption{Key: m["key"], Text: m["text"]})
		}
		out = append(out, CandidateQuestion{ID: q.ID, Body: q.Body, Options: opts})
	}
	return out
}

// PickDrawnAnswers keeps only the answers for questions drawn for the test.
func PickDrawnAnswers(questionIDs []string, answers map[string]string) map[string]string {
	out := map[string]string{}
	for qid, a := range answers {
		if slices.Contains(questionIDs, qid) {
			out[qid] = a
		}
	}
	return out
}
