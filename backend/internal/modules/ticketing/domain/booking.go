package domain

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"slices"
	"strings"
	"unicode"
)

// Website bookings and season passes (booking.ts, season-pass.ts).

// BookingStatuses are the ticket_bookings statuses.
var BookingStatuses = []string{"menunggu-bayar", "terbayar", "digunakan", "kedaluwarsa", "dibatalkan", "hangus"}

var bookingCodePattern = regexp.MustCompile(`^BK-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$`)

// NormalizeBookingCode is normalizeBookingCode: upper case, no spaces, the
// BK- prefix restored; "" when it is still not a booking code.
func NormalizeBookingCode(raw string) string {
	code := strings.Map(func(r rune) rune {
		if isJSSpace(r) {
			return -1
		}
		return r
	}, strings.ToUpper(raw))
	if !strings.HasPrefix(code, "BK-") {
		if strings.HasPrefix(code, "BK") {
			code = "BK-" + code[2:]
		} else {
			code = "BK-" + code
		}
	}
	if !bookingCodePattern.MatchString(code) {
		return ""
	}
	return code
}

// isJSSpace is the JS \s class: Unicode white space plus the BOM.
func isJSSpace(r rune) bool { return unicode.IsSpace(r) || r == '\ufeff' }

// Redeem windows.
const (
	RedeemNotYet  = "belum-mulai"
	RedeemAllowed = "boleh"
	RedeemPast    = "lewat"
)

// RedeemWindowStatus is redeemWindowStatus: the visit day through
// visit day + forfeitDays (nil = the visit day only).
func RedeemWindowStatus(visitDate, today string, forfeitDays *int) string {
	if today < visitDate {
		return RedeemNotYet
	}
	last := visitDate
	if forfeitDays != nil {
		last = AddDaysISO(visitDate, *forfeitDays)
	}
	if today <= last {
		return RedeemAllowed
	}
	return RedeemPast
}

// IsForfeitDue is isForfeitDue: only when a policy is set and it lapsed.
func IsForfeitDue(visitDate, today string, forfeitDays *int) bool {
	return forfeitDays != nil && RedeemWindowStatus(visitDate, today, forfeitDays) == RedeemPast
}

// Guest pairing failures.
const (
	GuestForeign    = "guest-asing"
	GuestDouble     = "guest-dobel"
	GuestIncomplete = "belum-lengkap"
)

// MatchRedeemGuests is matchRedeemGuests: every guest gets exactly one
// band. It returns the failure reason and guest id, or "" when matched.
func MatchRedeemGuests(guestIDs, bandGuestIDs []string) (reason, guestID string) {
	remaining := map[string]bool{}
	for _, id := range guestIDs {
		remaining[id] = true
	}
	for _, id := range bandGuestIDs {
		if !slices.Contains(guestIDs, id) {
			return GuestForeign, id
		}
		if !remaining[id] {
			return GuestDouble, id
		}
		delete(remaining, id)
	}
	for _, id := range guestIDs {
		if remaining[id] {
			return GuestIncomplete, id
		}
	}
	return "", ""
}

// GenerateAccessToken is generateAccessToken: 32 random bytes, hex.
func GenerateAccessToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// PassCodePrefix is the SP-YYYYMMDD prefix of a pass issued on today.
func PassCodePrefix(today string) string { return "SP-" + strings.ReplaceAll(today, "-", "") }

var (
	hex64      = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
	passPrefix = regexp.MustCompile(`^(?i)SP-`)
)

// PassLookupKey is passLookupKey: which season pass column a raw gate code
// matches (QR token, pass code, or linked band UID); ok=false otherwise.
func PassLookupKey(raw string) (column, key string, ok bool) {
	if hex64.MatchString(raw) {
		return "sp.access_token", strings.ToLower(raw), true
	}
	if passPrefix.MatchString(raw) {
		return "sp.pass_code", strings.ToUpper(raw), true
	}
	if uid := NormalizeNfcUID(raw); IsValidNfcUID(uid) {
		return "sp.band_uid", uid, true
	}
	return "", "", false
}

// NormalizeNfcUID is normalizeNfcUid: upper-case hex without separators.
func NormalizeNfcUID(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= '0' && r <= '9', r >= 'A' && r <= 'F':
			b.WriteRune(r)
		case r >= 'a' && r <= 'f':
			b.WriteRune(r - 'a' + 'A')
		}
	}
	return b.String()
}

// IsValidNfcUID is isValidNfcUid: 8..64 hex characters.
func IsValidNfcUID(uid string) bool { return len(uid) >= 8 && len(uid) <= 64 }
