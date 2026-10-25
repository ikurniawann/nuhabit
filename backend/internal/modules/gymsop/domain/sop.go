// Package domain holds the pure rules of coach SOPs: what a version must
// carry and when an unread reader is reminded.
package domain

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"nuhabit/backend/internal/platform/localtime"
)

// Limits.
const (
	TitleMax      = 150
	BodyMax       = 50_000
	ChangeNoteMax = 300
	// AttachmentMaxBytes bounds the PDF of a version.
	AttachmentMaxBytes = 10 << 20
	// RemindAfterMax bounds remind_after_days.
	RemindAfterMax = 60
	// DefaultRemindAfterDays is remind_after_days of a new document.
	DefaultRemindAfterDays = 3
)

// Reminder sources.
const (
	SourceManual = "manual"
	SourceJob    = "job"
)

// VersionInput is the content of a version to publish.
type VersionInput struct {
	Title, Body, ChangeNote string
	HasAttachment           bool
}

// Validate returns the first problem with the version, or "". A version
// needs a title and a body, a PDF, or both.
func (v VersionInput) Validate() string {
	title := utf8.RuneCountInString(strings.TrimSpace(v.Title))
	switch {
	case title == 0 || title > TitleMax:
		return "Judul SOP 1 sampai 150 karakter"
	case strings.TrimSpace(v.Body) == "" && !v.HasAttachment:
		return "Isi SOP atau lampiran PDF wajib ada"
	case utf8.RuneCountInString(v.Body) > BodyMax:
		return "Isi SOP maksimal 50.000 karakter"
	case utf8.RuneCountInString(v.ChangeNote) > ChangeNoteMax:
		return "Catatan perubahan maksimal 300 karakter"
	}
	return ""
}

// ValidRemindAfter: 0 (manual only) to RemindAfterMax days.
func ValidRemindAfter(days int) bool { return days >= 0 && days <= RemindAfterMax }

// JobDue reports whether the reminder job reminds an unread reader now: the
// version has been out afterDays days and the reader's last reminder for it,
// manual or automatic, is at least afterDays old. afterDays 0 turns the job
// off for the document.
func JobDue(publishedAt time.Time, lastReminder *time.Time, now time.Time, afterDays int) bool {
	if afterDays <= 0 {
		return false
	}
	gap := time.Duration(afterDays) * 24 * time.Hour
	if now.Sub(publishedAt) < gap {
		return false
	}
	return lastReminder == nil || now.Sub(*lastReminder) >= gap
}

// RemindedToday reports whether last falls on now's Jakarta day: a manual
// reminder skips such a reader, so pressing the button twice sends once.
func RemindedToday(last *time.Time, now time.Time) bool {
	return last != nil && localtime.DayKey(*last, localtime.Jakarta) == localtime.DayKey(now, localtime.Jakarta)
}

// Reminder is the inbox and WhatsApp text for an unread reader.
func Reminder(name, title string, version int) (heading, body string) {
	heading = "SOP perlu dibaca"
	greeting := "Halo"
	if name = strings.TrimSpace(name); name != "" {
		greeting += " " + name
	}
	body = fmt.Sprintf("%s, SOP %q versi %d belum Anda konfirmasi. Buka Kelas Saya, baca, lalu tekan Saya sudah membaca dan setuju.",
		greeting, title, version)
	return heading, body
}
