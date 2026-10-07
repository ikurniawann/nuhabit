// Package domain holds the member portal rules: phone numbers, OTP codes,
// self registration, the local OTP bypass, profile completion, tiers, promos,
// portal links and engagement. Pure Go, no I/O.
package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"math/big"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// OTP rules (frontend/src/lib/member-portal/otp.ts).
const (
	OTPLength           = 6
	OTPTTL              = 5 * time.Minute
	OTPMaxAttempts      = 5
	OTPRateLimitCount   = 3
	OTPRateLimitWindow  = 10 * time.Minute
	SessionCookie       = "member_session"
	SessionTTL          = 30 * 24 * time.Hour
	DefaultBrandName    = "NüHabit"
	MaxPhoneDigits      = 15
	MinPhoneDigits      = 10
	registrationNameMax = 100
	registrationMailMax = 100
)

var nonDigit = regexp.MustCompile(`\D`)

// NormalizePhoneDigits turns any Indonesian phone spelling into 62xxx digits.
// It returns "" when the number is empty or not 10 to 15 digits long.
func NormalizePhoneDigits(phone string) string {
	digits := nonDigit.ReplaceAllString(phone, "")
	if digits == "" {
		return ""
	}
	if strings.HasPrefix(digits, "0") {
		digits = "62" + digits[1:]
	}
	if len(digits) < MinPhoneDigits || len(digits) > MaxPhoneDigits {
		return ""
	}
	return digits
}

// LocalPhoneFormat stores 62812xxx as 0812xxx; foreign numbers stay as digits.
func LocalPhoneFormat(digits62 string) string {
	if strings.HasPrefix(digits62, "62") {
		return "0" + digits62[2:]
	}
	return digits62
}

// GenerateOTPCode returns a crypto-random, zero-padded 6 digit code.
func GenerateOTPCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// HashSecret is the hex SHA-256 the OTP and session tables store.
func HashSecret(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

// SafeEqual compares two secrets in constant time after hashing both, so
// neither length nor prefix leaks. An empty side never matches.
func SafeEqual(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	da := sha256.Sum256([]byte(a))
	db := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(da[:], db[:]) == 1
}

// OTPMessage is the WhatsApp text sent by non-template providers.
func OTPMessage(brand, code string) string {
	return "Kode masuk Portal Member " + brand + " Anda: *" + code + "*\n" +
		"Berlaku 5 menit. JANGAN bagikan kode ini kepada siapa pun, " +
		"termasuk yang mengaku staf " + brand + "."
}

// BrandName mirrors brandName(): NEXT_PUBLIC_APP_NAME or the default.
func BrandName(configured string) string {
	if name := strings.TrimSpace(configured); name != "" {
		return name
	}
	return DefaultBrandName
}

var bearerRe = regexp.MustCompile(`(?i)^Bearer\s+(\S+)$`)

// BearerToken extracts the token of an "Authorization: Bearer <token>" value.
func BearerToken(header string) string {
	m := bearerRe.FindStringSubmatch(strings.TrimSpace(header))
	if m == nil {
		return ""
	}
	return m[1]
}

var sixDigits = regexp.MustCompile(`^\d{6}$`)

// IsOTPCode reports whether code has the 6 digit shape.
func IsOTPCode(code string) bool { return sixDigits.MatchString(code) }

// ── Local OTP bypass (dev-bypass.ts) ──────────────────────────────────────

// IsLocalDatabase reports whether the URL host is localhost or 127.0.0.1.
func IsLocalDatabase(rawURL string) bool {
	if rawURL == "" {
		return false
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "localhost" || host == "127.0.0.1"
}

// DevBypass is the three-layer local OTP bypass. All of production=false,
// a non-empty MEMBER_OTP_DEV_CODE and a local DATABASE_URL must hold.
type DevBypass struct {
	Production  bool
	Code        string
	DatabaseURL string
}

// ActiveCode returns the bypass code, or "" when any guard fails.
func (d DevBypass) ActiveCode() string {
	if d.Production {
		return ""
	}
	code := strings.TrimSpace(d.Code)
	if code == "" || !IsLocalDatabase(d.DatabaseURL) {
		return ""
	}
	return code
}

// Active reports whether every guard passes.
func (d DevBypass) Active() bool { return d.ActiveCode() != "" }

// CanBypass reports whether a verify request may skip the OTP check: the
// code may be empty or equal to the dev code, only while the bypass is active.
func (d DevBypass) CanBypass(code string) bool {
	dev := d.ActiveCode()
	if dev == "" {
		return false
	}
	return code == "" || code == dev
}

// ── Self registration (register.ts) ───────────────────────────────────────

// RegistrationInput is the raw JSON body; fields keep their JSON types.
type RegistrationInput struct {
	Phone     any
	Name      any
	Email     any
	BirthDate any
	WAConsent any
}

// Registration is a validated self registration.
type Registration struct {
	PhoneDigits string
	PhoneLocal  string
	Name        string
	Email       *string
	BirthDate   *string
	WAConsent   bool
	// GoogleSub links the member to a verified Google account.
	GoogleSub *string
}

// RegistrationError names the field that failed.
type RegistrationError struct {
	Field   string
	Message string
}

func (e *RegistrationError) Error() string { return e.Message }

var (
	emailRe     = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	isoDateRe   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	spaceRunsRe = regexp.MustCompile(`\s+`)
)

// IsValidBirthDate accepts a real YYYY-MM-DD date for an age of 5 to 120.
func IsValidBirthDate(value string, today time.Time) bool {
	if !isoDateRe.MatchString(value) {
		return false
	}
	t, err := time.Parse("2006-01-02", value)
	if err != nil {
		return false
	}
	age := today.UTC().Year() - t.Year()
	return age >= 5 && age <= 120
}

// ValidateRegistration normalizes and checks a registration body.
func ValidateRegistration(in RegistrationInput, today time.Time) (Registration, *RegistrationError) {
	phone, _ := in.Phone.(string)
	digits := NormalizePhoneDigits(phone)
	if digits == "" {
		return Registration{}, &RegistrationError{"phone", "Nomor WhatsApp tidak valid"}
	}

	name := ""
	if s, ok := in.Name.(string); ok {
		name = spaceRunsRe.ReplaceAllString(strings.TrimSpace(s), " ")
	}
	if JSLength(name) < 2 {
		return Registration{}, &RegistrationError{"name", "Nama minimal 2 huruf"}
	}
	if JSLength(name) > registrationNameMax {
		return Registration{}, &RegistrationError{"name", "Nama terlalu panjang"}
	}

	email := ""
	if s, ok := in.Email.(string); ok {
		email = strings.ToLower(strings.TrimSpace(s))
	}
	if email != "" && (JSLength(email) > registrationMailMax || !emailRe.MatchString(email)) {
		return Registration{}, &RegistrationError{"email", "Format email tidak valid"}
	}

	birth := ""
	if s, ok := in.BirthDate.(string); ok {
		birth = strings.TrimSpace(s)
	}
	if birth != "" && !IsValidBirthDate(birth, today) {
		return Registration{}, &RegistrationError{"birth_date", "Tanggal lahir tidak valid"}
	}

	reg := Registration{
		PhoneDigits: digits,
		PhoneLocal:  LocalPhoneFormat(digits),
		Name:        name,
		WAConsent:   in.WAConsent == true,
	}
	if email != "" {
		reg.Email = &email
	}
	if birth != "" {
		reg.BirthDate = &birth
	}
	return reg, nil
}

// JSLength is the UTF-16 length JavaScript's String.length reports.
func JSLength(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}
