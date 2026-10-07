package domain

import (
	"regexp"
	"strings"
	"time"
)

// The inbound half of lib/crm/cs-rules.ts (EPIC-012 Fase D): business
// hours in WIB, the out-of-hours auto-reply, and reading a CSAT score from
// a customer's reply. Added for the WhatsApp gateway webhook (wa/inbound).

// CsInboundSettings is the part of CsSettings an inbound message needs.
type CsInboundSettings struct {
	BusinessHoursStart float64
	BusinessHoursEnd   float64
	AutoReplyEnabled   bool
	AutoReplyText      string
}

// DefaultAutoReplyText is CS_DEFAULTS.autoReplyText for a brand name.
func DefaultAutoReplyText(brand string) string {
	return "Terima kasih sudah menghubungi " + brand + ". Saat ini di luar jam operasional kami. Pesan Anda sudah kami terima dan akan dibalas pada jam operasional berikutnya."
}

// DefaultCsInboundSettings is CS_DEFAULTS (10-22 WIB, auto-reply on).
func DefaultCsInboundSettings(brand string) CsInboundSettings {
	return CsInboundSettings{BusinessHoursStart: 10, BusinessHoursEnd: 22, AutoReplyEnabled: true, AutoReplyText: DefaultAutoReplyText(brand)}
}

const wibOffset = 7 * time.Hour

// WibHour is wibHour: the WIB wall-clock hour (0-23) of at.
func WibHour(at time.Time) int { return at.UTC().Add(wibOffset).Hour() }

// WibDateKey is wibDateKey: the WIB calendar date, YYYY-MM-DD.
func WibDateKey(at time.Time) string { return at.UTC().Add(wibOffset).Format("2006-01-02") }

// IsWithinBusinessHours is isWithinBusinessHours: start == end means open
// 24 hours, start > end spans midnight.
func IsWithinBusinessHours(at time.Time, start, end float64) bool {
	hour := float64(WibHour(at))
	switch {
	case start == end:
		return true
	case start < end:
		return hour >= start && hour < end
	}
	return hour >= start || hour < end
}

// jsSpaceClass is the JS \s class inside a regexp character class.
const jsSpaceClass = `\t\n\x{0B}\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}`

var csatReply = regexp.MustCompile(`^(?:[^0-9]{0,10}?)([1-5])[` + jsSpaceClass + `]*[.!]?$`)

// ParseCsatReply is parseCsatReply: a reply that is only a 1-5 rating
// ("4", "4.", "nilai 5"), at most two words; 0 when it is not one.
func ParseCsatReply(body *string) int {
	if body == nil || *body == "" {
		return 0
	}
	trimmed := JSTrim(*body)
	m := csatReply.FindStringSubmatch(trimmed)
	if m == nil || len(strings.FieldsFunc(trimmed, isJSSpace)) > 2 {
		return 0
	}
	return int(m[1][0] - '0')
}
