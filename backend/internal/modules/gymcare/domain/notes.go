package domain

import (
	"slices"
	"time"
	"unicode/utf8"
)

// Coach session notes.
const (
	// SessionNoteMax bounds a note, in characters.
	SessionNoteMax = 500
	// NoteWriteDays: a coach writes notes for a session that has started,
	// up to this many days after its start.
	NoteWriteDays = 7
	// NoteHistoryDays: notes that are not carried forward show this long.
	NoteHistoryDays = 60
	// RosterHistoryLimit: a roster shows this many history notes per member
	// below the carried ones.
	RosterHistoryLimit = 3
)

// CanWriteNote: the session has started and started at most NoteWriteDays
// ago.
func CanWriteNote(startsAt, now time.Time) bool {
	return !startsAt.After(now) && !startsAt.Before(now.AddDate(0, 0, -NoteWriteDays))
}

// ValidSessionNote: 1 to SessionNoteMax characters after trimming.
func ValidSessionNote(body string) bool {
	n := utf8.RuneCountInString(body)
	return n > 0 && n <= SessionNoteMax
}

// NoteRef is what the roster selection needs of a note.
type NoteRef struct {
	Pinned    bool
	CreatedAt time.Time
}

// RosterNotes picks the notes a roster shows for one member from notes
// (any order): every pinned note, newest first, then the newest limit
// others. It returns indexes into notes.
func RosterNotes(notes []NoteRef, limit int) []int {
	idx := make([]int, len(notes))
	for i := range idx {
		idx[i] = i
	}
	slices.SortStableFunc(idx, func(a, b int) int { return notes[b].CreatedAt.Compare(notes[a].CreatedAt) })
	var pinned, rest []int
	for _, i := range idx {
		if notes[i].Pinned {
			pinned = append(pinned, i)
		} else if len(rest) < limit {
			rest = append(rest, i)
		}
	}
	return append(pinned, rest...)
}
