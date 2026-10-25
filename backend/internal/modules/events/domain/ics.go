package domain

import (
	"strings"
	"time"

	eventsc "nuhabit/backend/internal/contracts/events"
)

// ICSEntry is one VEVENT of a calendar feed.
type ICSEntry struct {
	Entry
	BranchName *string
	Status     string
	UpdatedAt  time.Time
}

const icsStamp = "20060102T150405Z"

// RenderICS writes an iCalendar document Google and Outlook subscribe to.
// Times are UTC instants; every line is CRLF terminated and folded at 75
// octets as RFC 5545 asks.
func RenderICS(name string, entries []ICSEntry, now time.Time) string {
	var b strings.Builder
	line := func(s string) { b.WriteString(fold(s) + "\r\n") }
	line("BEGIN:VCALENDAR")
	line("VERSION:2.0")
	line("PRODID:-//NuHabit//Kalender Event//ID")
	line("CALSCALE:GREGORIAN")
	line("METHOD:PUBLISH")
	line("X-WR-CALNAME:" + escape(name))
	line("X-PUBLISHED-TTL:PT1H")
	for _, e := range entries {
		line("BEGIN:VEVENT")
		line("UID:" + string(e.Kind) + "-" + e.ID + "@nuhabit")
		line("DTSTAMP:" + now.UTC().Format(icsStamp))
		line("DTSTART:" + e.StartsAt.UTC().Format(icsStamp))
		line("DTEND:" + e.EndsAt.UTC().Format(icsStamp))
		line("SUMMARY:" + escape(summary(e)))
		if loc := location(e); loc != "" {
			line("LOCATION:" + escape(loc))
		}
		if desc := description(e); desc != "" {
			line("DESCRIPTION:" + escape(desc))
		}
		line("STATUS:" + icsStatus(e.Status))
		line("LAST-MODIFIED:" + e.UpdatedAt.UTC().Format(icsStamp))
		line("END:VEVENT")
	}
	line("END:VCALENDAR")
	return b.String()
}

func summary(e ICSEntry) string {
	switch e.Kind {
	case eventsc.KindClass:
		return "Kelas " + e.Title
	case eventsc.KindPT:
		return "PT " + e.Title
	}
	return e.Title
}

func location(e ICSEntry) string {
	var parts []string
	if e.BranchName != nil && *e.BranchName != "" {
		parts = append(parts, *e.BranchName)
	}
	if e.Area != nil && strings.TrimSpace(*e.Area) != "" {
		parts = append(parts, strings.TrimSpace(*e.Area))
	}
	return strings.Join(parts, " · ")
}

func description(e ICSEntry) string {
	var parts []string
	if e.CoachName != nil && *e.CoachName != "" {
		parts = append(parts, "Coach: "+*e.CoachName)
	}
	if e.Status != "" {
		parts = append(parts, "Status: "+e.Status)
	}
	return strings.Join(parts, "\n")
}

// icsStatus maps the row status to the three RFC values.
func icsStatus(status string) string {
	switch status {
	case "cancelled":
		return "CANCELLED"
	case "draft", "requested":
		return "TENTATIVE"
	}
	return "CONFIRMED"
}

// escape protects the TEXT value characters RFC 5545 reserves.
func escape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\r\n", `\n`, "\n", `\n`)
	return r.Replace(s)
}

// fold breaks a content line into 75-octet chunks, continuation lines
// starting with a space, without splitting a UTF-8 sequence.
func fold(s string) string {
	const limit = 75
	if len(s) <= limit {
		return s
	}
	var b strings.Builder
	width := limit
	for len(s) > width {
		cut := width
		for cut > 0 && !utf8Start(s[cut]) {
			cut--
		}
		b.WriteString(s[:cut] + "\r\n ")
		s = s[cut:]
		width = limit - 1
	}
	b.WriteString(s)
	return b.String()
}

// utf8Start reports whether c begins a UTF-8 sequence (not a continuation byte).
func utf8Start(c byte) bool { return c&0xC0 != 0x80 }
