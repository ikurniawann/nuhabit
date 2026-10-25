// Package domain holds the pure rules of gym member care: flag types and
// their validation, the PAR-Q questionnaire and the coach note windows.
package domain

import (
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Category splits flags by who may read their detail.
type Category string

const (
	// General flags (beginner, VIP) show to every gym staff screen.
	General Category = "general"
	// Medical flags show their detail only to the member's current coaches
	// and to gym managers; everyone else sees a count.
	Medical Category = "medical"
)

// Colors are the badge colours a flag type may use (the class type palette).
var Colors = []string{"lime", "info", "warning", "danger", "success", "ink"}

// Icons are the badge icons a flag type may use; the dashboard maps each
// key to a lucide icon.
var Icons = []string{"flag", "bandage", "heart", "baby", "clipboard", "sprout", "star", "message", "alert", "shield"}

// Flag sources.
const (
	SourceStaff = "staff"
	SourceCoach = "coach"
	SourceParq  = "parq"
)

// ParqTypeCode is the system flag type a PAR-Q "yes" answer creates.
const ParqTypeCode = "parq_review"

// Review decisions on a medical flag. Pending is the state a PAR-Q flag
// starts in.
const (
	ReviewPending    = "pending"
	ReviewCleared    = "cleared"
	ReviewRestricted = "restricted"
	ReviewDoctorNote = "doctor_note"
)

// ReviewDecisions are the outcomes a reviewer picks.
var ReviewDecisions = []string{ReviewCleared, ReviewRestricted, ReviewDoctorNote}

// Text limits, in characters.
const (
	LabelMax      = 40
	NoteMax       = 300
	ReviewNoteMax = 300
	// MaxExpiryDays bounds default_expiry_days and an explicit expiry.
	MaxExpiryDays = 3650
)

// TypeInput is a flag type create or edit. Nil fields are absent (edit).
type TypeInput struct {
	Label             *string
	Category          *Category
	Color             *string
	Icon              *string
	DefaultExpiryDays **int
	SortOrder         *int
	Active            *bool
}

// ValidateType checks the fields that are set; create needs label and
// category. It returns the first problem or "".
func ValidateType(in TypeInput, create bool) string {
	if create && (in.Label == nil || in.Category == nil) {
		return "Nama dan kategori penanda wajib diisi"
	}
	if in.Label != nil {
		n := utf8.RuneCountInString(strings.TrimSpace(*in.Label))
		if n == 0 || n > LabelMax {
			return "Nama penanda 1 sampai 40 karakter"
		}
	}
	if in.Category != nil && *in.Category != General && *in.Category != Medical {
		return "Kategori harus umum atau medis"
	}
	if in.Color != nil && !slices.Contains(Colors, *in.Color) {
		return "Warna penanda tidak dikenal"
	}
	if in.Icon != nil && !slices.Contains(Icons, *in.Icon) {
		return "Ikon penanda tidak dikenal"
	}
	if in.DefaultExpiryDays != nil && *in.DefaultExpiryDays != nil {
		if d := **in.DefaultExpiryDays; d < 1 || d > MaxExpiryDays {
			return "Masa berlaku bawaan 1 sampai 3650 hari"
		}
	}
	if in.SortOrder != nil && (*in.SortOrder < 0 || *in.SortOrder > 10000) {
		return "Urutan 0 sampai 10000"
	}
	return ""
}

// TypeCode derives a stable code from a label: lowercase ASCII words joined
// by underscores, at most 32 characters, "flag" when nothing is left.
func TypeCode(label string) string {
	var b strings.Builder
	sep := false
	for _, r := range strings.ToLower(label) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			if sep && b.Len() > 0 {
				b.WriteByte('_')
			}
			b.WriteRune(r)
			sep = false
		default:
			sep = true
		}
	}
	code := b.String()
	if len(code) > 32 {
		code = strings.TrimRight(code[:32], "_")
	}
	if code == "" {
		return "flag"
	}
	return code
}

// ValidNote reports whether a flag or review note fits the limit.
func ValidNote(note string, max int) bool { return utf8.RuneCountInString(note) <= max }

// DefaultExpiry is the expiry date of a new flag of a type with
// defaultDays, counted from today; nil without a default.
func DefaultExpiry(today time.Time, defaultDays *int) *time.Time {
	if defaultDays == nil {
		return nil
	}
	d := today.AddDate(0, 0, *defaultDays)
	return &d
}

// ValidExpiry: an explicit expiry is today or later and at most
// MaxExpiryDays ahead. Dates are calendar days (midnight UTC).
func ValidExpiry(expires, today time.Time) bool {
	return !expires.Before(today) && !expires.After(today.AddDate(0, 0, MaxExpiryDays))
}

// Active reports whether a flag shows on today: not removed and its expiry,
// when set, is today or later.
func Active(removed bool, expiresOn *time.Time, today time.Time) bool {
	return !removed && (expiresOn == nil || !expiresOn.Before(today))
}

// ReviewKeepsFlag: a cleared member needs no flag; a restriction or a
// doctor's note request stays on the roster.
func ReviewKeepsFlag(decision string) bool { return decision != ReviewCleared }
