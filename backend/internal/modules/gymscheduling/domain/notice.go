package domain

import (
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

// Schedule change notices to members: the late flag for the change report
// and the quiet hours that hold WhatsApp back overnight.

// Quiet hours in the branch zone: no WhatsApp from 21.00 until 07.00.
const (
	QuietStartHour = 21
	QuietEndHour   = 7
)

// urgentBuffer: a class starting sooner than this after the quiet hours end
// is announced at once, since a morning message would arrive too late.
const urgentBuffer = 3 * time.Hour

// ChangeNoticeLate reports whether a change announced at now reaches
// members less than minHours before the class starts.
func ChangeNoticeLate(startsAt, now time.Time, minHours int) bool {
	return startsAt.Sub(now) < time.Duration(minHours)*time.Hour
}

// InQuietHours reports whether t falls between 21.00 and 07.00 in zone.
func InQuietHours(t time.Time, zone *time.Location) bool {
	if zone == nil {
		zone = localtime.Jakarta
	}
	h := t.In(zone).Hour()
	return h >= QuietStartHour || h < QuietEndHour
}

// quietEnd is the first 07.00 in zone after t.
func quietEnd(t time.Time, zone *time.Location) time.Time {
	local := t.In(zone)
	end := time.Date(local.Year(), local.Month(), local.Day(), QuietEndHour, 0, 0, 0, zone)
	if !end.After(local) {
		end = end.AddDate(0, 0, 1)
	}
	return end
}

// ChangeNoticeAt is when a schedule change notice may leave by push and
// WhatsApp: the zero time (at once) outside the quiet hours, 07.00 in the
// branch zone inside them. A class starting less than three hours after
// 07.00 is announced at once.
func ChangeNoticeAt(now, startsAt time.Time, zone *time.Location) time.Time {
	if zone == nil {
		zone = localtime.Jakarta
	}
	if !InQuietHours(now, zone) {
		return time.Time{}
	}
	end := quietEnd(now, zone)
	if startsAt.Before(end.Add(urgentBuffer)) {
		return time.Time{}
	}
	return end
}
