package domain

import (
	"strings"
	"time"
	"unicode/utf8"
)

// ParqVersion names the questionnaire below. Change it when a question
// changes: declarations of an older version no longer count as current.
const ParqVersion = "parq-plus-2026"

// ParqValidMonths: a declaration is current this many months after it was
// submitted.
const ParqValidMonths = 12

// ParqDetailsMax bounds the free text a member adds to a "yes".
const ParqDetailsMax = 500

// ParqQuestion is one PAR-Q+ general health question. The member app holds
// the wording in Indonesian and English; Short is the Indonesian summary
// coaches read on the review flag.
type ParqQuestion struct {
	Code  string `json:"code"`
	Short string `json:"short"`
}

// ParqQuestions are the seven general health questions of the PAR-Q+.
var ParqQuestions = []ParqQuestion{
	{"heart_condition", "kondisi jantung atau tekanan darah tinggi"},
	{"chest_pain", "nyeri dada saat istirahat atau beraktivitas"},
	{"dizziness", "pusing hingga hilang keseimbangan atau pingsan"},
	{"chronic_condition", "penyakit kronis lain"},
	{"medication", "obat resep untuk penyakit kronis"},
	{"bone_joint", "masalah tulang, sendi atau jaringan lunak"},
	{"supervised_only", "dokter menyarankan latihan dengan pengawasan medis"},
}

// ParqAnswers maps a question code to the answer (true = yes).
type ParqAnswers map[string]bool

// ParseParqAnswers keeps exactly the questions of this version and fails
// when one is missing or not a boolean.
func ParseParqAnswers(raw map[string]any) (ParqAnswers, bool) {
	out := make(ParqAnswers, len(ParqQuestions))
	for _, q := range ParqQuestions {
		v, ok := raw[q.Code].(bool)
		if !ok {
			return nil, false
		}
		out[q.Code] = v
	}
	return out, true
}

// HasYes reports whether any answer is yes.
func (a ParqAnswers) HasYes() bool {
	for _, q := range ParqQuestions {
		if a[q.Code] {
			return true
		}
	}
	return false
}

// ReviewNote is the note of the review flag: the yes answers in question
// order and the member's own words, cut to NoteMax characters.
func (a ParqAnswers) ReviewNote(details string) string {
	var yes []string
	for _, q := range ParqQuestions {
		if a[q.Code] {
			yes = append(yes, q.Short)
		}
	}
	note := "PAR-Q ya: " + strings.Join(yes, "; ")
	if d := strings.Join(strings.Fields(details), " "); d != "" {
		note += ". Keterangan member: " + d
	}
	if utf8.RuneCountInString(note) > NoteMax {
		r := []rune(note)
		note = string(r[:NoteMax-1]) + "…"
	}
	return note
}

// ParqExpiry is when a declaration submitted at submitted stops being current.
func ParqExpiry(submitted time.Time) time.Time { return submitted.AddDate(0, ParqValidMonths, 0) }

// ParqDue reports whether the member must fill the questionnaire again:
// never filled, an older version, or expired at now.
func ParqDue(version string, expiresAt *time.Time, now time.Time) bool {
	return expiresAt == nil || version != ParqVersion || !now.Before(*expiresAt)
}
