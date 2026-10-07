package domain

import (
	"fmt"
	"unicode/utf16"
)

// OfferStatusForAction maps a portal action to the offer status it sets.
var OfferStatusForAction = map[string]string{"accept": "accepted", "negotiate": "negotiating", "decline": "declined"}

var offerActionLabels = map[string]string{"accept": "menerima", "negotiate": "mengajukan negosiasi", "decline": "menolak"}

var manualStatusLabels = map[string]string{"accepted": "menerima", "negotiating": "mengajukan negosiasi", "declined": "menolak"}

// IsOfferOpen reports whether an offer can still be answered.
func IsOfferOpen(status string) bool { return status == "sent" || status == "negotiating" }

// OfferResponseDescription is the activity text of a portal response; the
// note is cut at 300 UTF-16 units like String.slice.
func OfferResponseDescription(action string, version int, note *string) string {
	s := fmt.Sprintf("Kandidat %s offer v%d via portal", offerActionLabels[action], version)
	if note != nil && *note != "" {
		s += ` — "` + JSSlice(*note, 300) + `"`
	}
	return s
}

// ManualOfferResponseDescription is the activity text when HR records a
// response by hand.
func ManualOfferResponseDescription(status string, version int, note string) string {
	s := fmt.Sprintf("Kandidat %s offer v%d (dicatat manual)", manualStatusLabels[status], version)
	if note != "" {
		s += ` — "` + JSSlice(note, 300) + `"`
	}
	return s
}

// JSSlice is String.prototype.slice(0, n): the first n UTF-16 code units.
func JSSlice(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}
