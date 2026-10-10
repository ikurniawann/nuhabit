package domain

import (
	"strings"
	"time"
	"unicode"
)

// Password sign-in rules. The username is the member's WhatsApp number or
// email; a name is never accepted because names are not unique.

// DummyPasswordHash is a bcrypt hash of a random value that was discarded
// right after hashing. A sign-in for an unknown username compares against
// it, so the response time does not tell a registered account from an
// unregistered one.
const DummyPasswordHash = "$2b$10$mbJFCn7gNj4UuPSHt7GCl.Q1ukFRPUxXtdTlEOyiALazTx0c//3p6"

// Password limits: bcrypt reads 72 bytes at most.
const (
	PasswordMinLength = 8
	PasswordMaxLength = 72
)

// Sign-in brakes. The per-account limit is the main guard: a cafe Wi-Fi
// is shared by many members and an attacker can change IPs.
var (
	LoginAccountRule = RateRule{Limit: 10, Window: 15 * time.Minute}
	IPRuleLogin      = RateRule{Limit: 30, Window: 10 * time.Minute}
)

// Sign-in and password messages.
const (
	LoginInvalidMessage     = "Incorrect username or password"
	LoginNoPasswordMessage  = "This account has no password yet. Ask the front desk to set one, or use Forgot password."
	LoginTooManyForAccount  = "Too many sign-in attempts for this account. Try again in a few minutes."
	LoginTooManyFromNetwork = "Too many requests from this network. Try again in a few minutes."
)

// LoginKey is the per-account rate limit key of a username: the 62xxx
// digits of a phone number (so 08xx and 62xx share one budget), the
// lower-cased email, or the lower-cased input when it is neither.
func LoginKey(username string) string {
	digits, email := LoginLookup(username)
	switch {
	case digits != "":
		return digits
	case email != "":
		return email
	}
	return strings.ToLower(strings.TrimSpace(username))
}

// LoginLookup splits a username into the phone digits and email to match.
// Email is "" unless the username contains "@"; digits are "" unless the
// username is a valid phone number.
func LoginLookup(username string) (digits, email string) {
	username = strings.TrimSpace(username)
	if strings.Contains(username, "@") {
		return "", strings.ToLower(username)
	}
	return NormalizePhoneDigits(username), ""
}

// NewPasswordProblem returns the message for a password that breaks the
// rule (8 to 72 characters, at least one letter and one digit), or "".
func NewPasswordProblem(password string) string {
	if n := len([]rune(password)); n < PasswordMinLength || n > PasswordMaxLength || len(password) > PasswordMaxLength {
		return "Password must be 8 to 72 characters"
	}
	var letter, digit bool
	for _, r := range password {
		letter = letter || unicode.IsLetter(r)
		digit = digit || unicode.IsDigit(r)
	}
	if !letter || !digit {
		return "Password must contain at least one letter and one digit"
	}
	return ""
}

// MaskPhone hides the middle of a number for the forgot-password reply:
// 0812****567. Short values are masked whole.
func MaskPhone(digits62 string) string {
	local := LocalPhoneFormat(digits62)
	if len(local) < 8 {
		return strings.Repeat("*", len(local))
	}
	return local[:4] + strings.Repeat("*", len(local)-7) + local[len(local)-3:]
}
