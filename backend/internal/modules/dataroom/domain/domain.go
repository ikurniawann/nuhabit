// Package domain holds the pure rules of the Dataroom (lib/dataroom
// access.ts, config.ts and shares.ts): department access along the folder
// chain, node names, link expiry, recipient emails, share verification
// steps, and the attempt and rate limits that guard short secrets.
package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"nuhabit/backend/internal/platform/validate"
)

// IsAdminRole is isDataroomAdminRole: only super_admin sees and manages
// every folder.
func IsAdminRole(role string) bool { return role == "super_admin" }

// EvaluateAccess is evaluateAccess: allowed when every configured list on
// the chain (node up to root) holds the department; an empty list does not
// restrict.
func EvaluateAccess(chain [][]string, departmentID *string, isAdmin bool) bool {
	if isAdmin {
		return true
	}
	for _, allowed := range chain {
		if len(allowed) == 0 {
			continue
		}
		if departmentID == nil || *departmentID == "" || !contains(allowed, *departmentID) {
			return false
		}
	}
	return true
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

// MaxExpiryDays is DATAROOM_MAX_EXPIRY_DAYS.
const MaxExpiryDays = 365

const defaultExpiryDays = 7

var controlChars = regexp.MustCompile(`[\x00-\x1f\x7f]`)

// SanitizeNodeName is sanitizeNodeName: no control characters or slashes,
// not only dots, "Tanpa nama" when empty, at most 255 UTF-16 units.
func SanitizeNodeName(input string) string {
	s := controlChars.ReplaceAllString(input, "")
	s = strings.NewReplacer(`\`, "-", "/", "-").Replace(s)
	s = validate.JSTrim(s)
	if strings.Trim(s, ".") == "" {
		s = ""
	}
	if s == "" {
		s = "Tanpa nama"
	}
	return JSSlice(s, 255)
}

// ComputeExpiry is computeExpiry: now plus the days clamped to 1..365
// (default 7).
func ComputeExpiry(days int, now time.Time) time.Time {
	if days < 1 {
		days = defaultExpiryDays
	}
	return now.Add(time.Duration(min(days, MaxExpiryDays)) * 24 * time.Hour)
}

var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)

// IsValidEmail is isValidEmail.
func IsValidEmail(s string) bool { return emailRe.MatchString(validate.JSTrim(s)) }

// NormalizeEmails is normalizeEmails for a list: trimmed, lower-cased,
// valid and unique, in first-seen order.
func NormalizeEmails(list []string) []string {
	out := []string{}
	for _, item := range list {
		e := strings.ToLower(validate.JSTrim(item))
		if e != "" && IsValidEmail(e) && !contains(out, e) {
			out = append(out, e)
		}
	}
	return out
}

// IsEmailAllowed is isEmailAllowed (case-insensitive).
func IsEmailAllowed(allowed []string, email string) bool {
	e := strings.ToLower(validate.JSTrim(email))
	if e == "" {
		return false
	}
	for _, a := range allowed {
		if strings.ToLower(validate.JSTrim(a)) == e {
			return true
		}
	}
	return false
}

// IsShareActive is isShareActive: not revoked and not yet expired.
func IsShareActive(revoked bool, expiresAt, now time.Time) bool {
	return !revoked && expiresAt.After(now)
}

// Steps are the verification steps a share session still lacks.
type Steps struct {
	NeedEmail bool `json:"needEmail"`
	NeedPin   bool `json:"needPin"`
}

// Verified reports whether no step is left.
func (s Steps) Verified() bool { return !s.NeedEmail && !s.NeedPin }

// PendingSteps is pendingSteps; emailOK and pinOK come from the session
// (false without one).
func PendingSteps(accessType string, hasPin, emailOK, pinOK bool) Steps {
	return Steps{NeedEmail: accessType == "email" && !emailOK, NeedPin: hasPin && !pinOK}
}

// ShareTokenRe is SHARE_TOKEN_RE (share tokens and session tokens).
var ShareTokenRe = regexp.MustCompile(`^[A-Za-z0-9_-]{20,64}$`)

// GenerateShareToken is generateShareToken: 24 random bytes, base64url.
func GenerateShareToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// SessionCookieName is sessionCookieName.
func SessionCookieName(token string) string { return "drs_" + token }

// HashEmailCode is hashEmailCode.
func HashEmailCode(shareID, email, code string) string {
	sum := sha256.Sum256([]byte(shareID + ":" + strings.ToLower(email) + ":" + code))
	return hex.EncodeToString(sum[:])
}

// Email codes and recipient sessions.
const (
	EmailCodeTTL         = 10 * time.Minute
	EmailCodeMaxAttempts = 5
	SessionTTL           = 24 * time.Hour
)

// JSSlice is String.prototype.slice(0, n): at most n UTF-16 units, never
// splitting a surrogate pair into invalid UTF-8.
func JSSlice(s string, n int) string {
	units := 0
	for i, r := range s {
		w := len(utf16.Encode([]rune{r}))
		if units+w > n {
			return s[:i]
		}
		units += w
	}
	return s
}

/* ── auth.attempt_limits (lib/security/attempt-limit.ts) ─────────────── */

// AttemptPolicy is AttemptPolicy.
type AttemptPolicy struct {
	MaxFailures int
	Window      time.Duration
	Lockout     time.Duration
}

// SharePinScope and SharePinPolicy: 5 wrong PINs within 15 minutes lock
// the link for 30 minutes.
const SharePinScope = "dataroom_share_pin"

var SharePinPolicy = AttemptPolicy{MaxFailures: 5, Window: 15 * time.Minute, Lockout: 30 * time.Minute}

// AttemptState is one auth.attempt_limits row.
type AttemptState struct {
	Failures      int
	WindowStarted time.Time
	LockedUntil   *time.Time
}

// ActiveLock is activeLock: the lock end still in force, or nil.
func ActiveLock(s *AttemptState, now time.Time) *time.Time {
	if s == nil || s.LockedUntil == nil || !s.LockedUntil.After(now) {
		return nil
	}
	return s.LockedUntil
}

// ApplyFailure is applyFailure: the state after one more failure.
func ApplyFailure(s *AttemptState, now time.Time, p AttemptPolicy) AttemptState {
	lockExpired := s != nil && s.LockedUntil != nil && ActiveLock(s, now) == nil
	fresh := s == nil || now.Sub(s.WindowStarted) > p.Window || lockExpired
	next := AttemptState{Failures: 1, WindowStarted: now}
	if !fresh {
		next = AttemptState{Failures: s.Failures + 1, WindowStarted: s.WindowStarted, LockedUntil: s.LockedUntil}
	}
	if next.Failures >= p.MaxFailures {
		until := now.Add(p.Lockout)
		next.LockedUntil = &until
	}
	return next
}

// MinutesUntil is minutesUntil: whole minutes left, rounded up, at least 1.
func MinutesUntil(until, now time.Time) int {
	return max(1, int(math.Ceil(float64(until.Sub(now).Milliseconds())/60000)))
}
